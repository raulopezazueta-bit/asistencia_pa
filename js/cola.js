// Registro de eventos con respaldo en el teléfono (HU-17; la cola completa con reintentos escalonados es HU-22).
// Regla: el evento se guarda en el teléfono ANTES de enviarse. Si el primer envío falla por falta de señal,
// queda pendiente con capturado_sin_conexion = true (el servidor usará la hora del teléfono) y se reenvía después.
import * as api from './api.js';
import { guardar, leer, borrar, leerTodo } from './almacen.js';

// Devuelve { estado: 'enviado', servidor } | { estado: 'guardado' } | { estado: 'error', mensaje }
export async function registrar(evento) {
  const local = { id: evento.id, miembroId: evento.miembro_id, evento, enviado: false, servidor: null, creadoEn: new Date().toISOString() };
  await guardar('eventos_locales', local);
  try {
    const servidor = await api.insertarEvento(evento);
    await guardar('eventos_locales', { ...local, enviado: true, servidor });
    return { estado: 'enviado', servidor };
  } catch (error) {
    const deRed = api.esErrorDeRed(error);
    const pendiente = deRed ? { ...evento, capturado_sin_conexion: true } : evento;
    await guardar('eventos_locales', { ...local, evento: pendiente });
    await guardar('eventos_pendientes', {
      id: evento.id, miembroId: evento.miembro_id, evento: pendiente, selfieBlob: null,
      intentos: 1, ultimoError: String(error?.message || error), estado: deRed ? 'pendiente' : 'soporte',
      creadoEn: local.creadoEn
    });
    return deRed ? { estado: 'guardado' } : { estado: 'error', mensaje: String(error?.message || error) };
  }
}

let enviando = null;
// Reenvía los pendientes en orden de captura. Se detiene al primer error de red.
export function enviarPendientes() {
  if (enviando) return enviando;
  enviando = (async () => {
    const pendientes = (await leerTodo('eventos_pendientes'))
      .filter((p) => p.estado !== 'soporte')
      .sort((a, b) => a.evento.hora_dispositivo.localeCompare(b.evento.hora_dispositivo));
    let enviados = 0;
    for (const p of pendientes) {
      try {
        const servidor = await api.insertarEvento(p.evento);
        await borrar('eventos_pendientes', p.id);
        const local = await leer('eventos_locales', p.id);
        if (local) await guardar('eventos_locales', { ...local, enviado: true, servidor });
        enviados++;
      } catch (error) {
        const deRed = api.esErrorDeRed(error);
        await guardar('eventos_pendientes', { ...p, intentos: p.intentos + 1, ultimoError: String(error?.message || error), estado: deRed ? 'pendiente' : 'soporte' });
        if (deRed) break;
      }
    }
    return enviados;
  })().finally(() => { enviando = null; });
  return enviando;
}

export async function contarPendientes(miembroId) {
  const todos = await leerTodo('eventos_pendientes');
  const mios = todos.filter((p) => p.miembroId === miembroId);
  return { porEnviar: mios.filter((p) => p.estado !== 'soporte').length, conError: mios.filter((p) => p.estado === 'soporte').length };
}
