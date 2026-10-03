// Datos de la jornada de hoy: horario (Supabase → copia en el teléfono) y eventos del día
// (enviados al servidor + capturados en el teléfono), listos para js/reglas.js.
import * as api from './api.js';
import * as sitios from './sitios.js';
import { leerMeta, guardarMeta, leerTodo } from './almacen.js';
import { horarioDelDia, rangoDelDia } from './reglas.js';

// Horario: se pide al servidor; sin señal se usa la última copia de esta persona.
async function horarios(perfil) {
  try {
    const filas = await api.misHorarios(perfil.miembroId);
    await guardarMeta('horarios', { miembroId: perfil.miembroId, filas, actualizados: new Date().toISOString() });
    return filas;
  } catch (error) {
    if (!api.esErrorDeRed(error)) console.warn('No se pudo leer el horario', error);
    const copia = await leerMeta('horarios');
    return copia?.miembroId === perfil.miembroId ? copia.filas : [];
  }
}

// Eventos del servidor de hoy; sin señal se usa la última copia del mismo día.
async function eventosServidor(perfil, rango) {
  const clave = `eventos_hoy`;
  try {
    const filas = await api.misEventos(perfil.miembroId, rango.desde.toISOString(), rango.hasta.toISOString());
    await guardarMeta(clave, { miembroId: perfil.miembroId, fecha: rango.fecha, filas });
    return { filas, sinConexion: false };
  } catch (error) {
    if (!api.esErrorDeRed(error)) console.warn('No se pudieron leer los eventos', error);
    const copia = await leerMeta(clave);
    const vale = copia?.miembroId === perfil.miembroId && copia.fecha === rango.fecha;
    return { filas: vale ? copia.filas : [], sinConexion: true };
  }
}

// Eventos capturados en el teléfono (la cola offline de HU-22 los guarda aquí). Forma: { id, miembroId, evento, enviado }
async function eventosLocales(perfil, rango) {
  const todos = await leerTodo('eventos_locales').catch(() => []);
  return todos
    .filter((x) => x.miembroId === perfil.miembroId)
    .map((x) => x.evento)
    .filter((e) => {
      const t = new Date(e.hora_dispositivo).getTime();
      return t >= rango.desde.getTime() && t < rango.hasta.getTime();
    });
}

// Devuelve { horario, eventos, sinConexion } con eventos en la forma de js/reglas.js.
export async function cargarHoy(perfil, ahora = new Date()) {
  const zona = perfil.organizacion.zonaHoraria;
  const rango = rangoDelDia(ahora, zona);
  const [filasHorario, servidor, locales, catalogo] = await Promise.all([
    horarios(perfil), eventosServidor(perfil, rango), eventosLocales(perfil, rango), sitios.todos(perfil.organizacionId)
  ]);
  const nombreSitio = new Map(catalogo.map((s) => [s.id, s.nombre]));
  const porId = new Map();
  for (const e of servidor.filas) {
    porId.set(e.id, { id: e.id, tipo: e.tipo, bloque: e.bloque, modalidad: e.modalidad, hora: e.hora_efectiva,
      sitioId: e.sitio_id, sitioNombre: nombreSitio.get(e.sitio_id), estadoRevision: e.estado_revision, enviado: true });
  }
  for (const e of locales) {
    if (porId.has(e.id)) continue;   // ya llegó al servidor: manda la hora del servidor
    porId.set(e.id, { id: e.id, tipo: e.tipo, bloque: e.bloque, modalidad: e.modalidad, hora: e.hora_dispositivo,
      sitioId: e.sitio_id, sitioNombre: nombreSitio.get(e.sitio_id), estadoRevision: null, enviado: false });
  }
  return { horario: horarioDelDia(filasHorario, ahora, zona), eventos: [...porId.values()], sinConexion: servidor.sinConexion };
}
