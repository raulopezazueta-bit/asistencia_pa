// Recordatorio de salida (HU-15): notificación del teléfono si un bloque sigue abierto después de su hora de fin
// más config.recordatorio_salida_min (30 por omisión). Funciona con la app abierta (también en segundo plano mientras
// el navegador la mantenga viva); con la app cerrada llegará con Web Push (Sprint 4). El aviso dentro de la app
// (alerta "¿Olvidaste checar salida?") siempre se muestra, haya o no permiso de notificaciones.
// Un solo aviso por bloque y por día (se recuerda en el teléfono).
import { leerMeta, guardarMeta } from './almacen.js';

export function permiso() {
  return typeof Notification === 'undefined' || !('serviceWorker' in navigator) ? 'no_disponible' : Notification.permission;
}

// Debe llamarse desde un toque de la persona (el navegador lo exige).
export async function pedirPermiso() {
  if (permiso() === 'no_disponible') return 'no_disponible';
  return Notification.requestPermission();
}

// alertas: las de calcularEstado; fecha: AAAA-MM-DD local. Devuelve los bloques avisados en esta llamada.
// Las revisiones van en fila: dos repintados seguidos no deben avisar dos veces.
let enCurso = Promise.resolve();
export function revisar(datos) {
  const turno = enCurso.then(() => revisarAhora(datos));
  enCurso = turno.catch(() => {});
  return turno;
}

async function revisarAhora({ alertas, miembroId, fecha }) {
  const olvidos = (alertas || []).filter((a) => a.tipo === 'olvido_fin');
  if (!olvidos.length || permiso() !== 'granted') return [];
  const guardado = await leerMeta('recordatorios').catch(() => null);
  const avisados = guardado?.miembroId === miembroId && guardado.fecha === fecha ? guardado.bloques : [];
  const nuevos = olvidos.filter((a) => !avisados.includes(a.bloque));
  if (!nuevos.length) return [];
  const reg = await navigator.serviceWorker.ready;
  for (const a of nuevos) {
    await reg.showNotification('¿Olvidaste checar salida?', {
      body: a.texto, tag: `salida-${fecha}-${a.bloque}`, icon: 'assets/icon-192.png', badge: 'assets/favicon-32.png',
      lang: 'es-MX', data: { url: './#inicio' }
    });
  }
  await guardarMeta('recordatorios', { miembroId, fecha, bloques: [...avisados, ...nuevos.map((a) => a.bloque)] });
  return nuevos.map((a) => a.bloque);
}
