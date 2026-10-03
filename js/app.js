// Arranque de la app del asesor: pestañas, fecha del día y service worker.
import { CONFIG } from '../config.js';

const VISTAS = ['inicio', 'visitas', 'historial', 'perfil'];
const TITULOS = { inicio: 'Hola', visitas: 'Visitas a parques', historial: 'Historial', perfil: 'Perfil' };
const $ = (id) => document.getElementById(id);

// ---------- Pestañas (ruteo por #hash) ----------
function mostrarVista() {
  const actual = VISTAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'inicio';
  for (const v of VISTAS) $(`vista-${v}`).hidden = v !== actual;
  for (const a of document.querySelectorAll('[data-pestana]')) {
    if (a.dataset.pestana === actual) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  $('titulo-vista').textContent = TITULOS[actual];
}

// ---------- Fecha de hoy en la zona horaria del negocio ----------
function pintarFecha() {
  $('fecha-hoy').textContent = new Intl.DateTimeFormat('es-MX', {
    timeZone: CONFIG.ZONA_HORARIA, weekday: 'short', day: 'numeric', month: 'short'
  }).format(new Date()).replace(/\./g, '');
}

// ---------- Service worker y aviso de versión nueva ----------
async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('./sw.js');
  const avisar = (sw) => {
    $('aviso-actualizacion').hidden = false;
    $('boton-actualizar').onclick = () => sw.postMessage({ tipo: 'ACTIVAR' });
  };
  if (reg.waiting && navigator.serviceWorker.controller) avisar(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const nuevo = reg.installing;
    nuevo?.addEventListener('statechange', () => {
      if (nuevo.state === 'installed' && navigator.serviceWorker.controller) avisar(nuevo);
    });
  });
  // Recarga solo cuando la persona eligió actualizar (nunca a media checada).
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando || $('aviso-actualizacion').hidden) return;
    recargando = true;
    location.reload();
  });
}

function iniciar() {
  $('version-app').textContent = CONFIG.VERSION_APP;
  pintarFecha();
  mostrarVista();
  window.addEventListener('hashchange', mostrarVista);
  registrarServiceWorker().catch((e) => console.warn('Service worker no registrado', e));
}

iniciar();
