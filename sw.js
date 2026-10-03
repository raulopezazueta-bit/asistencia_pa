// Service worker de la App de Asistencia.
// Guarda el "cascarón" de la app en el teléfono para que abra sin señal (cache-first).
// Los datos (Supabase) NUNCA se guardan aquí: van por red y, sin señal, por la cola de IndexedDB.
//
// Historial de versiones (una línea por versión):
// asis-2026-10-03-v01 · T-01 esqueleto PWA: pestañas, tokens de marca, fuentes IBM Plex locales, íconos y modo sin señal del cascarón.
// asis-2026-10-03-v02 · HU-08 inicio de sesión: correo y contraseña, sesión persistente (también sin señal), aviso sin alta y selector de organización.
// asis-2026-10-03-v03 · HU-07 prueba e2e de separación entre organizaciones (app → PostgREST → RLS); sin cambios visibles.
// asis-2026-10-03-v04 · HU-10 catálogo de parques en el teléfono: descarga al iniciar sesión y una vez al día, búsqueda sin señal.

const CACHE_VERSION = 'asis-2026-10-03-v04';

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
