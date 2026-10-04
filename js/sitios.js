// Catálogo de sitios guardado en el teléfono (HU-10).
// Se descarga de v_sitios_app al iniciar sesión y una vez al día; se usa sin señal para buscar y validar geocercas.
import * as api from './api.js';
import { leerMeta, guardarMeta, borrarMeta, leerTodo, reemplazarTodo } from './almacen.js';

let enMemoria = null;   // { organizacionId, filas }

// "Parque Álamos" → "parque alamos" (búsqueda sin acentos ni mayúsculas)
export function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function fechaLocal(zonaHoraria, fecha = new Date()) {
  // en-CA da AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: zonaHoraria, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
}

function preparar(f) {
  return {
    id: f.id,
    organizacionId: f.organizacion_id,
    clave: f.clave_externa,
    idOficial: f.id_oficial,
    nombre: f.nombre,
    colonia: f.colonia,
    tipo: f.tipo,
    miembroId: f.miembro_id,
    lat: f.lat,
    lon: f.lon,
    radioM: f.radio_m,
    toleranciaM: f.tolerancia_m,
    perimetro: f.perimetro_geojson,   // GeoJSON MultiPolygon o null
    busqueda: normalizar([f.nombre, f.clave_externa, f.id_oficial, f.colonia].filter(Boolean).join(' '))
  };
}

export async function estado() {
  return (await leerMeta('sitios_meta')) || null;
}

// ¿Hace falta descargar? Sí si nunca se ha hecho, si cambió la organización o si la última fue otro día.
export async function haceFalta(perfil) {
  const meta = await estado();
  if (!meta || meta.organizacionId !== perfil.organizacionId) return true;
  return meta.fechaLocal !== fechaLocal(perfil.organizacion.zonaHoraria);
}

// Descarga y reemplaza el catálogo. Si falla (p. ej. sin señal) se conserva el que ya estaba.
// Devuelve { actualizado: bool, meta, error? }
export async function actualizar(perfil, { forzar = false } = {}) {
  if (!forzar && !(await haceFalta(perfil))) return { actualizado: false, meta: await estado() };
  try {
    const filas = (await api.descargarSitios(perfil.organizacionId)).map(preparar);
    await reemplazarTodo('sitios', filas);
    const meta = {
      organizacionId: perfil.organizacionId,
      total: filas.length,
      descargados: new Date().toISOString(),
      fechaLocal: fechaLocal(perfil.organizacion.zonaHoraria)
    };
    await guardarMeta('sitios_meta', meta);
    enMemoria = { organizacionId: perfil.organizacionId, filas };
    return { actualizado: true, meta };
  } catch (error) {
    return { actualizado: false, meta: await estado(), error };
  }
}

// Todos los sitios guardados de la organización (para la geocerca en HU-17).
export async function todos(organizacionId) {
  if (enMemoria?.organizacionId === organizacionId) return enMemoria.filas;
  const meta = await estado();
  const filas = meta?.organizacionId === organizacionId ? await leerTodo('sitios') : [];
  enMemoria = { organizacionId, filas };
  return filas;
}

// Búsqueda por nombre, clave, id oficial o colonia. Todas las palabras deben aparecer.
// Orden: clave exacta, luego nombre que empieza con lo escrito, luego el resto (alfabético).
export async function buscar(organizacionId, texto, limite = 20) {
  const q = normalizar(texto);
  if (!q) return [];
  const palabras = q.split(' ');
  const puntaje = (s) => {
    if (normalizar(s.clave) === q || normalizar(s.idOficial) === q) return 0;
    const nombre = normalizar(s.nombre);
    if (nombre.startsWith(q)) return 1;
    if (nombre.split(' ').some((p) => p.startsWith(palabras[0]))) return 2;
    return 3;
  };
  return (await todos(organizacionId))
    .filter((s) => palabras.every((p) => s.busqueda.includes(p)))
    .map((s) => ({ s, p: puntaje(s) }))
    .sort((a, b) => a.p - b.p || a.s.nombre.localeCompare(b.s.nombre, 'es'))
    .slice(0, limite)
    .map((x) => x.s);
}

// Al cerrar sesión: el catálogo incluye el domicilio de la persona, así que se borra del teléfono.
export async function olvidar() {
  enMemoria = null;
  await reemplazarTodo('sitios', []);
  await borrarMeta('sitios_meta');
}
