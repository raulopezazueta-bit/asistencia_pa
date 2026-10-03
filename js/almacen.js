// Almacén local en IndexedDB (base "asistencia"). Lo usan la sesión, la caché de sitios y la cola offline.
// Tiendas (ver docs/ESPECIFICACION.md §5): eventos_pendientes, eventos_locales, sitios, meta.

const NOMBRE = 'asistencia';
const VERSION = 1;
let conexion = null;

function abrir() {
  if (conexion) return conexion;
  conexion = new Promise((resolver, rechazar) => {
    const req = indexedDB.open(NOMBRE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('eventos_pendientes')) db.createObjectStore('eventos_pendientes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('eventos_locales')) db.createObjectStore('eventos_locales', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sitios')) db.createObjectStore('sitios', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolver(req.result);
    req.onerror = () => { conexion = null; rechazar(req.error); };
  });
  return conexion;
}

function promesa(req) {
  return new Promise((resolver, rechazar) => {
    req.onsuccess = () => resolver(req.result);
    req.onerror = () => rechazar(req.error);
  });
}

async function tienda(nombre, modo = 'readonly') {
  return (await abrir()).transaction(nombre, modo).objectStore(nombre);
}

// ---------- meta (clave → valor) ----------
export async function leerMeta(clave) {
  return promesa((await tienda('meta')).get(clave));
}
export async function guardarMeta(clave, valor) {
  return promesa((await tienda('meta', 'readwrite')).put(valor, clave));
}
export async function borrarMeta(clave) {
  return promesa((await tienda('meta', 'readwrite')).delete(clave));
}

// ---------- utilidades genéricas ----------
export async function leerTodo(nombre) {
  return promesa((await tienda(nombre)).getAll());
}
export async function reemplazarTodo(nombre, filas) {
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(nombre, 'readwrite');
    const t = tx.objectStore(nombre);
    t.clear();
    for (const f of filas) t.put(f);
    tx.oncomplete = () => resolver(filas.length);
    tx.onerror = () => rechazar(tx.error);
  });
}
