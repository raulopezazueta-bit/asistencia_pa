// Página del reporte para la autoridad (reporte.html?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&miembro=id]). Solo coordinación.
// Se imprime o se guarda como PDF desde el navegador (sin dependencias nuevas).
import * as sesion from './sesion.js';
import * as api from './api.js';
import { horasMinutos } from './reporte.js';
import { cargarReporte } from './reporte_datos.js';

const $ = (id) => document.getElementById(id);
const ROLES = { asesor: 'Asesoría', coordinador: 'Coordinación', admin: 'Administración' };
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaLarga = (f) => { const d = new Date(`${f}T12:00:00Z`); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function error(texto) {
  $('reporte-estado').textContent = texto;
  $('reporte-estado').hidden = false;
}

async function iniciar() {
  const q = new URLSearchParams(location.search);
  const desde = q.get('desde'), hasta = q.get('hasta'), miembro = q.get('miembro') || '';
  if (!FECHA.test(desde || '') || !FECHA.test(hasta || '') || desde > hasta) return error('Periodo inválido. Vuelve al panel y elige las fechas.');
  let r;
  try { r = await sesion.resolver(); } catch { return error('No se pudo verificar tu cuenta. Revisa tu señal y recarga la página.'); }
  if (r.estado !== 'lista') return error('Inicia sesión en la app con tu cuenta de coordinación y vuelve a abrir el reporte.');
  if (!['coordinador', 'admin'].includes(r.perfil.rol)) return error('El reporte de la organización es solo para coordinación.');
  const p = r.perfil;
  const zona = p.organizacion.zonaHoraria;
  try {
    const personas = await cargarReporte(p, desde, hasta, miembro);
    if (miembro && !personas.length) return error('La persona elegida no está activa en esta organización.');
    pintar({ perfil: p, personas, desde, hasta, zona });
  } catch (e) {
    error(api.esErrorDeRed(e) ? 'Sin señal: el reporte necesita conexión. Recarga cuando tengas señal.' : `No se pudo preparar el reporte: ${e.message}`);
  }
}

function td(contenido, clase) {
  const c = document.createElement('td');
  if (clase) c.className = clase;
  c.append(...[].concat(contenido));
  return c;
}

function pintar({ perfil, personas, desde, hasta, zona }) {
  const cfg = perfil.organizacion.config || {};
  document.title = `Registro de jornada · ${perfil.organizacion.nombre} · ${desde} a ${hasta}`;
  $('reporte-org').textContent = cfg.razon_social || perfil.organizacion.nombre;
  // Datos del patrón: configurables en organizaciones.config (pendientes de Parques Alegres)
  $('reporte-org-datos').textContent = [cfg.razon_social ? perfil.organizacion.nombre : null, cfg.rfc && `RFC ${cfg.rfc}`,
    cfg.registro_patronal && `Registro patronal ${cfg.registro_patronal}`, cfg.domicilio].filter(Boolean).join(' · ');
  $('reporte-periodo').textContent = `${fechaLarga(desde)} – ${fechaLarga(hasta)}`;
  $('reporte-emitido').textContent = new Intl.DateTimeFormat('es-MX', { timeZone: zona, dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date());
  $('reporte-emitio').textContent = `${perfil.nombre} (${ROLES[perfil.rol]})`;
  $('reporte-zona').textContent = zona;

  $('reporte-personas').replaceChildren(...personas.map(({ miembro, dias, totalMinutos, diasConRegistro }) => {
    const sec = document.createElement('section');
    sec.className = 'reporte__persona';
    sec.dataset.miembro = miembro.id;
    const h = document.createElement('h2');
    h.textContent = miembro.nombre_completo;
    const datos = document.createElement('p');
    datos.className = 'reporte__persona-datos';
    datos.textContent = [miembro.num_empleado && `Núm. de empleado ${miembro.num_empleado}`, ROLES[miembro.rol],
      `${diasConRegistro} ${diasConRegistro === 1 ? 'día' : 'días'} con registro`, `${horasMinutos(totalMinutos)} h efectivas`].filter(Boolean).join(' · ');
    sec.append(h, datos);
    if (!dias.length) {
      const p = document.createElement('p');
      p.textContent = 'Sin registros en el periodo.';
      sec.append(p);
    } else {
      const marco = document.createElement('div');
      marco.className = 'reporte__marco';
      const tabla = document.createElement('table');
      tabla.className = 'reporte__tabla';
      tabla.innerHTML = '<thead><tr><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Bloques</th><th>Pausas</th><th class="num">Horas efectivas</th><th>Marcas</th></tr></thead>';
      const cuerpo = document.createElement('tbody');
      for (const d of dias) {
        const tr = document.createElement('tr');
        tr.dataset.fecha = d.fecha;
        const bloques = d.bloques.map((b) => `${b.bloque === 'campo' ? 'Campo' : 'Escritorio'}${b.modalidad === 'teletrabajo' ? ' (teletrabajo)' : ''} ${b.inicio || '—'}–${b.fin || 'sin cerrar'}`).join('; ') || '—';
        const pausas = d.pausas.map((x) => `${x.inicio}–${x.fin || 'sin regreso'}`).join('; ') || '—';
        const marcas = document.createElement('ul');
        marcas.className = 'reporte__marcas';
        for (const m of d.marcas) { const li = document.createElement('li'); li.textContent = m; marcas.append(li); }
        tr.append(td(fechaLarga(d.fecha), 'hora'), td(d.entrada || '—', 'hora'), td(d.salida || '—', 'hora'), td(bloques),
          td(pausas), td(horasMinutos(d.minutos), 'num'), td(d.marcas.length ? marcas : '—'));
        cuerpo.append(tr);
      }
      const pie = document.createElement('tfoot');
      pie.innerHTML = '<tr><td colspan="5">Total del periodo</td><td class="num"></td><td></td></tr>';
      pie.querySelector('.num').textContent = horasMinutos(totalMinutos);
      tabla.append(cuerpo, pie);
      marco.append(tabla);
      sec.append(marco);
    }
    const firmas = document.createElement('div');
    firmas.className = 'reporte__firmas';
    firmas.innerHTML = '<div>Firma de la persona trabajadora</div><div>Firma de coordinación</div>';
    sec.append(firmas);
    return sec;
  }));
  if (!personas.length) $('reporte-personas').textContent = 'Sin registros en el periodo.';
  $('reporte-estado').hidden = true;
  $('reporte').hidden = false;
  $('reporte-imprimir').disabled = false;
  $('reporte-imprimir').addEventListener('click', () => window.print());
}

iniciar();
