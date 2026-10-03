// Única puerta de acceso a Supabase. Ningún otro módulo llama a Supabase directamente.
// supabase-js v2 se carga como script clásico (vendor/supabase.js) y deja el objeto global `supabase`.
import { CONFIG } from '../config.js';

const CLAVE_SESION = 'asis-auth';
const LIMITE_MS = 6000;   // si el servidor no responde en este lapso, se trata como "sin señal"

export const cliente = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: CLAVE_SESION }
});

// ¿El error se debe a falta de señal (y conviene reintentar) y no a un rechazo del servidor?
export function esErrorDeRed(error) {
  if (!error) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (error.name === 'AuthRetryableFetchError') return true;
  if (error.status === 0) return true;
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(`${error.message} ${error.details ?? ''}`);
}

function errorSinSenal() {
  const e = new Error('Sin conexión');
  e.name = 'AuthRetryableFetchError';
  return e;
}

// Corta la espera: en un parque con "señal fantasma" la petición puede quedarse colgada.
function conLimite(promesa, ms = LIMITE_MS) {
  let reloj;
  const limite = new Promise((_, rechazar) => { reloj = setTimeout(() => rechazar(errorSinSenal()), ms); });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(reloj));
}

function sesionGuardada() {
  try {
    const guardada = JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null');
    return guardada?.user ? guardada : null;
  } catch { return null; }
}

// ---------- Sesión ----------

// Devuelve { usuario, sinConexion } o null. Sin señal y con el token vencido, supabase-js no puede renovarlo
// (y tarda en rendirse): en ese caso se usa la sesión guardada en el teléfono; se renovará al volver la señal.
export async function sesionActual() {
  const guardada = sesionGuardada();
  if (navigator.onLine === false) return guardada ? { usuario: guardada.user, sinConexion: true } : null;
  try {
    const { data, error } = await conLimite(cliente.auth.getSession());
    if (data?.session) return { usuario: data.session.user, sinConexion: false };
    if (error && !esErrorDeRed(error)) return null;
    if (!error) return null;
  } catch (e) {
    if (!esErrorDeRed(e)) throw e;
  }
  const aunGuardada = sesionGuardada();
  return aunGuardada ? { usuario: aunGuardada.user, sinConexion: true } : null;
}

export async function iniciarSesion(correo, contrasena) {
  const { data, error } = await cliente.auth.signInWithPassword({ email: correo.trim(), password: contrasena });
  if (error) throw error;
  return data.user;
}

export async function cerrarSesion() {
  // scope 'local': cierra solo en este teléfono; si no hay señal, igual borra la sesión local.
  try { await conLimite(cliente.auth.signOut({ scope: 'local' }), 3000); } catch { /* sin señal */ }
  localStorage.removeItem(CLAVE_SESION);
}

// ---------- Membresías ----------

// Filas activas de `miembros` de la persona, con su organización (solo organizaciones activas).
export async function misMembresias(userId) {
  if (navigator.onLine === false) throw errorSinSenal();
  const { data, error } = await conLimite(cliente
    .from('miembros')
    .select('id, organizacion_id, nombre_completo, num_empleado, rol, activo, organizaciones(id, slug, nombre, zona_horaria, config, activa)')
    .eq('user_id', userId)
    .eq('activo', true));
  if (error) throw error;
  return (data || [])
    .filter((m) => m.organizaciones && m.organizaciones.activa !== false)
    .map((m) => ({
      miembroId: m.id,
      organizacionId: m.organizacion_id,
      nombre: m.nombre_completo,
      numEmpleado: m.num_empleado,
      rol: m.rol,
      organizacion: {
        id: m.organizaciones.id,
        slug: m.organizaciones.slug,
        nombre: m.organizaciones.nombre,
        zonaHoraria: m.organizaciones.zona_horaria,
        config: m.organizaciones.config || {}
      }
    }))
    .sort((a, b) => a.organizacion.nombre.localeCompare(b.organizacion.nombre, 'es'));
}

// ---------- Sitios (HU-10) ----------

// Catálogo de sitios activos de la organización desde v_sitios_app, en páginas
// (Supabase entrega como máximo 1000 filas por consulta).
export async function descargarSitios(organizacionId) {
  if (navigator.onLine === false) throw errorSinSenal();
  const PAGINA = 1000;
  const filas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await conLimite(cliente
      .from('v_sitios_app')
      .select('id, organizacion_id, clave_externa, id_oficial, nombre, colonia, tipo, miembro_id, lat, lon, radio_m, tolerancia_m, perimetro_geojson')
      .eq('organizacion_id', organizacionId)
      .order('id')
      .range(desde, desde + PAGINA - 1), 30000);
    if (error) throw error;
    filas.push(...data);
    if (data.length < PAGINA) break;
  }
  return filas;
}

// ---------- Jornada (HU-12) ----------

// Horario programado de la persona (todas las filas; el filtro por día y vigencia lo hace js/reglas.js).
export async function misHorarios(miembroId) {
  if (navigator.onLine === false) throw errorSinSenal();
  const { data, error } = await conLimite(cliente
    .from('horarios')
    .select('dia_semana, bloque, hora_inicio, hora_fin, modalidad, vigente_desde, vigente_hasta')
    .eq('miembro_id', miembroId));
  if (error) throw error;
  return data || [];
}

// Eventos de la persona entre dos instantes (ISO), por hora efectiva (la que fija el servidor).
export async function misEventos(miembroId, desdeISO, hastaISO) {
  if (navigator.onLine === false) throw errorSinSenal();
  const { data, error } = await conLimite(cliente
    .from('eventos_jornada')
    .select('id, tipo, bloque, modalidad, hora_efectiva, sitio_id, dentro_geocerca, estado_revision, motivos_revision, origen')
    .eq('miembro_id', miembroId)
    .gte('hora_efectiva', desdeISO)
    .lt('hora_efectiva', hastaISO)
    .order('hora_efectiva'));
  if (error) throw error;
  return data || [];
}

// ---------- Checada (HU-17) ----------

// Inserta un evento. El id lo generó el teléfono: reintentar es seguro (si ya existe, no se duplica ni se modifica).
// Devuelve lo que fijó el servidor (hora, geocerca, revisión) o null si el evento ya estaba guardado.
export async function insertarEvento(evento) {
  if (navigator.onLine === false) throw errorSinSenal();
  const { data, error } = await conLimite(cliente
    .from('eventos_jornada')
    .upsert(evento, { onConflict: 'id', ignoreDuplicates: true })
    .select('id, hora_efectiva, hora_servidor, sitio_id, distancia_sitio_m, dentro_geocerca, estado_revision, motivos_revision'), 15000);
  if (error) throw error;
  return data?.[0] ?? null;
}

// ---------- Selfie (HU-18) ----------

// Sube la selfie al bucket privado. Nunca reemplaza (upsert: false); si ya existe (reintento), se da por subida.
export async function subirSelfie(ruta, blob) {
  if (navigator.onLine === false) throw errorSinSenal();
  const { error } = await conLimite(cliente.storage.from('selfies').upload(ruta, blob, { upsert: false, contentType: blob.type, cacheControl: '31536000' }), 30000);
  if (error && !(String(error.statusCode) === '409' || /exists|duplicate/i.test(error.message || ''))) throw error;
}
