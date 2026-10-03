// Arranque de la app del asesor: sesión, pestañas, fecha del día y service worker.
import { CONFIG } from '../config.js';
import * as sesion from './sesion.js';

const VISTAS = ['inicio', 'visitas', 'historial', 'perfil'];
const TITULOS = { inicio: 'Hola', visitas: 'Visitas a parques', historial: 'Historial', perfil: 'Perfil' };
const PANTALLAS = ['cargando', 'acceso', 'organizacion', 'app'];
const ROLES = { asesor: 'Asesoría', coordinador: 'Coordinación', admin: 'Administración' };
const $ = (id) => document.getElementById(id);

const estado = { perfil: null, membresias: [], sinConexion: false };

// ---------- Pantallas y pestañas ----------
function mostrarPantalla(nombre) {
  for (const p of PANTALLAS) $(`pantalla-${p}`).hidden = p !== nombre;
}

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
function zonaHoraria() {
  return estado.perfil?.organizacion.zonaHoraria || CONFIG.ZONA_HORARIA;
}
function pintarFecha() {
  $('fecha-hoy').textContent = new Intl.DateTimeFormat('es-MX', {
    timeZone: zonaHoraria(), weekday: 'short', day: 'numeric', month: 'short'
  }).format(new Date()).replace(/\./g, '');
}

// ---------- Sesión (HU-08) ----------
function iniciales(nombre) {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

function pintarPerfil(correo) {
  const p = estado.perfil;
  const primerNombre = p.nombre.split(/\s+/)[0];
  TITULOS.inicio = `Hola, ${primerNombre}`;
  $('org-nombre').textContent = p.organizacion.nombre;
  $('avatar').textContent = iniciales(p.nombre);
  $('perfil-nombre').textContent = p.nombre;
  $('perfil-organizacion').textContent = p.organizacion.nombre;
  $('perfil-rol').textContent = ROLES[p.rol] || p.rol;
  $('perfil-correo').textContent = correo || '—';
  $('perfil-cambiar-org').hidden = estado.membresias.length < 2;
  $('aviso-sin-conexion').hidden = !estado.sinConexion;
  $('boton-principal').disabled = true;
  $('boton-principal-texto').textContent = 'La checada llega en la siguiente versión';
  pintarFecha();
  mostrarVista();
}

function mostrarAcceso(mensaje) {
  const error = $('acceso-error');
  error.textContent = mensaje || '';
  error.hidden = !mensaje;
  $('acceso-contrasena').value = '';
  mostrarPantalla('acceso');
}

function mostrarSelector(membresias) {
  const lista = $('lista-organizaciones');
  lista.replaceChildren(...membresias.map((m) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcion';
    b.dataset.organizacion = m.organizacionId;
    const t = document.createElement('span');
    t.className = 'opcion__titulo';
    t.textContent = m.organizacion.nombre;
    const d = document.createElement('span');
    d.className = 'opcion__detalle';
    d.textContent = `${ROLES[m.rol] || m.rol} · ${m.nombre}`;
    b.append(t, d);
    b.addEventListener('click', async () => {
      await sesion.elegirOrganizacion(m.organizacionId);
      await aplicar(await sesion.resolver());
    });
    li.append(b);
    return li;
  }));
  mostrarPantalla('organizacion');
}

async function aplicar(r) {
  switch (r.estado) {
    case 'sin_sesion': return mostrarAcceso();
    case 'sin_alta': return mostrarAcceso(sesion.MENSAJE_SIN_ALTA);
    case 'elegir': return mostrarSelector(r.membresias);
    case 'lista':
      Object.assign(estado, { perfil: r.perfil, membresias: r.membresias, sinConexion: r.sinConexion });
      pintarPerfil(r.correo);
      return mostrarPantalla('app');
  }
}

async function revisarSesion() {
  try {
    await aplicar(await sesion.resolver());
  } catch (e) {
    console.warn('No se pudo verificar la sesión', e);
    mostrarAcceso('No se pudo verificar tu cuenta. Revisa tu señal e intenta de nuevo.');
  }
}

function conectarFormularios() {
  $('form-acceso').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const correo = $('acceso-correo').value;
    const contrasena = $('acceso-contrasena').value;
    if (!correo.trim() || !contrasena) return mostrarAcceso('Escribe tu correo y tu contraseña.');
    const boton = $('acceso-entrar');
    boton.disabled = true;
    boton.textContent = 'Entrando…';
    try {
      await aplicar(await sesion.entrar(correo, contrasena));
    } catch (e) {
      mostrarAcceso(sesion.mensajeDeError(e));
    } finally {
      boton.disabled = false;
      boton.textContent = 'Entrar';
    }
  });
  $('acceso-ver').addEventListener('click', () => {
    const campo = $('acceso-contrasena');
    const ver = campo.type === 'password';
    campo.type = ver ? 'text' : 'password';
    $('acceso-ver').textContent = ver ? 'Ocultar' : 'Ver';
    $('acceso-ver').setAttribute('aria-pressed', String(ver));
  });
  const salir = async () => {
    await sesion.salir();
    estado.perfil = null;
    location.hash = '';
    mostrarAcceso();
  };
  $('perfil-salir').addEventListener('click', salir);
  $('organizacion-salir').addEventListener('click', salir);
  $('perfil-cambiar-org').addEventListener('click', async () => {
    await sesion.olvidarOrganizacion();
    mostrarSelector(estado.membresias);
  });
  // Al volver la señal se confirma que la persona sigue activa.
  window.addEventListener('online', () => { if (estado.perfil) revisarSesion(); });
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
  conectarFormularios();
  registrarServiceWorker().catch((e) => console.warn('Service worker no registrado', e));
  revisarSesion();
}

iniciar();
