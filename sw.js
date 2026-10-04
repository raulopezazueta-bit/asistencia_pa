// Service worker de la App de Asistencia.
// Guarda el "cascarón" de la app en el teléfono para que abra sin señal (cache-first).
// Los datos (Supabase) NUNCA se guardan aquí: van por red y, sin señal, por la cola de IndexedDB.
//
// Historial de versiones (una línea por versión):
// asis-2026-10-03-v01 · T-01 esqueleto PWA: pestañas, tokens de marca, fuentes IBM Plex locales, íconos y modo sin señal del cascarón.
// asis-2026-10-03-v02 · HU-08 inicio de sesión: correo y contraseña, sesión persistente (también sin señal), aviso sin alta y selector de organización.
// asis-2026-10-03-v03 · HU-07 prueba e2e de separación entre organizaciones (app → PostgREST → RLS); sin cambios visibles.
// asis-2026-10-03-v04 · HU-10 catálogo de parques en el teléfono: descarga al iniciar sesión y una vez al día, búsqueda sin señal.
// asis-2026-10-03-v05 · HU-12 estado del día: botón principal según la jornada, bloques del día, horas efectivas, alertas de olvido.
// asis-2026-10-03-v06 · HU-17 checada con GPS y geocerca: lectura de ubicación al checar, zona en el teléfono, justificación fuera de zona y envío seguro (sin señal se guarda en el teléfono).
// asis-2026-10-03-v07 · HU-09a guía de alta de personas (docs/ALTA_PERSONAS.md) con su prueba SQL; sin cambios visibles.
// asis-2026-10-03-v08 · HU-18 selfie de evidencia (sin reconocimiento facial): cámara frontal, vista previa, ≤ 60 KB, respaldo con la cámara del teléfono y envío junto con la checada.
// asis-2026-10-03-v09 · HU-22 cola sin señal completa: reintentos escalonados, envío en segundo plano (Background Sync), indicador "Todo enviado / N por enviar", limpieza a 35 días.
// asis-2026-10-03-v10 · HU-19 hora doble: aviso si el reloj del teléfono difiere del servidor más que umbral_desfase_min (medido al iniciar sesión y en cada renovación).
// asis-2026-10-03-v11 · HU-13 pausas: inicio y regreso de comida/pausa, terminar bloque o iniciar el siguiente desde la pausa con confirmación.
// asis-2026-10-03-v12 · HU-20 teletrabajo (modalidad desde horarios; con validar_domicilio solo cuenta el domicilio propio) y pausas sin revisión de zona (requiere migración 0002).
// asis-2026-10-03-v13 · HU-33 inalterabilidad verificada: pruebas de que nadie puede editar ni borrar eventos, bitácora ni selfies; sin cambios visibles.
// asis-2026-10-04-v14 · HU-14 mis horas: horas del día y de la semana (vista oficial del servidor + checadas aún en el teléfono).
// asis-2026-10-04-v15 · HU-12b jornada de lunes a viernes: los días sin horario (sábado) son "actividad fuera de horario".
// asis-2026-10-04-v16 · HU-24 visitas a parques: llegada (GPS o elegida del catálogo), salida, cambio de parque y recorrido del día en Visitas.
// asis-2026-10-04-v17 · HU-28/29 incidencias: el asesor solicita corrección (olvido, hora, fuera de zona, otro) y coordinación aprueba o rechaza en panel.html (requiere migración 0003).
// asis-2026-10-04-v18 · HU-27 panel de coordinación: tarjetas del día (en jornada, % dentro de zona, incidencias, parques) y tabla por persona.
// asis-2026-10-04-v19 · HU-23 bandeja de revisión: checadas marcadas con motivos, lugar y selfie (enlace de 60 s); coordinación valida u observa (requiere migración 0004).
// asis-2026-10-04-v20 · HU-31 reportes: página para la autoridad (imprimir o guardar PDF) por periodo y persona, y CSV para nómina desde el panel.
// asis-2026-10-04-v21 · HU-16 mi registro: la persona consulta su historial por periodo, lo imprime o guarda en PDF, lo descarga en CSV y ve sus checadas observadas.

const CACHE_VERSION = 'asis-2026-10-04-v21';

const CASCARON = [
  './',
  './index.html',
  './manifest.json',
  './config.js',
  './css/app.css',
  './js/app.js',
  './js/api.js',
  './js/almacen.js',
  './js/sesion.js',
  './js/sitios.js',
  './js/reglas.js',
  './js/jornada.js',
  './js/geo.js',
  './js/cola.js',
  './js/checada.js',
  './js/camara.js',
  './js/reloj.js',
  './js/horas.js',
  './js/incidencias.js',
  './js/correccion.js',
  './panel.html',
  './js/panel.js',
  './js/tablero.js',
  './js/bandeja.js',
  './reporte.html',
  './css/reporte.css',
  './js/reporte.js',
  './js/reporte_datos.js',
  './js/reporte_pagina.js',
  './vendor/supabase.js',
  './fonts/ibm-plex-sans-latin-400-normal.woff2',
  './fonts/ibm-plex-sans-latin-500-normal.woff2',
  './fonts/ibm-plex-sans-latin-600-normal.woff2',
  './fonts/ibm-plex-mono-latin-400-normal.woff2',
  './fonts/ibm-plex-mono-latin-500-normal.woff2',
  './assets/icon-192.png',
  './assets/icon-512-fondo.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './assets/favicon-32.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(CASCARON.map((u) => new Request(u, { cache: 'reload' })))));
  // Primera instalación: activar de inmediato. Actualizaciones: esperar a que la persona toque "Actualizar".
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const nombre of await caches.keys()) if (nombre !== CACHE_VERSION) await caches.delete(nombre);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.tipo === 'ACTIVAR') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase y cualquier otro origen: directo a la red

  e.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const guardada = await cache.match(req, { ignoreSearch: true });
    if (guardada) return guardada;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') return cache.match('./index.html');
      throw err;
    }
  })());
});

// ---------- Background Sync (HU-22): enviar pendientes con la app cerrada (Chrome/Android) ----------
// Mismo orden y mismas reglas que js/cola.js: primero la selfie, luego el evento con upsert sin duplicar.
// Si la sesión guardada ya venció, no se intenta: la app lo enviará al abrirse (y renovará la sesión).
const ETIQUETA_SYNC = 'enviar-pendientes';

// Un solo envío a la vez: el navegador puede disparar varios "sync" seguidos al volver la señal.
let envioSW = null;
self.addEventListener('sync', (e) => {
  if (e.tag !== ETIQUETA_SYNC) return;
  envioSW = envioSW || enviarPendientesSW().finally(() => { envioSW = null; });
  e.waitUntil(envioSW);
});

function abrirAlmacen() {
  return new Promise((ok, falla) => {
    const req = indexedDB.open('asistencia', 1);
    req.onupgradeneeded = () => {
      for (const t of ['eventos_pendientes', 'eventos_locales', 'sitios']) {
        if (!req.result.objectStoreNames.contains(t)) req.result.createObjectStore(t, { keyPath: 'id' });
      }
      if (!req.result.objectStoreNames.contains('meta')) req.result.createObjectStore('meta');
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falla(req.error);
  });
}
function operar(db, tienda, modo, accion) {
  return new Promise((ok, falla) => {
    const req = accion(db.transaction(tienda, modo).objectStore(tienda));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falla(req.error);
  });
}

async function enviarPendientesSW() {
  const db = await abrirAlmacen();
  const sesion = await operar(db, 'meta', 'readonly', (t) => t.get('sesion_sw'));
  const miembros = (await operar(db, 'meta', 'readonly', (t) => t.get('miembros_sw'))) || [];
  if (!sesion || sesion.expira * 1000 < Date.now() + 30_000) return;
  const pendientes = (await operar(db, 'eventos_pendientes', 'readonly', (t) => t.getAll()))
    .filter((p) => p.estado !== 'soporte' && miembros.includes(p.miembroId))
    .sort((a, b) => a.evento.hora_dispositivo.localeCompare(b.evento.hora_dispositivo));
  const base = { apikey: sesion.llave, authorization: `Bearer ${sesion.token}` };
  let enviados = 0;
  for (const p of pendientes) {
    if (p.selfieBlob && p.evento.selfie_path) {
      const r = await fetch(`${sesion.url}/storage/v1/object/selfies/${p.evento.selfie_path}`, {
        method: 'POST', body: p.selfieBlob,
        headers: { ...base, 'content-type': p.selfieBlob.type, 'x-upsert': 'false', 'cache-control': 'max-age=31536000' }
      });
      if (!r.ok) {
        const cuerpo = await r.json().catch(() => ({}));
        const yaExiste = String(cuerpo.statusCode) === '409' || /exists|duplicate/i.test(cuerpo.message || '');
        if (!yaExiste) { await marcarError(db, p, r.status, cuerpo.message); if (r.status === 401 || r.status >= 500) break; continue; }
      }
    }
    const r = await fetch(`${sesion.url}/rest/v1/eventos_jornada?on_conflict=id`, {
      method: 'POST', body: JSON.stringify(p.evento),
      headers: { ...base, 'content-type': 'application/json', prefer: 'resolution=ignore-duplicates,return=minimal' }
    });
    if (!r.ok) {
      const cuerpo = await r.json().catch(() => ({}));
      await marcarError(db, p, r.status, cuerpo.message);
      if (r.status === 401 || r.status >= 500) break;
      continue;
    }
    await operar(db, 'eventos_pendientes', 'readwrite', (t) => t.delete(p.id));
    const local = await operar(db, 'eventos_locales', 'readonly', (t) => t.get(p.id));
    if (local) await operar(db, 'eventos_locales', 'readwrite', (t) => t.put({ ...local, enviado: true }));
    enviados++;
  }
  if (enviados) for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage({ tipo: 'PENDIENTES_ENVIADOS', enviados });
}

// 401 (sesión vencida) y 5xx: se reintentará más tarde. Otros rechazos (permisos/validación): a soporte.
async function marcarError(db, p, estatus, mensaje) {
  const soporte = estatus !== 401 && estatus < 500;
  await operar(db, 'eventos_pendientes', 'readwrite', (t) => t.put({ ...p, intentos: p.intentos + 1,
    ultimoError: `${estatus} ${mensaje || ''}`.trim(), estado: soporte ? 'soporte' : 'pendiente' }));
}
