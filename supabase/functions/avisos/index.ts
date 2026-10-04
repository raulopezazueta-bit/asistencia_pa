// Función de Supabase (Edge Function) "avisos" · HU-15b y HU-30: avisos al teléfono aunque la app esté cerrada (Web Push).
// La llama un reloj programado (pg_cron) cada 5 minutos con su contraseña (claves_push.token_cron); calcula los avisos
// con logica.js y los envía a los teléfonos registrados. La primera vez genera sola sus llaves (VAPID) y la contraseña
// del reloj: nadie tiene que copiar llaves. Usa la llave secreta que Supabase entrega a la función (nunca en el repo).
// En el editor de Supabase se pega index_un_archivo.ts (este archivo con logica.js y js/reglas.js incluidos).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@0.3.0';
import { avisosPendientes } from './logica.js';

function llaveSecreta(): string | null {
  const clasica = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (clasica) return clasica;
  try {
    const nuevas = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    return nuevas.default || Object.values(nuevas)[0] as string || null;
  } catch { return null; }
}
const URL_SB = Deno.env.get('SUPABASE_URL') || '';
const LLAVE_SECRETA = llaveSecreta();
const sb: any = URL_SB && LLAVE_SECRETA ? createClient(URL_SB, LLAVE_SECRETA, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
// Solo para pruebas locales: permite fijar "ahora". En Supabase esta variable no existe.
const PERMITE_AHORA = Deno.env.get('AVISOS_PERMITE_AHORA') === '1';
const CONTACTO = 'https://github.com/raulopezazueta-bit/asistencia_pa';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
const unico = async (consulta: any) => { const { data, error } = await consulta; if (error) throw error; return data; };
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Llaves VAPID y contraseña del reloj: se crean una sola vez y se guardan en claves_push (solo la llave secreta las lee)
async function claves() {
  let fila = await unico(sb.from('claves_push').select('vapid, token_cron').eq('id', 1).maybeSingle());
  if (!fila) {
    const vapid = await webpush.exportVapidKeys(await webpush.generateVapidKeys({ extractable: true }));
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
    await sb.from('claves_push').insert({ id: 1, vapid, token_cron: token });   // si otra llamada ganó, se usa la suya
    fila = await unico(sb.from('claves_push').select('vapid, token_cron').eq('id', 1).single());
  }
  const servidor = await webpush.ApplicationServer.new({ contactInformation: CONTACTO, vapidKeys: await webpush.importVapidKeys(fila.vapid) });
  return { servidor, token: fila.token_cron as string, publica: base64url(await servidor.getVapidPublicKeyRaw()) };
}

// Envía a todos los teléfonos de una persona; quita los que ya no existen (410/404)
async function enviar(servidor: any, suscripciones: any[], aviso: any) {
  let ok = 0, fallidos = 0;
  const datos = JSON.stringify({ titulo: aviso.titulo, cuerpo: aviso.cuerpo, tag: aviso.tag, url: aviso.url });
  for (const s of suscripciones) {
    try {
      await servidor.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })
        .pushTextMessage(datos, { ttl: 4 * 3600, urgency: webpush.Urgency.High, topic: aviso.tag.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '_') });
      ok++;
    } catch (e: any) {
      fallidos++;
      const estatus = e?.response?.status;
      if (estatus === 404 || estatus === 410) await sb.from('suscripciones_push').delete().eq('endpoint', s.endpoint);
      else console.error('No se pudo enviar el aviso', estatus, e?.message);
    }
  }
  return { ok, fallidos };
}

async function revisar(ahora: Date) {
  const { servidor } = await claves();
  const desde = new Date(ahora.getTime() - 36 * 3600_000).toISOString();
  const [organizaciones, miembros, horarios, eventos, enviados, suscripciones] = await Promise.all([
    unico(sb.from('organizaciones').select('id, zona_horaria, config').eq('activa', true)),
    unico(sb.from('miembros').select('id, organizacion_id, nombre_completo, rol').eq('activo', true)),
    unico(sb.from('horarios').select('miembro_id, dia_semana, bloque, hora_inicio, hora_fin, modalidad, vigente_desde, vigente_hasta')),
    unico(sb.from('eventos_jornada').select('id, miembro_id, tipo, bloque, modalidad, hora_efectiva, sitio_id').gte('hora_efectiva', desde).lte('hora_efectiva', ahora.toISOString())),
    unico(sb.from('avisos_enviados').select('miembro_id, clave').gte('enviado_en', new Date(ahora.getTime() - 3 * 864e5).toISOString())),
    unico(sb.from('suscripciones_push').select('miembro_id, endpoint, p256dh, auth'))
  ]);
  const avisos = avisosPendientes({ ahora, organizaciones, miembros, horarios, eventos,
    enviados: new Set(enviados.map((x: any) => `${x.miembro_id}|${x.clave}`)) });
  const resumen = { avisos: avisos.length, enviados: 0, fallidos: 0, sin_telefono: 0 };
  for (const a of avisos) {
    // Se anota antes de enviar: si dos revisiones coinciden, solo una lo manda (clave única)
    const { error } = await sb.from('avisos_enviados').insert(a.claves.map((clave: string) => ({ organizacion_id: a.organizacion_id, miembro_id: a.miembro_id, clave })));
    if (error) continue;
    const suyas = suscripciones.filter((s: any) => s.miembro_id === a.miembro_id);
    if (!suyas.length) { resumen.sin_telefono++; continue; }
    const r = await enviar(servidor, suyas, a);
    resumen.enviados += r.ok;
    resumen.fallidos += r.fallidos;
  }
  return resumen;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!sb) {
    return json(req.method === 'GET' ? 200 : 500, { funcion: 'avisos', publicada: true, llave_secreta: false,
      error: 'La función avisos no encontró su llave secreta en Supabase. Avisa a soporte (Ecosistémica).' });
  }
  try {
    const url = new URL(req.url);
    // La app pide la llave pública para registrar el teléfono; abrir la dirección sin nada da el diagnóstico
    if (req.method === 'GET') {
      const { publica } = await claves();
      if (url.searchParams.has('llave')) return json(200, { llave_publica: publica });
      return json(200, { funcion: 'avisos', publicada: true, llave_secreta: true, claves_listas: true });
    }
    if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });
    const cuerpo = await req.json().catch(() => ({}));

    // Aviso de prueba a la persona que lo pide (Perfil › Probar aviso)
    if (cuerpo.accion === 'probar') {
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer /i, '');
      const { data } = token ? await sb.auth.getUser(token) : { data: { user: null } };
      if (!data.user) return json(401, { error: 'Sesión no válida. Vuelve a iniciar sesión.' });
      const mios = await unico(sb.from('miembros').select('id').eq('user_id', data.user.id).eq('activo', true));
      const suyas = await unico(sb.from('suscripciones_push').select('miembro_id, endpoint, p256dh, auth').in('miembro_id', mios.map((m: any) => m.id)));
      if (!suyas.length) return json(409, { error: 'Este teléfono aún no está registrado para recibir avisos.' });
      const { servidor } = await claves();
      const r = await enviar(servidor, suyas, { titulo: 'Avisos activados', cuerpo: 'Así llegará el recordatorio de salida, aunque la app esté cerrada.', tag: 'prueba', url: './#perfil' });
      return json(200, r);
    }

    // Revisión programada (pg_cron): exige la contraseña del reloj
    const { token } = await claves();
    if (req.headers.get('x-token-cron') !== token) return json(401, { error: 'No autorizado' });
    const ahora = PERMITE_AHORA && cuerpo.ahora ? new Date(cuerpo.ahora) : new Date();
    return json(200, await revisar(ahora));
  } catch (e) {
    console.error(e);
    return json(500, { error: 'No se pudo completar la revisión de avisos.' });
  }
});
