// @ts-nocheck  (los módulos incluidos son JavaScript: no se revisan tipos)
// ARCHIVO GENERADO: no editar. Es alta-persona/index.ts con sus módulos incluidos (ver supabase/functions/armar_un_archivo.mjs).
// Función de Supabase (Edge Function) "alta-persona" · HU-09.
// Crea cuentas de acceso y da de baja o reactiva personas. Usa la llave secreta (service_role) que Supabase entrega
// a la función como variable de entorno: NUNCA se escribe en este repositorio ni viaja al teléfono.
// La lógica (y las reglas de quién puede hacer qué) está en logica.js. Cómo publicarla: docs/ALTA_PERSONAS.md
// (en el editor de Supabase se pega index_un_archivo.ts, que es este archivo con logica.js incluido).
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ----- logica.js -----
// Lógica de la función alta-persona (HU-09). JavaScript puro, sin dependencias: la usan index.ts (Supabase Edge
// Functions) y las pruebas locales. Todo acceso a datos pasa por `bd` (ver index.ts), que trabaja con la llave secreta
// del servidor; por eso aquí se verifica que quien llama sea ADMINISTRACIÓN de la organización afectada.
//
// Acciones (POST JSON { accion, ... }):
//   listar      { organizacion_id }                                  → correo, último acceso y bloqueo de cada persona
//   crear       { organizacion_id, correo, nombre_completo, num_empleado?, rol, contrasena }
//   baja        { miembro_id }        (no se borra nada: activo = false y, sin otra alta activa, la cuenta ya no entra)
//   reactivar   { miembro_id }
//   restablecer { miembro_id, contrasena }                            → contraseña temporal nueva
// Las contraseñas que pone administración son temporales: la app pide cambiarlas al entrar (debe_cambiar_contrasena).
// Cada acción queda en la bitácora con quién la hizo (actor), además de lo que registran los triggers.

export const ROLES = ['asesor', 'coordinador', 'admin'];
export const MIN_CONTRASENA = 8;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const responder = (status, cuerpo) => ({ status, cuerpo });
const error = (status, mensaje) => responder(status, { error: mensaje });

function contrasenaValida(c) {
  return typeof c === 'string' && c.length >= MIN_CONTRASENA;
}

export async function atender({ usuarioId, solicitud, bd }) {
  if (!usuarioId) return error(401, 'Sesión no válida. Vuelve a iniciar sesión.');
  const s = solicitud || {};

  // ¿Quien llama es administración activa de esa organización? Devuelve su fila de miembros.
  const admin = async (organizacionId) => {
    const m = await bd.miembroPorUsuario(usuarioId, organizacionId);
    return m && m.activo && m.rol === 'admin' ? m : null;
  };
  const sobreMiembro = async () => {
    const m = s.miembro_id ? await bd.miembro(s.miembro_id) : null;
    if (!m) return { fallo: error(404, 'No se encontró a esa persona.') };
    const yo = await admin(m.organizacion_id);
    if (!yo) return { fallo: error(403, 'Solo administración de la organización puede hacer esto.') };
    return { m, yo };
  };

  switch (s.accion) {
    case 'listar': {
      if (!(await admin(s.organizacion_id))) return error(403, 'Solo administración de la organización puede ver las cuentas.');
      const miembros = await bd.miembrosDeOrganizacion(s.organizacion_id);
      const cuentas = await bd.usuarios(miembros.map((m) => m.user_id).filter(Boolean));
      return responder(200, { personas: miembros.map((m) => {
        const c = cuentas.find((u) => u.id === m.user_id);
        return { miembro_id: m.id, correo: c?.correo ?? null, ultimo_acceso: c?.ultimo_acceso ?? null, bloqueada: !!c?.bloqueada, debe_cambiar: !!c?.debe_cambiar };
      }) });
    }

    case 'crear': {
      if (!(await admin(s.organizacion_id))) return error(403, 'Solo administración de la organización puede dar de alta personas.');
      const correo = String(s.correo || '').trim().toLowerCase();
      const nombre = String(s.nombre_completo || '').trim();
      const numEmpleado = String(s.num_empleado || '').trim() || null;
      if (!CORREO.test(correo)) return error(400, 'Escribe un correo válido.');
      if (nombre.length < 3) return error(400, 'Escribe el nombre completo.');
      if (!ROLES.includes(s.rol)) return error(400, 'Elige un rol válido.');
      let cuenta = await bd.usuarioPorCorreo(correo);
      if (cuenta && (await bd.miembroPorUsuario(cuenta.id, s.organizacion_id))) {
        return error(409, 'Esa persona ya está dada de alta en esta organización. Si estaba de baja, usa "Reactivar".');
      }
      if (numEmpleado && (await bd.numEmpleadoOcupado(s.organizacion_id, numEmpleado))) {
        return error(409, `El número de empleado ${numEmpleado} ya lo tiene otra persona.`);
      }
      const cuentaNueva = !cuenta;
      if (cuentaNueva) {
        if (!contrasenaValida(s.contrasena)) return error(400, `La contraseña temporal debe tener al menos ${MIN_CONTRASENA} caracteres.`);
        cuenta = await bd.crearUsuario({ correo, contrasena: s.contrasena, metadata: { debe_cambiar_contrasena: true } });
      }
      const miembro = await bd.insertarMiembro({ organizacion_id: s.organizacion_id, user_id: cuenta.id, nombre_completo: nombre, num_empleado: numEmpleado, rol: s.rol });
      await bd.registrar({ organizacion_id: s.organizacion_id, accion: 'ALTA', registro_id: miembro.id, actor: usuarioId, datos: { correo, rol: s.rol, cuenta_nueva: cuentaNueva } });
      return responder(201, { miembro, cuenta_nueva: cuentaNueva });
    }

    case 'baja': {
      const { m, yo, fallo } = await sobreMiembro();
      if (fallo) return fallo;
      if (m.id === yo.id) return error(400, 'No puedes darte de baja a ti misma(o). Pide a otra persona de administración.');
      if (!m.activo) return error(409, 'Esa persona ya está de baja.');
      await bd.actualizarMiembro(m.id, { activo: false, fecha_baja: await bd.hoy(m.organizacion_id) });
      // Sin otra alta activa (en otra organización), la cuenta queda bloqueada: ya no puede entrar
      const otra = m.user_id ? await bd.otraAltaActiva(m.user_id, m.id) : false;
      if (m.user_id && !otra) await bd.bloquearUsuario(m.user_id, true);
      await bd.registrar({ organizacion_id: m.organizacion_id, accion: 'BAJA', registro_id: m.id, actor: usuarioId, datos: { cuenta_bloqueada: !!m.user_id && !otra } });
      return responder(200, { miembro_id: m.id, activo: false, cuenta_bloqueada: !!m.user_id && !otra });
    }

    case 'reactivar': {
      const { m, fallo } = await sobreMiembro();
      if (fallo) return fallo;
      if (m.activo) return error(409, 'Esa persona ya está activa.');
      await bd.actualizarMiembro(m.id, { activo: true, fecha_baja: null });
      if (m.user_id) await bd.bloquearUsuario(m.user_id, false);
      await bd.registrar({ organizacion_id: m.organizacion_id, accion: 'REACTIVACION', registro_id: m.id, actor: usuarioId, datos: {} });
      return responder(200, { miembro_id: m.id, activo: true });
    }

    case 'restablecer': {
      const { m, yo, fallo } = await sobreMiembro();
      if (fallo) return fallo;
      if (m.id === yo.id) return error(400, 'Para cambiar tu propia contraseña usa Perfil › Cambiar contraseña.');
      if (!m.user_id) return error(409, 'Esa persona no tiene cuenta de acceso.');
      if (!contrasenaValida(s.contrasena)) return error(400, `La contraseña temporal debe tener al menos ${MIN_CONTRASENA} caracteres.`);
      await bd.actualizarUsuario(m.user_id, { contrasena: s.contrasena, metadata: { debe_cambiar_contrasena: true } });
      await bd.registrar({ organizacion_id: m.organizacion_id, accion: 'CONTRASENA_RESTABLECIDA', registro_id: m.id, actor: usuarioId, datos: {} });
      return responder(200, { miembro_id: m.id });
    }

    default:
      return error(400, 'Acción no reconocida.');
  }
}

// ----- fin de logica.js -----

// La llave secreta la pone Supabase: SUPABASE_SERVICE_ROLE_KEY (llaves clásicas) o SUPABASE_SECRET_KEYS (llaves nuevas
// sb_secret_…, en JSON). Si no está, la función igual arranca y responde con el diagnóstico (sin mostrar la llave).
function llaveSecreta(): string | null {
  const clasica = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (clasica) return clasica;
  try {
    const nuevas = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    return nuevas.default || Object.values(nuevas)[0] as string || null;
  } catch { return null; }
}
const URL = Deno.env.get('SUPABASE_URL') || '';
const LLAVE_SECRETA = llaveSecreta();
const sb: any = URL && LLAVE_SECRETA ? createClient(URL, LLAVE_SECRETA, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

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
  // Diagnóstico: abrir la dirección de la función en el navegador (GET) dice si está publicada y si tiene su llave
  if (req.method === 'GET') return json(200, { funcion: 'alta-persona', publicada: true, llave_secreta: !!LLAVE_SECRETA, url: !!URL });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });
  if (!sb) return json(500, { error: 'La función alta-persona no encontró su llave secreta en Supabase. Avisa a soporte (Ecosistémica).' });
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
