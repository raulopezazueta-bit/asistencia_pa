// Solicitar corrección (HU-28): formulario del asesor.
// Necesita señal: la solicitud la revisa una persona y hay que consultar las checadas del día en el servidor.
// Si no hay señal, lo escrito se queda en la pantalla para intentarlo de nuevo.
import * as api from './api.js';
import * as incidencias from './incidencias.js';
import { partesLocales, rangoDelDia, instanteLocal } from './reglas.js';

const $ = (id) => document.getElementById(id);
const DIAS_POR_OMISION = 30;   // configurable: organizaciones.config.dias_para_corregir

let ctx = null;          // { perfil, mostrarPantalla, alTerminar, id }
let originales = new Map();
let consulta = 0;
let conectado = false;

const zona = () => ctx.perfil.organizacion.zonaHoraria;
const tipoElegido = () => document.querySelector('input[name="correccion-tipo"]:checked')?.value || '';
const originalElegido = () => document.querySelector('input[name="correccion-original"]:checked')?.value || '';
const horaLocal = (iso) => new Intl.DateTimeFormat('es-MX', { timeZone: zona(), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function error(texto) {
  $('correccion-error').textContent = texto || '';
  $('correccion-error').hidden = !texto;
}

export function abrir({ perfil, mostrarPantalla, alTerminar }) {
  ctx = { perfil, mostrarPantalla, alTerminar, id: crypto.randomUUID() };
  if (!conectado) conectar();
  const hoy = partesLocales(new Date(), zona()).fecha;
  const dias = Number(perfil.organizacion.config?.dias_para_corregir) || DIAS_POR_OMISION;
  $('form-correccion').reset();
  $('correccion-fecha').value = hoy;
  $('correccion-fecha').max = hoy;
  $('correccion-fecha').min = sumarDias(hoy, -dias);
  $('correccion-originales').replaceChildren();
  error('');
  $('form-correccion').hidden = false;
  $('correccion-resultado').hidden = true;
  $('correccion-enviar').disabled = false;
  actualizar();
  mostrarPantalla('correccion');
  window.scrollTo(0, 0);
}

function conectar() {
  conectado = true;
  for (const r of document.querySelectorAll('input[name="correccion-tipo"]')) r.addEventListener('change', actualizar);
  $('correccion-fecha').addEventListener('change', () => { if (!$('correccion-original-campo').hidden) cargarOriginales(); });
  $('correccion-cancelar').addEventListener('click', () => ctx.alTerminar());
  $('correccion-listo').addEventListener('click', () => ctx.alTerminar());
  $('form-correccion').addEventListener('submit', (ev) => { ev.preventDefault(); enviar(); });
}

// Muestra solo los campos que necesita cada tipo de solicitud
function actualizar() {
  const tipo = tipoElegido();
  const conDia = tipo && tipo !== 'otro';
  const conOriginal = tipo === 'correccion_hora' || tipo === 'fuera_geocerca';
  $('correccion-fecha-campo').hidden = !conDia;
  $('correccion-original-campo').hidden = !conOriginal;
  $('correccion-checada-campo').hidden = tipo !== 'omision';
  $('correccion-hora-campo').hidden = !(tipo === 'omision' || tipo === 'correccion_hora');
  $('correccion-hora-etiqueta').textContent = tipo === 'omision' ? 'Hora en que debió quedar' : 'Hora correcta';
  error('');
  if (conOriginal) cargarOriginales();
}

// Checadas de ese día que ya están en el servidor (las que se pueden corregir)
async function cargarOriginales() {
  const n = ++consulta;
  const tipo = tipoElegido();
  const estadoTexto = $('correccion-original-estado');
  const lista = $('correccion-originales');
  lista.replaceChildren();
  originales = new Map();
  estadoTexto.hidden = false;
  estadoTexto.textContent = 'Buscando tus checadas de ese día…';
  try {
    const fecha = $('correccion-fecha').value;
    const rango = rangoDelDia(instanteLocal(fecha, '12:00', zona()), zona());
    const [eventos, solicitudes] = await Promise.all([
      api.misEventos(ctx.perfil.miembroId, rango.desde.toISOString(), rango.hasta.toISOString()),
      incidencias.mias(ctx.perfil)
    ]);
    if (n !== consulta) return;
    const corregidas = incidencias.reemplazadas(solicitudes.filas);
    let filas = eventos.filter((e) => !corregidas.has(e.id));
    if (tipo === 'fuera_geocerca') filas = filas.filter((e) => e.dentro_geocerca === false);
    for (const e of filas) originales.set(e.id, e);
    estadoTexto.textContent = filas.length ? ''
      : tipo === 'fuera_geocerca' ? 'Ese día no tienes checadas fuera de zona.' : 'Ese día no tienes checadas enviadas. Si olvidaste checar, elige "Olvidé checar".';
    estadoTexto.hidden = filas.length > 0;
    lista.replaceChildren(...filas.map((e) => {
      const label = document.createElement('label');
      label.className = 'opcion opcion--radio';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'correccion-original';
      input.value = e.id;
      input.addEventListener('change', () => {
        if (tipo === 'correccion_hora' && !$('correccion-hora').value) $('correccion-hora').value = horaLocal(e.hora_efectiva);
      });
      const t = document.createElement('span');
      t.className = 'opcion__titulo';
      t.textContent = incidencias.nombreChecada(e.tipo, e.bloque);
      const d = document.createElement('span');
      d.className = 'opcion__detalle';
      const h = document.createElement('span');
      h.className = 'mono';
      h.textContent = horaLocal(e.hora_efectiva);
      d.append(h, e.dentro_geocerca === false ? ' · Fuera de zona' : '', e.origen === 'incidencia' ? ' · Por corrección aprobada' : '');
      label.append(input, t, d);
      return label;
    }));
  } catch (e) {
    if (n !== consulta) return;
    estadoTexto.hidden = false;
    estadoTexto.textContent = api.esErrorDeRed(e)
      ? 'Sin señal: no se pueden consultar tus checadas. Intenta de nuevo cuando tengas señal.'
      : 'No se pudieron consultar tus checadas de ese día.';
  }
}

async function enviar() {
  const tipo = tipoElegido();
  const motivo = $('correccion-motivo').value.trim();
  const fecha = $('correccion-fecha').value;
  const hora = $('correccion-hora').value;
  if (!tipo) return error('Elige qué pasó.');
  const datos = { tipo, motivo, evento_original_id: null, tipo_evento_propuesto: null, bloque_propuesto: null, hora_propuesta: null };
  if (tipo !== 'otro' && (!fecha || fecha > $('correccion-fecha').max || fecha < $('correccion-fecha').min)) {
    return error(`Elige un día entre los últimos ${Number(ctx.perfil.organizacion.config?.dias_para_corregir) || DIAS_POR_OMISION} días.`);
  }
  if (tipo === 'omision') {
    const [t, b] = $('correccion-checada').value.split(':');
    if (!t) return error('Elige la checada que faltó.');
    Object.assign(datos, { tipo_evento_propuesto: t, bloque_propuesto: b || null });
  }
  if (tipo === 'correccion_hora' || tipo === 'fuera_geocerca') {
    const original = originales.get(originalElegido());
    if (!original) return error('Elige la checada que quieres corregir.');
    datos.evento_original_id = original.id;
    if (tipo === 'correccion_hora') Object.assign(datos, { tipo_evento_propuesto: original.tipo, bloque_propuesto: original.bloque || null });
  }
  if (tipo === 'omision' || tipo === 'correccion_hora') {
    if (!hora) return error('Escribe la hora.');
    const instante = instanteLocal(fecha, hora, zona());
    if (instante.getTime() > Date.now()) return error('La hora no puede ser posterior a este momento.');
    datos.hora_propuesta = instante.toISOString();
  }
  if (motivo.length < 5) return error('Escribe el motivo (al menos 5 caracteres).');

  error('');
  const boton = $('correccion-enviar');
  boton.disabled = true;
  try {
    await incidencias.solicitar(ctx.perfil, { id: ctx.id, ...datos });
    $('form-correccion').hidden = true;
    $('correccion-resultado').hidden = false;
    window.scrollTo(0, 0);
  } catch (e) {
    error(api.esErrorDeRed(e)
      ? 'Sin señal: no se pudo enviar. Lo que escribiste se queda aquí; intenta de nuevo cuando tengas señal.'
      : `No se pudo enviar: ${e.message || 'error del servidor'}`);
  } finally {
    boton.disabled = false;
  }
}
