// Arranque de la app del asesor: sesión, pestañas, fecha del día y service worker.
import { CONFIG } from '../config.js';
import * as sesion from './sesion.js';
import * as sitios from './sitios.js';
import * as jornada from './jornada.js';
import * as checada from './checada.js';
import * as cola from './cola.js';
import { guardarMeta } from './almacen.js';
import * as reloj from './reloj.js';
import * as horas from './horas.js';
import * as correccion from './correccion.js';
import * as incidencias from './incidencias.js';
import { cargarMiRegistro } from './reporte_datos.js';
import { csvNomina } from './reporte.js';
import * as api from './api.js';
import { calcularEstado, resumenDelDia, formatoHoras, recorridoDelDia, partesLocales } from './reglas.js';
import * as recordatorio from './recordatorio.js';

const VISTAS = ['inicio', 'visitas', 'historial', 'perfil'];
const TITULOS = { inicio: 'Hola', visitas: 'Visitas a parques', historial: 'Historial', perfil: 'Perfil' };
const PANTALLAS = ['cargando', 'acceso', 'organizacion', 'app', 'checada', 'correccion'];
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
  $('perfil-panel').hidden = !['coordinador', 'admin'].includes(p.rol);
  pintarRecordatorio();
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
      // Al volver la señal se revisa la sesión: no sacar a la persona de una checada o una solicitud a medias
      if ($('pantalla-checada').hidden && $('pantalla-correccion').hidden) mostrarPantalla('app');
      sincronizarSitios({ forzar: estado.recienEntro }).then(pintarJornada);
      // Datos para que el service worker pueda enviar pendientes con la app cerrada (Background Sync)
      guardarMeta('miembros_sw', r.membresias.map((m) => m.miembroId)).catch(() => {});
      cola.limpiarRegistroLocal().catch(() => {});
      enviarPendientes({ forzar: true });
      pintarJornada();
      pintarSemana();
      pintarSolicitudes();
      if (location.hash === '#historial') pintarObservadas();
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
    if (estado.perfil) {
      const { porEnviar } = await cola.contarPendientes(misMiembros());
      if (porEnviar && !window.confirm(`Tienes ${porEnviar} ${porEnviar === 1 ? 'checada' : 'checadas'} sin enviar. Se quedarán guardadas en este teléfono y se enviarán cuando vuelvas a entrar con tu cuenta. ¿Cerrar sesión?`)) return;
    }
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
    if (document.visibilityState === 'visible' && estado.perfil) { sincronizarSitios(); enviarPendientes(); pintarJornada(); pintarSemana(); pintarSolicitudes(); }
  });
  $('catalogo-actualizar').addEventListener('click', () => sincronizarSitios({ forzar: true }));
  $('historial-solicitar').addEventListener('click', abrirCorreccion);
  conectarMiRegistro();
  $('recordatorio-activar').addEventListener('click', async () => {
    await recordatorio.pedirPermiso();
    pintarRecordatorio();
    if (recordatorio.permiso() === 'granted') pintarJornada();   // si ya hay un bloque olvidado, avisa de inmediato
  });
  $('perfil-solicitar').addEventListener('click', abrirCorreccion);
  $('boton-principal').addEventListener('click', () => {
    const b = $('boton-principal');
    iniciarChecada(b.dataset.accion, b.dataset.bloque || null);
  });
  window.addEventListener('online', () => enviarPendientes({ forzar: true }));
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

// Activas: bloques (HU-17), pausas (HU-13) y visitas a parques (HU-24).
const ACCIONES_ACTIVAS = ['inicio_bloque', 'fin_bloque', 'inicio_pausa', 'fin_pausa', 'llegada_sitio', 'salida_sitio', 'cambio_sitio'];

async function iniciarChecada(accion, bloque) {
  if (!estado.dia || estado.checando) return;
  estado.checando = true;
  try {
    await checada.abrir({
      perfil: estado.perfil, estadoDia: estado.dia.e, eventos: estado.dia.eventos, horario: estado.dia.horario,
      accion, bloque, mostrarPantalla,
      alTerminar: () => { mostrarPantalla('app'); pintarJornada(); pintarSemana(); }
    });
  } finally {
    estado.checando = false;
  }
}

// ---------- Incidencias: solicitar corrección (HU-28) ----------
function abrirCorreccion() {
  if (!estado.perfil || estado.checando) return;
  correccion.abrir({
    perfil: estado.perfil, mostrarPantalla,
    alTerminar: () => { mostrarPantalla('app'); pintarSolicitudes(); }
  });
}

function fechaHoraCorta(iso) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: zonaHoraria(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return `${fechaCorta(p)} · ${horaLocal(iso)}`;
}

let pintandoSolicitudes = null;
async function pintarSolicitudes() {
  if (!estado.perfil) return;
  if (pintandoSolicitudes) return pintandoSolicitudes;
  pintandoSolicitudes = (async () => {
    const perfil = estado.perfil;
    const { filas, sinConexion } = await incidencias.mias(perfil);
    if (estado.perfil !== perfil) return;
    $('solicitudes-lista').replaceChildren(...filas.slice(0, 20).map((i) => {
      const li = document.createElement('li');
      li.className = 'lista__fila';
      li.dataset.incidencia = i.id;
      const izq = document.createElement('div');
      const t = document.createElement('p');
      t.className = 'lista__titulo';
      t.textContent = i.tipo_evento_propuesto ? `${incidencias.TIPOS[i.tipo]} · ${incidencias.nombreChecada(i.tipo_evento_propuesto, i.bloque_propuesto)}` : incidencias.TIPOS[i.tipo];
      const d = document.createElement('p');
      d.className = 'lista__detalle';
      d.textContent = i.hora_propuesta ? `${fechaHoraCorta(i.hora_propuesta)} · ${i.motivo}` : i.motivo;
      izq.append(t, d);
      if (i.comentario_resolucion) {
        const c = document.createElement('p');
        c.className = 'solicitud__comentario';
        c.textContent = `Coordinación: ${i.comentario_resolucion}`;
        izq.append(c);
      }
      const [texto, clase] = incidencias.ESTADOS[i.estado];
      const chip = document.createElement('span');
      chip.className = `chip ${clase}`;
      chip.textContent = texto;
      li.append(izq, chip);
      return li;
    }));
    const nota = sinConexion ? 'Sin señal: se muestra la última información guardada.'
      : filas.length ? '' : 'No has solicitado correcciones.';
    $('solicitudes-nota').textContent = nota;
    $('solicitudes-nota').hidden = !nota;
  })().finally(() => { pintandoSolicitudes = null; });
  return pintandoSolicitudes;
}

// ---------- Mi registro (HU-16) ----------
function periodoMiRegistro() {
  const desde = $('mi-registro-desde').value, hasta = $('mi-registro-hasta').value;
  if (!desde || !hasta) return { error: 'Elige las dos fechas del periodo.' };
  if (desde > hasta) return { error: 'La fecha "Desde" debe ser anterior o igual a "Hasta".' };
  return { desde, hasta };
}

function conectarMiRegistro() {
  const err = $('mi-registro-error');
  const mostrar = (t) => { err.textContent = t || ''; err.hidden = !t; };
  $('form-mi-registro').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const p = periodoMiRegistro();
    if (p.error) return mostrar(p.error);
    if (navigator.onLine === false) return mostrar('Sin señal: para consultar tu registro necesitas conexión.');
    mostrar('');
    location.href = `reporte.html?${new URLSearchParams({ desde: p.desde, hasta: p.hasta, mio: '1' })}`;
  });
  $('mi-registro-csv').addEventListener('click', async () => {
    const p = periodoMiRegistro();
    if (p.error) return mostrar(p.error);
    mostrar('');
    const boton = $('mi-registro-csv');
    boton.disabled = true;
    try {
      const { persona } = await cargarMiRegistro(estado.perfil, p.desde, p.hasta);
      const blob = new Blob([csvNomina([persona], estado.perfil.organizacion.nombre)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mi_registro_${p.desde}_${p.hasta}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      mostrar(api.esErrorDeRed(e) ? 'Sin señal: para descargar tu registro necesitas conexión.' : `No se pudo preparar el archivo: ${e.message}`);
    } finally {
      boton.disabled = false;
    }
  });
}

// Periodo por omisión (del día 1 del mes a hoy) y checadas observadas de los últimos 30 días
let pintandoObservadas = null;
async function pintarObservadas() {
  if (!estado.perfil) return;
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: zonaHoraria() }).format(new Date());
  if (!$('mi-registro-hasta').value) { $('mi-registro-desde').value = `${hoy.slice(0, 8)}01`; $('mi-registro-hasta').value = hoy; }
  if (pintandoObservadas) return pintandoObservadas;
  pintandoObservadas = (async () => {
    const perfil = estado.perfil;
    const d = new Date(`${hoy}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 30);
    try {
      const { observadas } = await cargarMiRegistro(perfil, d.toISOString().slice(0, 10), hoy);
      if (estado.perfil !== perfil) return;
      $('observadas-lista').replaceChildren(...observadas.map(({ evento: e, revision }) => {
        const li = document.createElement('li');
        li.className = 'lista__fila';
        li.dataset.evento = e.id;
        const izq = document.createElement('div');
        const t = document.createElement('p');
        t.className = 'lista__titulo';
        t.textContent = incidencias.nombreChecada(e.tipo, e.bloque);
        const det = document.createElement('p');
        det.className = 'lista__detalle';
        det.textContent = fechaHoraCorta(e.hora_efectiva);
        const c = document.createElement('p');
        c.className = 'solicitud__comentario';
        c.textContent = `Coordinación: ${revision.comentario || 'observada'}`;
        izq.append(t, det, c);
        const chip = document.createElement('span');
        chip.className = 'chip chip--aviso';
        chip.textContent = 'Observada';
        li.append(izq, chip);
        return li;
      }));
      $('observadas').hidden = !observadas.length;
    } catch { /* sin señal: no se muestran */ }
  })().finally(() => { pintandoObservadas = null; });
  return pintandoObservadas;
}

const misMiembros = () => estado.membresias.map((m) => m.miembroId);

async function enviarPendientes({ forzar = false } = {}) {
  if (!estado.perfil) return;
  const enviados = await cola.enviarPendientes(misMiembros(), { forzar });
  if (enviados) { pintarJornada(); pintarSemana(); }
  else pintarEnvio();
}

// Indicador fijo del encabezado: "Todo enviado" / "N por enviar" / "N con error"
async function pintarEnvio() {
  if (!estado.perfil) return;
  const { porEnviar, conError } = await cola.contarPendientes(misMiembros());
  const chip = $('indicador-envio');
  if (conError) {
    chip.className = 'chip chip--critico';
    chip.textContent = `${conError} con error · avisa a coordinación${porEnviar ? ` · ${porEnviar} por enviar` : ''}`;
  } else if (porEnviar) {
    chip.className = 'chip chip--aviso';
    chip.textContent = `${porEnviar} por enviar`;
  } else {
    chip.className = 'chip chip--ok';
    chip.textContent = 'Todo enviado';
  }
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
    recordatorio.revisar({ alertas: e.alertas, miembroId: perfil.miembroId, fecha: partesLocales(ahora, zona).fecha }).catch(() => {});

    // Tarjeta "Jornada de hoy"
    pintarFecha();
    $('horas-hoy').textContent = formatoHoras(r.minutosEfectivos);
    $('barra-hoy').style.width = r.minutosProgramados ? `${Math.min(100, (r.minutosEfectivos / r.minutosProgramados) * 100)}%` : '0';
    $('horas-programadas').textContent = r.minutosProgramados
      ? `de ${formatoHoras(r.minutosProgramados)} h programadas`
      : 'Hoy no tienes horario: lo que registres cuenta como fuera de horario';
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
    $('jornada-cerrada-titulo').textContent = e.fueraDeHorario ? 'Actividad fuera de horario registrada' : 'Jornada cerrada';
    $('jornada-cerrada-detalle').textContent = e.fueraDeHorario
      ? 'Si vas a hacer otra actividad, iníciala abajo. Si algo quedó mal registrado, solicita una corrección.'
      : 'Si algo quedó mal registrado, solicita una corrección.';
    if (e.boton) {
      boton.dataset.accion = e.boton.accion;
      boton.dataset.bloque = e.boton.bloque || '';
      $('boton-principal-texto').textContent = e.boton.texto;
      $('boton-principal-detalle').textContent = e.boton.detalle || '';
    }
    boton.disabled = !(e.boton && ACCIONES_ACTIVAS.includes(e.boton.accion));
    $('acciones-secundarias').replaceChildren(...e.secundarias.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'boton boton--ancho';
      b.dataset.accion = s.accion;
      b.textContent = s.texto;
      if (s.accion === 'solicitar_correccion') b.addEventListener('click', abrirCorreccion);
      else {
        b.disabled = !ACCIONES_ACTIVAS.includes(s.accion);
        if (!b.disabled) b.addEventListener('click', () => iniciarChecada(s.accion, s.bloque));
      }
      return b;
    }));
    pintarVisitas(e, eventos);
    await pintarEnvio();
    const textoReloj = await reloj.aviso(config);
    $('aviso-reloj').hidden = !textoReloj;
    $('aviso-reloj').textContent = textoReloj || '';
    document.body.dataset.estadoJornada = e.estado;
  })().finally(() => {
    pintando = null;
    if (repintar) { repintar = false; pintarJornada(); }
  });
  return pintando;
}

// ---------- Visitas a parques (HU-24) ----------
function pintarVisitas(e, eventos) {
  const recorrido = recorridoDelDia(eventos);
  $('recorrido-lista').replaceChildren(...recorrido.map((v) => {
    const li = document.createElement('li');
    li.className = 'lista__fila';
    li.dataset.visita = v.sitioId || '';
    const izq = document.createElement('div');
    const t = document.createElement('p');
    t.className = 'lista__titulo';
    t.textContent = v.nombre;
    const d = document.createElement('p');
    d.className = 'lista__detalle mono';
    d.textContent = `${horaLocal(v.llegada)} – ${v.salida ? horaLocal(v.salida) : 'en curso'}${v.clave ? ` · ${v.clave}` : ''}`;
    izq.append(t, d);
    const chip = document.createElement('span');
    chip.className = `chip ${v.enviado ? 'chip--ok' : 'chip--aviso'}`;
    chip.textContent = v.enviado ? 'Enviado' : 'En cola';
    li.append(izq, chip);
    return li;
  }));
  const enCampo = e.bloqueAbierto === 'campo';
  const nota = !enCampo
    ? 'Las visitas a parques se registran durante el bloque de campo.'
    : e.estado === 'en_pausa' ? 'Estás en pausa: regresa de la pausa para registrar visitas.'
      : recorrido.length ? '' : 'Aún no registras llegadas a parques hoy.';
  $('recorrido-nota').textContent = nota;
  $('recorrido-nota').hidden = !nota;
  const acciones = [];
  if (enCampo && e.estado === 'en_bloque') {
    acciones.push(e.enSitio
      ? { accion: 'cambio_sitio', texto: '+ Registrar llegada a otro parque', clase: 'boton boton--ancho' }
      : { accion: 'llegada_sitio', texto: '+ Registrar llegada a parque', clase: 'boton boton--ancho' });
    if (e.enSitio) acciones.push({ accion: 'salida_sitio', texto: `Salir de ${e.enSitio.nombre}`, clase: 'boton boton--ancho' });
    acciones.push({ accion: 'fin_bloque', bloque: 'campo', texto: 'Terminar bloque de campo', clase: 'boton boton--tierra boton--ancho' });
  }
  $('visitas-acciones').replaceChildren(...acciones.map((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = a.clase;
    b.dataset.accion = a.accion;
    b.textContent = a.texto;
    b.addEventListener('click', () => iniciarChecada(a.accion, a.bloque));
    return b;
  }));
}

// ---------- Mis horas: semana (HU-14) ----------
// Fechas cortas armadas a mano: el formato del navegador varía ("28 sep" / "28 de sep").
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const diaMes = (fecha) => { const d = new Date(`${fecha}T12:00:00Z`); return `${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]}`; };
const fechaCorta = (fecha) => `${DIAS_CORTOS[new Date(`${fecha}T12:00:00Z`).getUTCDay()]} ${diaMes(fecha)}`;

let pintandoSemana = null;
async function pintarSemana() {
  if (!estado.perfil) return;
  if (pintandoSemana) return pintandoSemana;
  pintandoSemana = (async () => {
    const perfil = estado.perfil;
    const s = await horas.semana(perfil, new Date());
    if (estado.perfil !== perfil) return;
    $('semana-rango').textContent = `${diaMes(s.dias[0].fecha)} – ${diaMes(s.dias[6].fecha)}`;
    $('semana-total').textContent = formatoHoras(s.total);
    $('semana-barra').style.width = s.totalProgramado ? `${Math.min(100, (s.total / s.totalProgramado) * 100)}%` : '0';
    $('semana-programadas').textContent = s.totalProgramado ? `de ${formatoHoras(s.totalProgramado)} h programadas` : 'Sin horario cargado';
    $('semana-resumen').hidden = false;
    $('semana-resumen').textContent = `Esta semana: ${formatoHoras(s.total)} h${s.totalProgramado ? ` de ${formatoHoras(s.totalProgramado)} h` : ''}`;
    $('semana-dias').replaceChildren(...s.dias.map((d) => {
      const li = document.createElement('li');
      li.className = `lista__fila${d.hoy ? ' dia--hoy' : ''}${d.futuro ? ' dia--futuro' : ''}`;
      li.dataset.fecha = d.fecha;
      const izq = document.createElement('div');
      const t = document.createElement('p');
      t.className = 'lista__titulo';
      t.textContent = d.hoy ? `Hoy · ${fechaCorta(d.fecha)}` : fechaCorta(d.fecha);
      const det = document.createElement('p');
      det.className = 'lista__detalle';
      det.textContent = d.programados ? `de ${formatoHoras(d.programados)} h programadas` : 'Sin horario';
      izq.append(t, det);
      const der = document.createElement('div');
      der.className = 'dia__derecha';
      const chip = (texto, clase) => { const c = document.createElement('span'); c.className = `chip ${clase}`; c.textContent = texto; der.append(c); };
      if (!d.futuro && !d.programados && d.minutos > 0) chip('Fuera de horario', '');
      if (d.porEnviar) chip('Por enviar', 'chip--aviso');
      if (d.abierta && !d.hoy) chip('Sin cerrar', 'chip--aviso');
      if (d.revisar) chip('Revisar', 'chip--critico');
      const h = document.createElement('span');
      h.className = 'dia__horas';
      h.textContent = d.futuro ? '—' : formatoHoras(d.minutos);
      der.append(h);
      li.append(izq, der);
      return li;
    }));
    const notas = [];
    if (s.dias.some((d) => d.porEnviar)) notas.push('"Por enviar": incluye checadas guardadas en el teléfono que aún no llegan al servidor.');
    if (s.dias.some((d) => d.abierta && !d.hoy)) notas.push('"Sin cerrar": un bloque quedó abierto y no suma horas; solicita una corrección.');
    if (s.dias.some((d) => !d.futuro && !d.programados && d.minutos > 0)) notas.push('"Fuera de horario": actividades en días sin horario (p. ej. sábado).');
    if (s.sinConexion) notas.push('Sin señal: se muestra la última información guardada.');
    $('semana-nota').hidden = !notas.length;
    $('semana-nota').textContent = notas.join(' ');
  })().finally(() => { pintandoSemana = null; });
  return pintandoSemana;
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
  // El service worker avisa cuando envió pendientes en segundo plano
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data?.tipo === 'PENDIENTES_ENVIADOS') { pintarJornada(); pintarSemana(); }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando || $('aviso-actualizacion').hidden) return;
    recargando = true;
    location.reload();
  });
}

// Cada minuto se recalcula el estado (las alertas y las horas dependen de la hora).
// En segundo plano no se repinta: solo se revisa el recordatorio de salida (HU-15) con lo ya cargado.
setInterval(() => {
  if (!estado.perfil || estado.checando) return;
  if (document.visibilityState === 'visible') { enviarPendientes(); pintarJornada(); return; }
  if (!estado.dia) return;
  const ahora = new Date();
  const zona = zonaHoraria();
  const config = estado.perfil.organizacion.config;
  const e = calcularEstado({ eventos: estado.dia.eventos, horario: estado.dia.horario, ahora, zona, config });
  recordatorio.revisar({ alertas: e.alertas, miembroId: estado.perfil.miembroId, fecha: partesLocales(ahora, zona).fecha }).catch(() => {});
}, 60_000);

// ---------- Recordatorio de salida (HU-15): permiso de notificaciones ----------
function pintarRecordatorio() {
  const minutos = Number(estado.perfil?.organizacion.config?.recordatorio_salida_min ?? 30);
  const p = recordatorio.permiso();
  const textos = {
    granted: `Activado: si un bloque sigue abierto ${minutos} minutos después de su hora de fin, el teléfono te avisa (con la app abierta o en segundo plano).`,
    default: `Te avisamos si un bloque sigue abierto ${minutos} minutos después de su hora de fin. Necesitamos tu permiso para mostrar notificaciones.`,
    denied: 'Las notificaciones están bloqueadas para esta app. Actívalas en los permisos del sitio en tu navegador. El aviso dentro de la app sigue funcionando.',
    no_disponible: 'Este navegador no permite notificaciones. En iPhone, agrega la app a la pantalla de inicio (iOS 16.4 o más). El aviso dentro de la app sigue funcionando.'
  };
  $('recordatorio-estado').textContent = textos[p];
  $('recordatorio-activar').hidden = p !== 'default';
}

function iniciar() {
  $('version-app').textContent = CONFIG.VERSION_APP;
  pintarFecha();
  mostrarVista();
  window.addEventListener('hashchange', () => { mostrarVista(); if (location.hash === '#historial') { pintarSemana(); pintarSolicitudes(); pintarObservadas(); } });
  conectarFormularios();
  registrarServiceWorker().catch((e) => console.warn('Service worker no registrado', e));
  revisarSesion();
}

iniciar();
