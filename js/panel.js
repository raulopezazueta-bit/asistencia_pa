// Panel de coordinación (panel.html): tablero del día (HU-27), bandeja de revisión (HU-23), incidencias (HU-29), reportes (HU-31)
// y, solo para administración, personas (HU-09, js/personas.js).
// Usa la misma sesión que la app del asesor (mismo teléfono o computadora). Necesita señal.
import * as sesion from './sesion.js';
import * as api from './api.js';
import * as sitios from './sitios.js';
import { TIPOS, ESTADOS, nombreChecada } from './incidencias.js';
import { tableroDelDia } from './tablero.js';
import { armarBandeja, MOTIVOS } from './bandeja.js';
import { csvNomina } from './reporte.js';
import { semanasNomina, csvSemanal, lunesDe } from './nomina.js';
import { cargarReporte } from './reporte_datos.js';
import * as personas from './personas.js';
import { rangoDelDia, diasDeLaSemana, formatoHoras, partesLocales } from './reglas.js';

const $ = (id) => document.getElementById(id);
const estado = { perfil: null, filtro: 'pendiente', bandeja: 'pendientes' };

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const zona = () => estado.perfil.organizacion.zonaHoraria;
function fechaHora(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zona(), year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const dia = new Date(Date.UTC(p.year, p.month - 1, p.day, 12)).getUTCDay();
  return `${DIAS[dia]} ${p.day} ${MESES[p.month - 1]} · ${p.hour}:${p.minute}`;
}

function aviso(texto, tipo = '') {
  const a = $('panel-aviso');
  a.textContent = texto || '';
  a.className = `aviso${tipo ? ` aviso--${tipo}` : ''}`;
  a.hidden = !texto;
}

function sinAcceso(texto) {
  $('panel-cargando').hidden = true;
  $('panel').hidden = true;
  $('panel-sin-acceso-texto').textContent = texto;
  $('panel-sin-acceso').hidden = false;
}

async function iniciar() {
  let r;
  try {
    r = await sesion.resolver();
  } catch {
    return sinAcceso('No se pudo verificar tu cuenta. Revisa tu señal y recarga la página.');
  }
  if (r.estado === 'sin_sesion' || r.estado === 'sin_alta') return sinAcceso('Inicia sesión en la app con tu cuenta de coordinación y vuelve a abrir el panel.');
  if (r.estado === 'elegir') return sinAcceso('Elige tu organización en la app y vuelve a abrir el panel.');
  if (!['coordinador', 'admin'].includes(r.perfil.rol)) return sinAcceso('Esta página es solo para coordinación.');
  estado.perfil = r.perfil;
  $('panel-org').textContent = r.perfil.organizacion.nombre;
  $('panel-persona').textContent = r.perfil.nombre;
  $('panel-cargando').hidden = true;
  $('panel').hidden = false;
  $('filtro-pendientes').addEventListener('click', () => filtrar('pendiente'));
  $('filtro-resueltas').addEventListener('click', () => filtrar('resueltas'));
  $('bandeja-pendientes').addEventListener('click', () => filtrarBandeja('pendientes'));
  $('bandeja-revisadas').addEventListener('click', () => filtrarBandeja('revisadas'));
  $('hoy-actualizar').addEventListener('click', () => { pintarHoy(); pintarBandeja(); pintar(); });
  // Se actualiza solo cada 2 minutos mientras el panel está a la vista (la bandeja no, para no borrar lo que se escribe)
  setInterval(() => { if (document.visibilityState === 'visible') { pintarHoy(); pintar(); } }, 120_000);
  prepararReportes();
  await sitios.actualizar(r.perfil).catch(() => null);   // nombres de parques (una descarga al día, compartida con la app)
  await Promise.all([pintarHoy(), pintarBandeja(), pintar()]);
  if (r.perfil.rol === 'admin') await personas.preparar(r.perfil, aviso);
}

// ---------- Tablero del día (HU-27) ----------
const ESTADO_HOY = {
  en_regla: ['En regla', 'chip--ok'], retardo: ['Retardo', 'chip--aviso'], revisar: ['Revisar', 'chip--critico'],
  sin_checar: ['Sin checar', 'chip--critico'], por_iniciar: ['Por iniciar', '']
};
const SITUACION = { en_pausa: 'En pausa', fuera: 'Fuera de bloque', sin_registro: 'Sin registros hoy' };
const horaCorta = (iso) => new Intl.DateTimeFormat('es-MX', { timeZone: zona(), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

let pintandoHoy = null;
async function pintarHoy() {
  if (pintandoHoy) return pintandoHoy;
  pintandoHoy = (async () => {
    const p = estado.perfil;
    const ahora = new Date();
    const lunes = diasDeLaSemana(ahora, zona())[0];
    const desde = rangoDelDia(new Date(`${lunes}T12:00:00Z`), zona()).desde;
    const hasta = rangoDelDia(ahora, zona()).hasta;
    try {
      const [miembros, horarios, eventos, corregidas] = await Promise.all([
        api.miembrosDeOrganizacion(p.organizacionId), api.horariosDeOrganizacion(p.organizacionId),
        api.eventosDeOrganizacion(p.organizacionId, desde.toISOString(), hasta.toISOString()),
        api.corregidasDeOrganizacion(p.organizacionId)
      ]);
      const catalogo = await sitios.todos(p.organizacionId);
      const t = tableroDelDia({ miembros, horarios, eventos, corregidas, sitios: catalogo, ahora, zona: zona(), config: p.organizacion.config || {} });
      const fecha = fechaHora(ahora.toISOString());
      $('hoy-fecha').textContent = fecha.split(' · ')[0];
      $('hoy-actualizado').textContent = `Actualizado ${horaCorta(ahora.toISOString())}`;
      $('kpi-en-jornada').textContent = t.tarjetas.enJornada;
      $('kpi-total').textContent = ` / ${t.tarjetas.total}`;
      $('kpi-zona').textContent = t.tarjetas.dentroDeZona === null ? '—' : `${t.tarjetas.dentroDeZona}\u202f%`;
      $('kpi-zona-detalle').textContent = t.tarjetas.checadasConZona
        ? `esta semana · ${t.tarjetas.checadasConZona} ${t.tarjetas.checadasConZona === 1 ? 'checada revisada' : 'checadas revisadas'} por zona`
        : 'esta semana · aún sin checadas revisadas por zona';
      $('kpi-parques').textContent = t.tarjetas.parquesHoy;
      $('tabla-hoy-cuerpo').replaceChildren(...t.filas.map(filaHoy));
      if (!t.filas.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.className = 'secundario';
        td.textContent = 'Hoy nadie tiene horario ni checadas.';
        tr.append(td);
        $('tabla-hoy-cuerpo').replaceChildren(tr);
      }
    } catch (e) {
      aviso(api.esErrorDeRed(e) ? 'Sin señal: el panel necesita conexión. Recarga cuando tengas señal.' : `No se pudo leer la jornada de hoy: ${e.message}`, 'critico');
    }
  })().finally(() => { pintandoHoy = null; });
  return pintandoHoy;
}

function filaHoy(f) {
  const tr = document.createElement('tr');
  tr.dataset.miembro = f.miembroId;
  const celda = (contenido, clase) => { const td = document.createElement('td'); if (clase) td.className = clase; td.append(...[].concat(contenido)); tr.append(td); return td; };
  const sub = document.createElement('span');
  sub.className = 'tabla__sub';
  const situacion = f.situacion === 'en_jornada' ? `En bloque de ${f.bloqueAbierto}` : SITUACION[f.situacion];
  sub.textContent = f.olvido ? `${situacion} · ¿olvidó checar salida?` : situacion;
  const persona = document.createElement('th');
  persona.scope = 'row';
  persona.className = 'tabla__persona';
  persona.append(f.nombre, sub);
  tr.append(persona);
  celda(f.entrada ? horaCorta(f.entrada) : '—', 'mono').dataset.etiqueta = 'Entrada';
  celda(f.sitio || '—').dataset.etiqueta = 'Dónde está';
  celda(`${formatoHoras(f.minutos)}${f.programados ? ` / ${formatoHoras(f.programados)}` : ''}`, 'tabla__num').dataset.etiqueta = 'Horas';
  const [texto, clase] = ESTADO_HOY[f.estado];
  const chip = document.createElement('span');
  chip.className = `chip ${clase}`.trim();
  chip.textContent = texto;
  celda(chip);
  return tr;
}

function filtrar(f) {
  estado.filtro = f;
  $('filtro-pendientes').setAttribute('aria-selected', String(f === 'pendiente'));
  $('filtro-resueltas').setAttribute('aria-selected', String(f !== 'pendiente'));
  pintar();
}

// ---------- Bandeja de revisión (HU-23) ----------
function filtrarBandeja(f) {
  estado.bandeja = f;
  $('bandeja-pendientes').setAttribute('aria-selected', String(f === 'pendientes'));
  $('bandeja-revisadas').setAttribute('aria-selected', String(f !== 'pendientes'));
  pintarBandeja();
}

async function pintarBandeja() {
  const p = estado.perfil;
  try {
    const desde = new Date(Date.now() - 30 * 864e5).toISOString();
    const [eventos, revisiones, incidencias, catalogo] = await Promise.all([
      api.eventosPorRevisar(p.organizacionId, desde), api.revisionesDeOrganizacion(p.organizacionId, desde),
      api.incidenciasSobreChecadas(p.organizacionId), sitios.todos(p.organizacionId)
    ]);
    const nombreSitio = new Map(catalogo.map((x) => [x.id, x.nombre]));
    const b = armarBandeja({ eventos, revisiones, incidencias });
    $('contador-revisar').textContent = `(${b.porRevisar.length})`;
    $('menu-revisar').textContent = b.porRevisar.length || '';
    const lista = estado.bandeja === 'pendientes' ? b.porRevisar : b.revisadas;
    $('bandeja-lista').replaceChildren(...lista.map((item) => tarjetaRevision(item, nombreSitio)));
    $('bandeja-vacio').textContent = estado.bandeja === 'pendientes' ? 'No hay checadas por revisar.' : 'No hay checadas revisadas en los últimos 30 días.';
    $('bandeja-vacio').hidden = lista.length > 0;
  } catch (e) {
    aviso(api.esErrorDeRed(e) ? 'Sin señal: el panel necesita conexión. Recarga cuando tengas señal.' : `No se pudo leer la bandeja de revisión: ${e.message}`, 'critico');
  }
}

function tarjetaRevision({ evento: e, revision, incidenciaAprobada, incidenciaPendiente }, nombreSitio) {
  const art = document.createElement('article');
  art.className = 'tarjeta incidencia';
  art.dataset.evento = e.id;
  const cab = document.createElement('div');
  cab.className = 'incidencia__cabecera';
  const nombre = document.createElement('p');
  nombre.className = 'lista__titulo';
  nombre.textContent = e.persona?.nombre_completo || 'Persona';
  cab.append(nombre);
  if (revision || incidenciaAprobada) {
    const chip = document.createElement('span');
    chip.className = `chip ${revision?.decision === 'observada' ? 'chip--aviso' : 'chip--ok'}`;
    chip.textContent = revision ? (revision.decision === 'validada' ? 'Validada' : 'Observada') : 'Aclarada por incidencia';
    cab.append(chip);
  }
  const motivos = document.createElement('div');
  motivos.className = 'revision__motivos';
  for (const m of e.motivos_revision || []) {
    const c = document.createElement('span');
    c.className = 'chip chip--critico';
    c.textContent = MOTIVOS[m] || m;
    motivos.append(c);
  }
  art.append(cab, motivos);
  art.append(linea('Checada', `${nombreChecada(e.tipo, e.bloque)} · `, mono(fechaHora(e.hora_efectiva)),
    e.capturado_sin_conexion ? ' · sin conexión (hora del teléfono)' : ''));
  const lugar = [];
  if (e.sitio_id) lugar.push(nombreSitio.get(e.sitio_id) || 'Sitio');
  if (e.distancia_sitio_m != null) lugar.push(`a ${Math.round(e.distancia_sitio_m)} m`);
  if (e.precision_m != null) lugar.push(`precisión estimada ±${Math.round(e.precision_m)} m`);
  art.append(linea('Lugar', lugar.length ? lugar.join(' · ') : 'Sin ubicación'));
  if (e.modalidad === 'teletrabajo') art.append(linea('Modalidad', 'Teletrabajo'));
  if (e.justificacion) art.append(linea('Justificación', e.justificacion));
  if (incidenciaPendiente) art.append(linea('Incidencia', 'la persona pidió una corrección de esta checada (ver Incidencias)'));
  if (incidenciaAprobada) art.append(linea('Incidencia', 'aprobada: la checada se corrigió o se aclaró'));

  // Selfie: enlace temporal de 60 s, solo al pedirlo
  if (e.selfie_path) {
    const ver = document.createElement('button');
    ver.type = 'button';
    ver.className = 'boton boton--chico';
    ver.dataset.selfie = '';
    ver.textContent = 'Ver selfie';
    ver.addEventListener('click', async () => {
      ver.disabled = true;
      try {
        const img = document.createElement('img');
        img.className = 'revision__selfie';
        img.alt = `Selfie de ${e.persona?.nombre_completo || 'la persona'}`;
        img.src = await api.urlSelfie(e.selfie_path);
        ver.replaceWith(img);
      } catch (err) {
        ver.disabled = false;
        ver.textContent = api.esErrorDeRed(err) ? 'Sin señal: reintentar' : 'No se pudo abrir la selfie';
      }
    });
    art.append(ver);
  } else {
    art.append(linea('Selfie', 'no se tomó'));
  }

  if (revision) {
    art.append(linea('Revisó', `${revision.revisor?.nombre_completo || '—'} · `, mono(fechaHora(revision.revisado_en))));
    if (revision.comentario) art.append(linea('Comentario', revision.comentario));
    return art;
  }
  if (incidenciaAprobada) return art;
  if (e.miembro_id === estado.perfil.miembroId) {
    const nota = document.createElement('p');
    nota.className = 'secundario chico';
    nota.textContent = 'Es tu checada: la revisa otra persona de coordinación.';
    art.append(nota);
    return art;
  }
  const campo = document.createElement('label');
  campo.className = 'campo';
  const et = document.createElement('span');
  et.className = 'campo__etiqueta';
  et.textContent = 'Comentario (obligatorio para observar)';
  const texto = document.createElement('textarea');
  texto.className = 'campo__entrada';
  texto.rows = 2;
  texto.maxLength = 500;
  campo.append(et, texto);
  const error = document.createElement('p');
  error.className = 'aviso aviso--critico';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const botones = document.createElement('div');
  botones.className = 'incidencia__botones';
  const validar = document.createElement('button');
  validar.type = 'button';
  validar.className = 'boton boton--lleno';
  validar.dataset.revisar = 'validada';
  validar.textContent = 'Validar';
  const observar = document.createElement('button');
  observar.type = 'button';
  observar.className = 'boton boton--tierra';
  observar.dataset.revisar = 'observada';
  observar.textContent = 'Observar';
  botones.append(validar, observar);
  art.append(campo, error, botones);
  const decidir = async (decision) => {
    const comentario = texto.value.trim();
    error.hidden = true;
    if (decision === 'observada' && comentario.length < 5) {
      error.textContent = 'Para observar, escribe el motivo (al menos 5 caracteres).';
      error.hidden = false;
      return texto.focus();
    }
    validar.disabled = observar.disabled = true;
    try {
      await api.revisarEvento(e.id, decision, comentario);
      aviso(`Checada de ${e.persona?.nombre_completo || 'la persona'} ${decision === 'validada' ? 'validada' : 'observada'}.`, 'ok');
      await pintarBandeja();
    } catch (err) {
      error.textContent = api.esErrorDeRed(err) ? 'Sin señal: no se pudo guardar. Intenta de nuevo.' : `No se pudo guardar: ${err.message}`;
      error.hidden = false;
      validar.disabled = observar.disabled = false;
    }
  };
  validar.addEventListener('click', () => decidir('validada'));
  observar.addEventListener('click', () => decidir('observada'));
  return art;
}

// ---------- Reportes (HU-31) ----------
function periodoElegido() {
  const desde = $('reporte-desde').value, hasta = $('reporte-hasta').value;
  if (!desde || !hasta) return { error: 'Elige las dos fechas del periodo.' };
  if (desde > hasta) return { error: 'La fecha "Desde" debe ser anterior o igual a "Hasta".' };
  return { desde, hasta, miembro: $('reporte-persona').value };
}

async function prepararReportes() {
  const hoy = partesLocales(new Date(), zona()).fecha;
  $('reporte-desde').value = `${hoy.slice(0, 8)}01`;   // del día 1 del mes a hoy
  $('reporte-hasta').value = hoy;
  const err = $('reporte-error');
  const mostrar = (t) => { err.textContent = t || ''; err.hidden = !t; };
  $('form-reporte').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const p = periodoElegido();
    if (p.error) return mostrar(p.error);
    mostrar('');
    const q = new URLSearchParams({ desde: p.desde, hasta: p.hasta, ...(p.miembro ? { miembro: p.miembro } : {}) });
    window.open(`reporte.html?${q}`, '_blank');
  });
  const descargar = (boton, preparar) => boton.addEventListener('click', async () => {
    const p = periodoElegido();
    if (p.error) return mostrar(p.error);
    mostrar('');
    boton.disabled = true;
    try {
      const { contenido, nombre } = await preparar(p);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
      a.download = nombre;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      mostrar(api.esErrorDeRed(e) ? 'Sin señal: no se pudo preparar el archivo.' : `No se pudo preparar el archivo: ${e.message}`);
    } finally {
      boton.disabled = false;
    }
  });
  const org = () => estado.perfil.organizacion;
  descargar($('reporte-csv'), async (p) => ({
    contenido: csvNomina(await cargarReporte(estado.perfil, p.desde, p.hasta, p.miembro), org().nombre),
    nombre: `jornada_${org().slug}_${p.desde}_${p.hasta}.csv`
  }));
  // Semanal (HU-32): se carga también la semana anterior para saber si se ganó medio día libre
  descargar($('reporte-semanal'), async (p) => {
    const d = new Date(`${lunesDe(p.desde)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    const personas = await cargarReporte(estado.perfil, d.toISOString().slice(0, 10), p.hasta, p.miembro);
    const filas = semanasNomina(personas, { desde: p.desde, hasta: p.hasta, hoy: partesLocales(new Date(), zona()).fecha, config: org().config || {} });
    return { contenido: csvSemanal(filas, org().nombre), nombre: `semanas_${org().slug}_${p.desde}_${p.hasta}.csv` };
  });
  try {
    const miembros = await api.miembrosDeOrganizacion(estado.perfil.organizacionId);
    for (const m of miembros) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.nombre_completo;
      $('reporte-persona').append(o);
    }
  } catch { /* sin señal: queda "Todas las personas" */ }
}

// ---------- Incidencias (HU-29) ----------
async function pintar() {
  const lista = $('incidencias-lista');
  const vacio = $('incidencias-vacio');
  try {
    const org = estado.perfil.organizacionId;
    const pendientes = await api.incidenciasDeOrganizacion(org, { estado: 'pendiente' });
    $('contador-pendientes').textContent = `(${pendientes.length})`;
    $('kpi-incidencias').textContent = pendientes.length;
    $('menu-incidencias').textContent = pendientes.length || '';
    const filas = estado.filtro === 'pendiente' ? pendientes
      : await api.incidenciasDeOrganizacion(org, { desdeISO: new Date(Date.now() - 30 * 864e5).toISOString() });
    lista.replaceChildren(...filas.map(tarjeta));
    vacio.textContent = estado.filtro === 'pendiente' ? 'No hay incidencias por resolver.' : 'No hay incidencias resueltas en los últimos 30 días.';
    vacio.hidden = filas.length > 0;
  } catch (e) {
    aviso(api.esErrorDeRed(e) ? 'Sin señal: el panel necesita conexión. Recarga cuando tengas señal.' : `No se pudieron leer las incidencias: ${e.message}`, 'critico');
  }
}

function linea(etiqueta, ...contenido) {
  const p = document.createElement('p');
  p.className = 'incidencia__linea';
  const b = document.createElement('span');
  b.className = 'incidencia__etiqueta';
  b.textContent = `${etiqueta}: `;
  p.append(b, ...contenido);
  return p;
}
const mono = (t) => { const s = document.createElement('span'); s.className = 'mono'; s.textContent = t; return s; };

function tarjeta(i) {
  const art = document.createElement('article');
  art.className = 'tarjeta incidencia';
  art.dataset.incidencia = i.id;
  const cab = document.createElement('div');
  cab.className = 'incidencia__cabecera';
  const nombre = document.createElement('p');
  nombre.className = 'lista__titulo';
  nombre.textContent = i.persona?.nombre_completo || 'Persona';
  const chip = document.createElement('span');
  const [txt, clase] = ESTADOS[i.estado];
  chip.className = `chip ${clase}`;
  chip.textContent = i.estado === 'pendiente' ? TIPOS[i.tipo] : txt;
  cab.append(nombre, chip);
  art.append(cab);
  if (i.estado !== 'pendiente') art.append(linea('Tipo', TIPOS[i.tipo]));
  if (i.tipo_evento_propuesto) {
    art.append(linea(i.tipo === 'omision' ? 'Agregar' : 'Corregir a', `${nombreChecada(i.tipo_evento_propuesto, i.bloque_propuesto)} · `, mono(fechaHora(i.hora_propuesta))));
  }
  if (i.original) {
    const fuera = i.original.motivos_revision?.includes('fuera_de_geocerca') ? ' · fuera de zona' : '';
    art.append(linea('Checada original', `${nombreChecada(i.original.tipo, i.original.bloque)} · `, mono(fechaHora(i.original.hora_efectiva)), fuera));
  }
  art.append(linea('Motivo', i.motivo));
  art.append(linea('Solicitada', mono(fechaHora(i.creada_en))));
  if (i.estado !== 'pendiente') {
    art.append(linea('Resolvió', `${i.resolutor?.nombre_completo || '—'} · `, mono(fechaHora(i.resuelta_en))));
    if (i.comentario_resolucion) art.append(linea('Comentario', i.comentario_resolucion));
    return art;
  }

  if (i.miembro_id === estado.perfil.miembroId) {
    const nota = document.createElement('p');
    nota.className = 'secundario chico';
    nota.textContent = 'Es tu solicitud: la resuelve otra persona de coordinación.';
    art.append(nota);
    return art;
  }
  const campo = document.createElement('label');
  campo.className = 'campo';
  const et = document.createElement('span');
  et.className = 'campo__etiqueta';
  et.textContent = 'Comentario para la persona (obligatorio para rechazar)';
  const texto = document.createElement('textarea');
  texto.className = 'campo__entrada incidencia__comentario';
  texto.rows = 2;
  texto.maxLength = 500;
  campo.append(et, texto);
  const error = document.createElement('p');
  error.className = 'aviso aviso--critico';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const botones = document.createElement('div');
  botones.className = 'incidencia__botones';
  const aprobar = document.createElement('button');
  aprobar.type = 'button';
  aprobar.className = 'boton boton--lleno';
  aprobar.dataset.resolver = 'aprobada';
  aprobar.textContent = 'Aprobar';
  const rechazar = document.createElement('button');
  rechazar.type = 'button';
  rechazar.className = 'boton boton--tierra';
  rechazar.dataset.resolver = 'rechazada';
  rechazar.textContent = 'Rechazar';
  botones.append(aprobar, rechazar);
  art.append(campo, error, botones);

  const resolver = async (nuevo) => {
    const comentario = texto.value.trim();
    error.hidden = true;
    if (nuevo === 'rechazada' && comentario.length < 5) {
      error.textContent = 'Para rechazar, escribe el motivo (al menos 5 caracteres).';
      error.hidden = false;
      return texto.focus();
    }
    const pregunta = nuevo === 'aprobada'
      ? (i.tipo_evento_propuesto ? '¿Aprobar? Se agregará la checada corregida al registro. No se puede deshacer.' : '¿Aprobar? No se puede deshacer.')
      : '¿Rechazar? No se puede deshacer.';
    if (!window.confirm(pregunta)) return;
    aprobar.disabled = rechazar.disabled = true;
    try {
      await api.resolverIncidencia(i.id, nuevo, comentario);
      aviso(nuevo === 'aprobada'
        ? `Incidencia de ${i.persona?.nombre_completo || 'la persona'} aprobada${i.tipo_evento_propuesto ? ': se agregó la checada corregida' : ''}.`
        : `Incidencia de ${i.persona?.nombre_completo || 'la persona'} rechazada.`, 'ok');
      await Promise.all([pintar(), pintarBandeja()]);
    } catch (e) {
      error.textContent = api.esErrorDeRed(e) ? 'Sin señal: no se pudo guardar. Intenta de nuevo.' : `No se pudo guardar: ${e.message}`;
      error.hidden = false;
      aprobar.disabled = rechazar.disabled = false;
    }
  };
  aprobar.addEventListener('click', () => resolver('aprobada'));
  rechazar.addEventListener('click', () => resolver('rechazada'));
  return art;
}

iniciar();
