// Única puerta de acceso a Supabase. Ningún otro módulo llama a Supabase directamente.
// supabase-js v2 se carga como script clásico (vendor/supabase.js) y deja el objeto global `supabase`.
import { CONFIG } from '../config.js';
import { guardarMeta, borrarMeta } from './almacen.js';
import * as reloj from './reloj.js';

const CLAVE_SESION = 'asis-auth';
const LIMITE_MS = 6000;   // si el servidor no responde en este lapso, se trata como "sin señal"

export const cliente = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: CLAVE_SESION }
});

// Copia mínima de la sesión para el service worker (Background Sync envía pendientes con la app cerrada).
// Vive en el mismo almacén del teléfono que la sesión de supabase-js; se borra al cerrar sesión.
cliente.auth.onAuthStateChange((evento, sesion) => {
  // Token recién renovado: sirve para medir la diferencia de reloj (HU-19)
  if (evento === 'TOKEN_REFRESHED' && sesion?.access_token) reloj.medir(sesion.access_token).catch(() => {});
  if (sesion?.access_token) {
    guardarMeta('sesion_sw', { url: CONFIG.SUPABASE_URL, llave: CONFIG.SUPABASE_KEY, token: sesion.access_token, expira: sesion.expires_at }).catch(() => {});
  } else if (evento === 'SIGNED_OUT') {
    borrarMeta('sesion_sw').catch(() => {});
  }
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
// Si el teléfono avisa que perdió la señal, se deja de esperar en ese momento (la pantalla no se queda congelada).
function conLimite(promesa, ms = LIMITE_MS) {
  let reloj, alPerderSenal;
  const limite = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(errorSinSenal()), ms);
    alPerderSenal = () => rechazar(errorSinSenal());
    window.addEventListener('offline', alPerderSenal);
  });
  return Promise.race([promesa, limite]).finally(() => { clearTimeout(reloj); window.removeEventListener('offline', alPerderSenal); });
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
  await reloj.medir(data.session.access_token).catch(() => {});   // hora del servidor al iniciar sesión (HU-19)
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

// ---------- Mis horas (HU-14) ----------

// Días de la persona desde la vista oficial v_jornada_diaria (la misma del reporte para la autoridad).
export async function miJornadaDiaria(miembroId, desdeFecha, hastaFecha) {
  if (navigator.onLine === false) throw errorSinSenal();
  const { data, error } = await conLimite(cliente
    .from('v_jornada_diaria')
    .select('fecha, minutos_efectivos, minutos_pausa, jornada_abierta, bloque_inconsistente, con_revision')
    .eq('miembro_id', miembroId)
    .gte('fecha', desdeFecha)
    .lte('fecha', hastaFecha)
    .order('fecha'));
  if (error) throw error;
  return data || [];
}

// ---------- Incidencias (HU-28/29) ----------

const CAMPOS_INCIDENCIA = 'id, miembro_id, tipo, evento_original_id, tipo_evento_propuesto, bloque_propuesto, hora_propuesta, motivo, estado, comentario_resolucion, creada_en, resuelta_en';

// Solicitudes de corrección de la persona (las más recientes primero).
export async function misIncidencias(miembroId) {
  if (navigator.onLine === false) throw errorSinSenal();
  const { data, error } = await conLimite(cliente
    .from('incidencias')
    .select(CAMPOS_INCIDENCIA)
    .eq('miembro_id', miembroId)
    .order('creada_en', { ascending: false })
    .limit(100));
  if (error) throw error;
  return data || [];
}

// El asesor solicita una corrección. El id lo genera el teléfono: reintentar no duplica.
// La organización, el estado y quién resuelve los fija el servidor (trigger controlar_incidencia).
export async function solicitarIncidencia(fila) {
  if (navigator.onLine === false) throw errorSinSenal();
  const { error } = await conLimite(cliente
    .from('incidencias')
    .upsert(fila, { onConflict: 'id', ignoreDuplicates: true }), 15000);
  if (error) throw error;
}

// Panel: incidencias de la organización con el nombre de la persona y la checada original.
export async function incidenciasDeOrganizacion(organizacionId, { estado, desdeISO } = {}) {
  let consulta = cliente
    .from('incidencias')
    .select(`${CAMPOS_INCIDENCIA}, persona:miembros!miembro_id(nombre_completo), resolutor:miembros!resuelta_por(nombre_completo), original:eventos_jornada!evento_original_id(tipo, bloque, hora_efectiva, motivos_revision)`)
    .eq('organizacion_id', organizacionId);
  if (estado) consulta = consulta.eq('estado', estado);
  else consulta = consulta.neq('estado', 'pendiente');
  if (desdeISO) consulta = consulta.gte('creada_en', desdeISO);
  const { data, error } = await conLimite(consulta.order('creada_en', { ascending: !!estado }).limit(200), 15000);
  if (error) throw error;
  return data || [];
}

// Coordinación aprueba o rechaza. El servidor impide aprobar las propias y resolver dos veces;
// al aprobar crea el evento corregido (origen = 'incidencia').
export async function resolverIncidencia(id, estado, comentario) {
  const { data, error } = await conLimite(cliente
    .from('incidencias')
    .update({ estado, comentario_resolucion: comentario || null })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id, estado'), 15000);
  if (error) throw error;
  if (!data?.length) throw new Error('La incidencia ya no está pendiente o no tienes permiso para resolverla.');
  return data[0];
}

// ---------- Panel: tablero del día (HU-27) ----------

// Personas activas de la organización (RLS: solo coordinación y administración ven a todas).
export async function miembrosDeOrganizacion(organizacionId) {
  const { data, error } = await conLimite(cliente
    .from('miembros')
    .select('id, nombre_completo, num_empleado, rol')
    .eq('organizacion_id', organizacionId)
    .eq('activo', true)
    .order('nombre_completo'), 15000);
  if (error) throw error;
  return data || [];
}

export async function horariosDeOrganizacion(organizacionId) {
  const { data, error } = await conLimite(cliente
    .from('horarios')
    .select('miembro_id, dia_semana, bloque, hora_inicio, hora_fin, modalidad, vigente_desde, vigente_hasta')
    .eq('organizacion_id', organizacionId), 15000);
  if (error) throw error;
  return data || [];
}

// Eventos de la organización entre dos instantes, en páginas de 1000 (tope de Supabase).
export async function eventosDeOrganizacion(organizacionId, desdeISO, hastaISO) {
  const PAGINA = 1000;
  const filas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await conLimite(cliente
      .from('eventos_jornada')
      .select('id, miembro_id, tipo, bloque, modalidad, hora_efectiva, sitio_id, dentro_geocerca, estado_revision, origen')
      .eq('organizacion_id', organizacionId)
      .gte('hora_efectiva', desdeISO)
      .lt('hora_efectiva', hastaISO)
      .order('hora_efectiva')
      .order('id')
      .range(desde, desde + PAGINA - 1), 20000);
    if (error) throw error;
    filas.push(...data);
    if (data.length < PAGINA) break;
  }
  return filas;
}

// Ids de checadas cuya hora corrigió una incidencia aprobada (ya no cuentan; migración 0003).
export async function corregidasDeOrganizacion(organizacionId) {
  const { data, error } = await conLimite(cliente
    .from('incidencias')
    .select('evento_original_id')
    .eq('organizacion_id', organizacionId)
    .eq('estado', 'aprobada')
    .eq('tipo', 'correccion_hora')
    .not('evento_original_id', 'is', null), 15000);
  if (error) throw error;
  return new Set((data || []).map((f) => f.evento_original_id));
}
