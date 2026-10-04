// Función de Supabase (Edge Function) "alta-persona" · HU-09.
// Crea cuentas de acceso y da de baja o reactiva personas. Usa la llave secreta (service_role) que Supabase entrega
// a la función como variable de entorno: NUNCA se escribe en este repositorio ni viaja al teléfono.
// La lógica (y las reglas de quién puede hacer qué) está en logica.js. Cómo publicarla: docs/ALTA_PERSONAS.md
// (en el editor de Supabase se pega index_un_archivo.ts, que es este archivo con logica.js incluido).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { atender } from './logica.js';

const URL = Deno.env.get('SUPABASE_URL')!;
const LLAVE_SECRETA = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(URL, LLAVE_SECRETA, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const unico = async (consulta: any) => { const { data, error } = await consulta; if (error) throw error; return data; };

// Todas las cuentas (menos de 30 personas por organización: una o dos páginas)
async function todasLasCuentas() {
  const cuentas: any[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    cuentas.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return cuentas;
}

const bd = {
  miembroPorUsuario: (uid: string, org: string) => unico(sb.from('miembros').select('*').eq('user_id', uid).eq('organizacion_id', org).maybeSingle()),
  miembro: (id: string) => unico(sb.from('miembros').select('*').eq('id', id).maybeSingle()),
  miembrosDeOrganizacion: (org: string) => unico(sb.from('miembros').select('*').eq('organizacion_id', org)),
  numEmpleadoOcupado: async (org: string, num: string) => !!(await unico(sb.from('miembros').select('id').eq('organizacion_id', org).eq('num_empleado', num).maybeSingle())),
  otraAltaActiva: async (uid: string, excepto: string) => (await unico(sb.from('miembros').select('id').eq('user_id', uid).eq('activo', true).neq('id', excepto))).length > 0,
  insertarMiembro: (fila: any) => unico(sb.from('miembros').insert(fila).select().single()),
  actualizarMiembro: (id: string, cambios: any) => unico(sb.from('miembros').update(cambios).eq('id', id)),
  hoy: async (org: string) => {
    const o = await unico(sb.from('organizaciones').select('zona_horaria').eq('id', org).single());
    return new Intl.DateTimeFormat('en-CA', { timeZone: o.zona_horaria || 'America/Mazatlan' }).format(new Date());
  },
  usuarios: async (ids: string[]) => (await todasLasCuentas()).filter((u) => ids.includes(u.id)).map((u) => ({
    id: u.id, correo: u.email, ultimo_acceso: u.last_sign_in_at ?? null,
    bloqueada: !!u.banned_until && new Date(u.banned_until) > new Date(), debe_cambiar: !!u.user_metadata?.debe_cambiar_contrasena
  })),
  usuarioPorCorreo: async (correo: string) => {
    const u = (await todasLasCuentas()).find((x) => (x.email || '').toLowerCase() === correo);
    return u ? { id: u.id } : null;
  },
  crearUsuario: async ({ correo, contrasena, metadata }: any) => {
    const { data, error } = await sb.auth.admin.createUser({ email: correo, password: contrasena, email_confirm: true, user_metadata: metadata });
    if (error) throw error;
    return { id: data.user.id };
  },
  actualizarUsuario: async (uid: string, { contrasena, metadata }: any) => {
    const { error } = await sb.auth.admin.updateUserById(uid, { password: contrasena, user_metadata: metadata });
    if (error) throw error;
  },
  // ~100 años = sin fecha de término; 'none' quita el bloqueo
  bloquearUsuario: async (uid: string, bloquear: boolean) => {
    const { error } = await sb.auth.admin.updateUserById(uid, { ban_duration: bloquear ? '876000h' : 'none' });
    if (error) throw error;
  },
  registrar: ({ organizacion_id, accion, registro_id, actor, datos }: any) =>
    unico(sb.from('bitacora').insert({ organizacion_id, tabla: 'alta-persona', registro_id, accion, actor, datos }))
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });
  try {
    // Quién llama: se valida su token con Supabase Auth (no se confía en lo que diga el cuerpo)
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer /i, '');
    const { data } = token ? await sb.auth.getUser(token) : { data: { user: null } };
    const solicitud = await req.json().catch(() => ({}));
    const r = await atender({ usuarioId: data.user?.id ?? null, solicitud, bd });
    return json(r.status, r.cuerpo);
  } catch (e) {
    console.error(e);
    return json(500, { error: 'No se pudo completar. Intenta de nuevo o avisa a soporte.' });
  }
});
