// Cola de envío con respaldo en el teléfono (HU-17 + HU-22, docs/ESPECIFICACION.md §5).
// Regla: el evento se guarda en el teléfono ANTES de enviarse. Si el primer envío falla por falta de señal,
// queda pendiente con capturado_sin_conexion = true (el servidor usará la hora del teléfono) y se reenvía después:
// al recuperar señal, al volver a la app, cada 60 s con la app abierta y con Background Sync donde exista.
import * as api from './api.js';
import { guardar, leer, borrar, leerTodo } from './almacen.js';

// Espera antes de cada reintento (después del 1.º, 2.º, … fallo por red): 30 s, 1, 2, 5 y 10 min.
export const ESPERAS_MS = [30_000, 60_000, 120_000, 300_000, 600_000];
export const DIAS_REGISTRO_LOCAL = 35;
export const ETIQUETA_SYNC = 'enviar-pendientes';

export function esperaTras(intentos) {
  return ESPERAS_MS[Math.min(Math.max(intentos, 1), ESPERAS_MS.length) - 1];
}

// Orden de envío (ESPECIFICACION §5): primero la selfie (si hay), luego el evento.
async function enviar(evento, selfieBlob) {
  if (selfieBlob && evento.selfie_path) await api.subirSelfie(evento.selfie_path, selfieBlob);
  return api.insertarEvento(evento);
}

function pedirEnvioEnSegundoPlano() {
  // Background Sync (Chrome/Android). En iOS no existe: ahí cubren los otros disparadores.
  navigator.serviceWorker?.ready.then((r) => r.sync?.register(ETIQUETA_SYNC)).catch(() => {});
}

// Devuelve { estado: 'enviado', servidor } | { estado: 'guardado' } | { estado: 'error', mensaje }
// selfieBlob solo se conserva en el teléfono mientras el evento esté pendiente.
export async function registrar(evento, selfieBlob = null) {
  const local = { id: evento.id, miembroId: evento.miembro_id, evento, enviado: false, servidor: null, creadoEn: new Date().toISOString() };
  await guardar('eventos_locales', local);
  try {
    const servidor = await enviar(evento, selfieBlob);
    await guardar('eventos_locales', { ...local, enviado: true, servidor });
    return { estado: 'enviado', servidor };
  } catch (error) {
    const deRed = api.esErrorDeRed(error);
    const pendiente = deRed ? { ...evento, capturado_sin_conexion: true } : evento;
    await guardar('eventos_locales', { ...local, evento: pendiente });
    await guardar('eventos_pendientes', {
      id: evento.id, miembroId: evento.miembro_id, evento: pendiente, selfieBlob,
      intentos: 1, ultimoError: String(error?.message || error), estado: deRed ? 'pendiente' : 'soporte',
      proximoIntento: Date.now() + esperaTras(1), creadoEn: local.creadoEn
    });
    if (deRed) pedirEnvioEnSegundoPlano();
    return deRed ? { estado: 'guardado' } : { estado: 'error', mensaje: String(error?.message || error) };
  }
}

let enviando = null;
// Reenvía los pendientes de las personas indicadas, en orden de captura.
// Sin `forzar`, respeta la espera escalonada de cada pendiente; con `forzar` (volvió la señal) los intenta ya.
// Se detiene al primer error de red. Devuelve cuántos se enviaron.
export function enviarPendientes(miembroIds, { forzar = false } = {}) {
  if (enviando) return enviando;
  enviando = (async () => {
    const ahora = Date.now();
    const pendientes = (await leerTodo('eventos_pendientes'))
      .filter((p) => p.estado !== 'soporte' && miembroIds.includes(p.miembroId))
      .filter((p) => forzar || !p.proximoIntento || p.proximoIntento <= ahora)
      .sort((a, b) => a.evento.hora_dispositivo.localeCompare(b.evento.hora_dispositivo));
    let enviados = 0;
    for (const p of pendientes) {
      // Puede haberlo enviado ya el service worker (Background Sync) mientras esperábamos.
      if (!(await leer('eventos_pendientes', p.id))) continue;
      try {
        const servidor = await enviar(p.evento, p.selfieBlob);
        await borrar('eventos_pendientes', p.id);   // con esto se borra también la selfie del teléfono
        const local = await leer('eventos_locales', p.id);
        if (local) await guardar('eventos_locales', { ...local, enviado: true, servidor });
        enviados++;
      } catch (error) {
        const deRed = api.esErrorDeRed(error);
        const intentos = p.intentos + 1;
        await guardar('eventos_pendientes', { ...p, intentos, ultimoError: String(error?.message || error),
          estado: deRed ? 'pendiente' : 'soporte', proximoIntento: Date.now() + esperaTras(intentos) });
        if (deRed) { pedirEnvioEnSegundoPlano(); break; }
      }
    }
    return enviados;
  })().finally(() => { enviando = null; });
  return enviando;
}

export async function contarPendientes(miembroIds) {
  const mios = (await leerTodo('eventos_pendientes')).filter((p) => miembroIds.includes(p.miembroId));
  return { porEnviar: mios.filter((p) => p.estado !== 'soporte').length, conError: mios.filter((p) => p.estado === 'soporte').length };
}

// Conserva en el teléfono solo los últimos 35 días ya enviados (los pendientes nunca se borran aquí).
export async function limpiarRegistroLocal(ahora = Date.now()) {
  const limite = ahora - DIAS_REGISTRO_LOCAL * 24 * 3600 * 1000;
  let borrados = 0;
  for (const x of await leerTodo('eventos_locales')) {
    if (x.enviado && new Date(x.evento.hora_dispositivo).getTime() < limite) { await borrar('eventos_locales', x.id); borrados++; }
  }
  return borrados;
}
