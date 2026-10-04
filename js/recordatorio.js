// Recordatorio de salida (HU-15): notificación del teléfono si un bloque sigue abierto después de su hora de fin
// más config.recordatorio_salida_min (30 por omisión). Funciona con la app abierta (también en segundo plano mientras
// el navegador la mantenga viva); con la app cerrada llegará con Web Push (Sprint 4). El aviso dentro de la app
// (alerta "¿Olvidaste checar salida?") siempre se muestra, haya o no permiso de notificaciones.
// Un solo aviso por bloque y por día (se recuerda en el teléfono).
// Con la app cerrada (HU-15b): el teléfono se registra para Web Push y la función `avisos` de Supabase manda el mismo
// aviso (misma etiqueta: si llegan los dos, el teléfono muestra uno solo).
import { leerMeta, guardarMeta, borrarMeta } from './almacen.js';
import * as api from './api.js';

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

// ---------- Web Push: avisos con la app cerrada (HU-15b / HU-30) ----------
export function pushDisponible() {
  return typeof window !== 'undefined' && 'PushManager' in window && 'serviceWorker' in navigator;
}

const aBytes = (b64) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

// Registra este teléfono para recibir avisos con la app cerrada. Devuelve 'activo' | 'no_disponible' | 'sin_permiso'.
// Si el teléfono ya estaba registrado para esta persona con la misma llave, no hace nada.
export async function registrarPush(perfil) {
  if (!pushDisponible()) return 'no_disponible';
  if (permiso() !== 'granted') return 'sin_permiso';
  const reg = await navigator.serviceWorker.ready;
  const llave = await api.llavePublicaAvisos();
  const previo = await leerMeta('push_registrado').catch(() => null);
  let sub = await reg.pushManager.getSubscription();
  if (sub && previo?.llave && previo.llave !== llave) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(llave) });
  if (previo?.endpoint === sub.endpoint && previo.miembroId === perfil.miembroId && previo.llave === llave) return 'activo';
  await api.registrarSuscripcion(perfil.miembroId, sub);
  await guardarMeta('push_registrado', { miembroId: perfil.miembroId, endpoint: sub.endpoint, llave });
  return 'activo';
}

// Al cerrar sesión: este teléfono deja de recibir avisos de esta persona
export async function quitarPush() {
  await borrarMeta('push_registrado').catch(() => {});
  if (!pushDisponible()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.quitarSuscripcion(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export async function pushRegistrado(perfil) {
  const previo = await leerMeta('push_registrado').catch(() => null);
  return previo?.miembroId === perfil.miembroId;
}
