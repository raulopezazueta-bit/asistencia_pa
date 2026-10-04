// Panel de coordinación (panel.html): tablero del día (HU-27) e incidencias (HU-29).
// Usa la misma sesión que la app del asesor (mismo teléfono o computadora). Necesita señal.
import * as sesion from './sesion.js';
import * as api from './api.js';
import * as sitios from './sitios.js';
import { TIPOS, ESTADOS, nombreChecada } from './incidencias.js';
import { tableroDelDia } from './tablero.js';
import { rangoDelDia, diasDeLaSemana, formatoHoras } from './reglas.js';

const $ = (id) => document.getElementById(id);
const estado = { perfil: null, filtro: 'pendiente' };

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
  $('hoy-actualizar').addEventListener('click', () => { pintarHoy(); pintar(); });
  // Se actualiza solo cada 2 minutos mientras el panel está a la vista
  setInterval(() => { if (document.visibilityState === 'visible') { pintarHoy(); pintar(); } }, 120_000);
  await Promise.all([pintarHoy(), pintar()]);
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
        api.corregidasDeOrganizacion(p.organizacionId),
        sitios.actualizar(p).catch(() => null)
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

// ---------- Incidencias (HU-29) ----------
async function pintar() {
  const lista = $('incidencias-lista');
  const vacio = $('incidencias-vacio');
  try {
    const org = estado.perfil.organizacionId;
    const pendientes = await api.incidenciasDeOrganizacion(org, { estado: 'pendiente' });
    $('contador-pendientes').textContent = `(${pendientes.length})`;
    $('kpi-incidencias').textContent = pendientes.length;
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
      await pintar();
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
