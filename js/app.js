// Arranque de la app del asesor: sesión, pestañas, fecha del día y service worker.
import { CONFIG } from '../config.js';
import * as sesion from './sesion.js';
import * as sitios from './sitios.js';
import * as jornada from './jornada.js';
import * as checada from './checada.js';
import * as cola from './cola.js';
import { calcularEstado, resumenDelDia, formatoHoras } from './reglas.js';

const VISTAS = ['inicio', 'visitas', 'historial', 'perfil'];
const TITULOS = { inicio: 'Hola', visitas: 'Visitas a parques', historial: 'Historial', perfil: 'Perfil' };
const PANTALLAS = ['cargando', 'acceso', 'organizacion', 'app', 'checada'];
const ROLES = { asesor: 'Asesoría', coordinador: 'Coordinación', admin: 'Administración' };
const $ = (id) => document.getElementById(id);

const estado = { perfil: null, membresias: [], sinConexion: false, recienEntro: false };

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
      mostrarPantalla('app');
      sincronizarSitios({ forzar: estado.recienEntro }).then(pintarJornada);
      enviarPendientes();
      pintarJornada();
      estado.recienEntro = false;
      return;
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
    estado.recienEntro = true;   // al iniciar sesión se descarga el catálogo de sitios
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
    $('catalogo-buscar').value = '';
    $('catalogo-resultados').replaceChildren();
    location.hash = '';
    mostrarAcceso();
  };
  $('perfil-salir').addEventListener('click', salir);
  $('organizacion-salir').addEventListener('click', salir);
  $('perfil-cambiar-org').addEventListener('click', async () => {
    await sesion.olvidarOrganizacion();
    mostrarSelector(estado.membresias);
  });
  // Al volver la señal se confirma que la persona sigue activa (y se revisa el catálogo de sitios).
  window.addEventListener('online', () => { if (estado.perfil) revisarSesion(); });
  // Al volver a la app: si cambió el día, se descarga de nuevo el catálogo.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && estado.perfil) { sincronizarSitios(); enviarPendientes(); pintarJornada(); }
  });
  $('catalogo-actualizar').addEventListener('click', () => sincronizarSitios({ forzar: true }));
  $('boton-principal').addEventListener('click', () => {
    const b = $('boton-principal');
    iniciarChecada(b.dataset.accion, b.dataset.bloque || null);
  });
  window.addEventListener('online', () => enviarPendientes());
  let espera;
  $('catalogo-buscar').addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(pintarBusqueda, 120);
  });
}

// ---------- Jornada de hoy: estado y botón principal (HU-12) ----------
const ETIQUETA_CALIFICACION = { en_regla: ['En regla', 'chip--ok'], retardo: ['Retardo', 'chip--aviso'], revisar: ['Revisar', 'chip--critico'] };
const ETIQUETA_FILA = {
  cerrado: ['Cerrado', 'chip--ok'], abierto: ['En curso', 'chip--aviso'], pendiente: ['Pendiente', 'chip--aviso'],
  cerrada: ['Pausa', ''], abierta: ['En pausa', 'chip--aviso']
};

function horaLocal(iso) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: zonaHoraria(), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

function filaJornada(f) {
  const li = document.createElement('li');
  li.className = 'lista__fila';
  li.dataset.fila = f.tipo === 'bloque' ? f.bloque : 'pausa';
  const izq = document.createElement('div');
  const titulo = document.createElement('p');
  titulo.className = 'lista__titulo';
  const detalle = document.createElement('p');
  detalle.className = 'lista__detalle';
  // Solo las horas van en letra monoespaciada
  const horas = (texto) => { const m = document.createElement('span'); m.className = 'mono'; m.textContent = texto; return m; };
  const rango = (ini, fin) => [horas(ini), ' – ', fin ? horas(fin) : 'en curso'];
  if (f.tipo === 'bloque') {
    titulo.textContent = `Bloque ${f.bloque}`;
    const lugar = f.modalidad === 'teletrabajo' ? 'Teletrabajo · ' : '';
    if (f.inicio) detalle.append(lugar, ...rango(horaLocal(f.inicio), f.fin && horaLocal(f.fin)));
    else detalle.append('Programado ', ...rango(f.programado.inicio, f.programado.fin));
  } else {
    titulo.textContent = 'Comida/pausa';
    detalle.append(...rango(horaLocal(f.inicio), f.fin && horaLocal(f.fin)));
  }
  izq.append(titulo, detalle);
  const [texto, clase] = ETIQUETA_FILA[f.estado];
  const chip = document.createElement('span');
  chip.className = `chip ${clase}`.trim();
  chip.textContent = texto;
  li.append(izq, chip);
  return li;
}

const ACCIONES_ACTIVAS = ['inicio_bloque', 'fin_bloque'];

async function iniciarChecada(accion, bloque) {
  if (!estado.dia || estado.checando) return;
  estado.checando = true;
  try {
    await checada.abrir({
      perfil: estado.perfil, estadoDia: estado.dia.e, eventos: estado.dia.eventos, horario: estado.dia.horario,
      accion, bloque, mostrarPantalla,
      alTerminar: () => { mostrarPantalla('app'); pintarJornada(); }
    });
  } finally {
    estado.checando = false;
  }
}

async function enviarPendientes() {
  if (!estado.perfil) return;
  const enviados = await cola.enviarPendientes();
  if (enviados) pintarJornada();
}

let pintando = null;
let repintar = false;
async function pintarJornada() {
  if (!estado.perfil) return;
  // Si ya se está pintando, se repite al terminar (p. ej. llegó el catálogo con los nombres de los parques).
  if (pintando) { repintar = true; return pintando; }
  pintando = (async () => {
    const perfil = estado.perfil;
    const ahora = new Date();
    const zona = zonaHoraria();
    const config = perfil.organizacion.config;
    const { horario, eventos } = await jornada.cargarHoy(perfil, ahora);
    if (estado.perfil !== perfil) return;
    const e = calcularEstado({ eventos, horario, ahora, zona, config });
    const r = resumenDelDia({ eventos, horario, ahora, zona, config });
    estado.dia = { e, r, horario, eventos };

    // Tarjeta "Jornada de hoy"
    pintarFecha();
    $('horas-hoy').textContent = formatoHoras(r.minutosEfectivos);
    $('barra-hoy').style.width = r.minutosProgramados ? `${Math.min(100, (r.minutosEfectivos / r.minutosProgramados) * 100)}%` : '0';
    $('horas-programadas').textContent = r.minutosProgramados ? `de ${formatoHoras(r.minutosProgramados)} h programadas` : 'Sin horario cargado para hoy';
    const chip = $('calificacion-hoy');
    chip.hidden = eventos.length === 0;
    const [txt, clase] = ETIQUETA_CALIFICACION[r.calificacion];
    chip.textContent = txt;
    chip.className = `chip horas__chip ${clase}`;
    const lista = $('lista-bloques');
    if (r.filas.length) lista.replaceChildren(...r.filas.map(filaJornada));
    else {
      const li = document.createElement('li');
      li.className = 'lista__fila';
      li.innerHTML = '<span class="secundario">Sin bloques programados ni registrados hoy</span>';
      lista.replaceChildren(li);
    }

    // Alertas
    $('alertas-jornada').replaceChildren(...e.alertas.map((a) => {
      const div = document.createElement('div');
      div.className = 'aviso';
      div.setAttribute('role', 'alert');
      div.dataset.alerta = a.tipo;
      div.textContent = a.texto;
      return div;
    }));

    // Botón principal y acciones secundarias (la checada llega con HU-17)
    const boton = $('boton-principal');
    boton.hidden = !e.boton;
    $('jornada-cerrada').hidden = e.estado !== 'jornada_cerrada';
    if (e.boton) {
      boton.dataset.accion = e.boton.accion;
      boton.dataset.bloque = e.boton.bloque || '';
      $('boton-principal-texto').textContent = e.boton.texto;
      $('boton-principal-detalle').textContent = e.boton.detalle || '';
    }
    // Activas en este sprint: iniciar y terminar bloque (HU-17). Pausas (HU-13) y visitas (HU-24) llegan después.
    boton.disabled = !(e.boton && ACCIONES_ACTIVAS.includes(e.boton.accion));
    $('acciones-secundarias').replaceChildren(...e.secundarias.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'boton boton--ancho';
      b.dataset.accion = s.accion;
      b.textContent = s.texto;
      b.disabled = !ACCIONES_ACTIVAS.includes(s.accion);
      if (!b.disabled) b.addEventListener('click', () => iniciarChecada(s.accion, s.bloque));
      return b;
    }));
    const { porEnviar, conError } = await cola.contarPendientes(perfil.miembroId);
    const avisoPend = $('aviso-pendientes');
    avisoPend.hidden = !porEnviar && !conError;
    avisoPend.textContent = [
      porEnviar ? `${porEnviar} ${porEnviar === 1 ? 'checada guardada' : 'checadas guardadas'} en el teléfono, por enviar.` : '',
      conError ? `${conError} con error: avisa a coordinación.` : ''
    ].filter(Boolean).join(' ');
    document.body.dataset.estadoJornada = e.estado;
  })().finally(() => {
    pintando = null;
    if (repintar) { repintar = false; pintarJornada(); }
  });
  return pintando;
}

// ---------- Catálogo de sitios (HU-10) ----------
const TIPOS_SITIO = { parque: 'Parque', oficina: 'Oficina', domicilio: 'Domicilio', otro: 'Otro sitio' };
let sincronizando = null;

function cuando(iso) {
  const zona = zonaHoraria();
  const d = new Date(iso);
  const dia = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(x);
  const hora = new Intl.DateTimeFormat('es-MX', { timeZone: zona, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  if (dia(d) === dia(new Date())) return `hoy a las ${hora}`;
  if (dia(d) === dia(new Date(Date.now() - 864e5))) return `ayer a las ${hora}`;
  return `el ${new Intl.DateTimeFormat('es-MX', { timeZone: zona, day: 'numeric', month: 'short' }).format(d).replace(/\./g, '')} a las ${hora}`;
}

async function pintarCatalogo(resultado) {
  const meta = await sitios.estado();
  const vigente = meta && meta.organizacionId === estado.perfil?.organizacionId;
  let texto;
  if (vigente) {
    const filas = await sitios.todos(meta.organizacionId);
    const parques = filas.filter((f) => f.tipo === 'parque').length;
    const otros = filas.length - parques;
    texto = `${parques} parques guardados${otros ? ` y ${otros} ${otros === 1 ? 'sitio' : 'sitios'} más` : ''} · actualizado ${cuando(meta.descargados)}`;
    if (resultado?.error) texto = `Sin señal: se usa la copia guardada (${parques} parques, actualizada ${cuando(meta.descargados)}).`;
  } else {
    texto = resultado?.error
      ? 'No se pudieron descargar los parques. Se intentará de nuevo al tener señal.'
      : 'Aún no se descargan los parques.';
  }
  $('catalogo-estado').textContent = texto;
}

async function sincronizarSitios({ forzar = false } = {}) {
  if (!estado.perfil) return;
  if (sincronizando) return sincronizando;
  const boton = $('catalogo-actualizar');
  sincronizando = (async () => {
    if (forzar || await sitios.haceFalta(estado.perfil)) {
      boton.disabled = true;
      $('catalogo-estado').textContent = 'Descargando parques…';
    }
    const r = await sitios.actualizar(estado.perfil, { forzar });
    await pintarCatalogo(r);
    if ($('catalogo-buscar').value) await pintarBusqueda();
  })().finally(() => { sincronizando = null; boton.disabled = false; });
  return sincronizando;
}

async function pintarBusqueda() {
  const texto = $('catalogo-buscar').value;
  const lista = $('catalogo-resultados');
  if (!texto.trim() || !estado.perfil) return lista.replaceChildren();
  const encontrados = await sitios.buscar(estado.perfil.organizacionId, texto);
  if (!encontrados.length) {
    const li = document.createElement('li');
    li.className = 'lista__fila secundario';
    li.textContent = `Sin resultados para “${texto.trim()}”.`;
    return lista.replaceChildren(li);
  }
  lista.replaceChildren(...encontrados.map((s) => {
    const li = document.createElement('li');
    li.className = 'lista__fila';
    li.dataset.sitio = s.id;
    const izq = document.createElement('div');
    const titulo = document.createElement('p');
    titulo.className = 'lista__titulo';
    titulo.textContent = s.nombre;
    const detalle = document.createElement('p');
    detalle.className = 'lista__detalle';
    detalle.textContent = [s.tipo !== 'parque' ? TIPOS_SITIO[s.tipo] : null, s.colonia].filter(Boolean).join(' · ') || ' ';
    izq.append(titulo, detalle);
    const clave = document.createElement('span');
    clave.className = 'sitio__clave';
    clave.textContent = s.clave || '';
    li.append(izq, clave);
    return li;
  }));
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

// Cada minuto se recalcula el estado (las alertas y las horas dependen de la hora).
setInterval(() => {
  if (estado.perfil && document.visibilityState === 'visible' && !estado.checando) { enviarPendientes(); pintarJornada(); }
}, 60_000);

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
