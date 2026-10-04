// @ts-nocheck  (los módulos incluidos son JavaScript: no se revisan tipos)
// ARCHIVO GENERADO: no editar. Es avisos/index.ts con sus módulos incluidos (ver supabase/functions/armar_un_archivo.mjs).
// Función de Supabase (Edge Function) "avisos" · HU-15b y HU-30: avisos al teléfono aunque la app esté cerrada (Web Push).
// La llama un reloj programado (pg_cron) cada 5 minutos con su contraseña (claves_push.token_cron); calcula los avisos
// con logica.js y los envía a los teléfonos registrados. La primera vez genera sola sus llaves (VAPID) y la contraseña
// del reloj: nadie tiene que copiar llaves. Usa la llave secreta que Supabase entrega a la función (nunca en el repo).
// En el editor de Supabase se pega index_un_archivo.ts (este archivo con logica.js y js/reglas.js incluidos).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@0.3.0';

// ----- js/reglas.js -----
// Máquina de estados de la jornada y textos del botón principal (HU-12, docs/ESPECIFICACION.md §2).
// Módulo puro: no toca la pantalla, ni Supabase, ni el almacén. Recibe datos y devuelve decisiones.
//
// Evento: { id, tipo, bloque?, hora (Date|ISO), sitioId?, sitioNombre?, modalidad?, estadoRevision? }
// Horario del día: [{ bloque, inicio: 'HH:MM', fin: 'HH:MM', modalidad }]

export const BLOQUES = ['escritorio', 'campo'];
const NOMBRE_BLOQUE = { escritorio: 'escritorio', campo: 'campo' };
const MARGEN_OLVIDO_MIN = 30;        // por defecto; configurable con config.recordatorio_salida_min
const TOLERANCIA_ENTRADA_MIN = 10;   // por defecto; configurable con config.tolerancia_entrada_min

// ---------- Tiempo en la zona horaria de la organización ----------
export function partesLocales(fecha, zona) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(new Date(fecha)).map((x) => [x.type, x.value]));
  const dias = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { fecha: `${p.year}-${p.month}-${p.day}`, diaIso: dias[p.weekday], minutos: Number(p.hour) * 60 + Number(p.minute) };
}

// Inicio y fin (instantes UTC) del día local que contiene `ahora` en la zona de la organización.
export function rangoDelDia(ahora, zona) {
  const { fecha } = partesLocales(ahora, zona);
  const [y, m, d] = fecha.split('-').map(Number);
  const desfase = (utc) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zona, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utc;
  };
  const medianoche = (yy, mm, dd) => { const g = Date.UTC(yy, mm - 1, dd); return new Date(g - desfase(g)); };
  return { desde: medianoche(y, m, d), hasta: medianoche(y, m, d + 1), fecha };
}

// Instante (Date) que corresponde a la fecha 'AAAA-MM-DD' y la hora 'HH:MM' en la zona de la organización.
export function instanteLocal(fecha, hora, zona) {
  const [y, m, d] = fecha.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  const deseado = Date.UTC(y, m - 1, d, hh, mm);
  let t = deseado;
  for (let i = 0; i < 2; i++) {   // dos pasos bastan aunque haya cambio de horario
    const p = partesLocales(t, zona);
    const [py, pm, pd] = p.fecha.split('-').map(Number);
    t += deseado - Date.UTC(py, pm - 1, pd, Math.floor(p.minutos / 60), p.minutos % 60);
  }
  return new Date(t);
}

// Fechas (AAAA-MM-DD) de lunes a domingo de la semana que contiene `ahora`, en la zona de la organización.
export function diasDeLaSemana(ahora, zona) {
  const { fecha, diaIso } = partesLocales(ahora, zona);
  const sumar = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const lunes = sumar(fecha, 1 - diaIso);
  return Array.from({ length: 7 }, (_, i) => sumar(lunes, i));
}

const aMinutos = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const hhmm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

// Filas de `horarios` (Supabase) → horario de hoy, ordenado por hora de inicio.
export function horarioDelDia(horarios, ahora, zona) {
  const { fecha, diaIso } = partesLocales(ahora, zona);
  return (horarios || [])
    .filter((h) => h.dia_semana === diaIso && (!h.vigente_desde || h.vigente_desde <= fecha) && (!h.vigente_hasta || h.vigente_hasta >= fecha))
    .map((h) => ({ bloque: h.bloque, inicio: String(h.hora_inicio).slice(0, 5), fin: String(h.hora_fin).slice(0, 5), modalidad: h.modalidad || 'presencial' }))
    .sort((a, b) => aMinutos(a.inicio) - aMinutos(b.inicio));
}

// ---------- Recorrido de los eventos del día ----------
function recorrer(eventos) {
  const ordenados = [...(eventos || [])].sort((a, b) => new Date(a.hora) - new Date(b.hora));
  const r = { bloqueAbierto: null, inicioBloque: null, pausaDesde: null, sitio: null, hechos: new Set(), iniciados: new Set(), anomalias: [], ordenados };
  for (const e of ordenados) {
    switch (e.tipo) {
      case 'inicio_bloque':
        if (r.bloqueAbierto) r.anomalias.push({ tipo: 'bloque_sin_fin', bloque: r.bloqueAbierto });
        r.bloqueAbierto = e.bloque; r.inicioBloque = e.hora; r.iniciados.add(e.bloque);
        break;
      case 'fin_bloque':
        r.hechos.add(e.bloque);
        if (r.bloqueAbierto === e.bloque) { r.bloqueAbierto = null; r.inicioBloque = null; }
        r.sitio = null; r.pausaDesde = null;
        break;
      case 'inicio_pausa': r.pausaDesde = e.hora; break;
      case 'fin_pausa': r.pausaDesde = null; break;
      case 'llegada_sitio': r.sitio = { id: e.sitioId ?? null, nombre: e.sitioNombre || 'el parque' }; break;
      case 'salida_sitio': r.sitio = null; break;
    }
  }
  return r;
}

// Bloque que toca iniciar: el primer pendiente cuyo horario no ha terminado; si todos pasaron, el último pendiente.
function bloqueQueToca(pendientes, horario, minutos) {
  const programados = horario.filter((h) => pendientes.includes(h.bloque));
  if (!programados.length) return null;
  return (programados.find((h) => aMinutos(h.fin) > minutos) || programados[programados.length - 1]).bloque;
}

// ---------- Estado del día ----------
// Devuelve { estado, bloqueAbierto, enSitio, siguienteBloque, preguntarBloque, boton, secundarias, alertas, anomalias }
export function calcularEstado({ eventos, horario = [], ahora = new Date(), zona = 'America/Mazatlan', config = {} }) {
  const r = recorrer(eventos);
  const { minutos } = partesLocales(ahora, zona);
  const conHorario = horario.length > 0;
  const programado = (b) => horario.find((h) => h.bloque === b);
  const detalleProgramado = (b) => {
    const h = programado(b);
    if (!h) return '';
    return `${h.modalidad === 'teletrabajo' ? 'Teletrabajo · ' : ''}Programado ${h.inicio} – ${h.fin}`;
  };
  const alertas = [];
  const secundarias = [];
  let estado, boton, siguienteBloque = null, preguntarBloque = false;

  const base = conHorario ? horario.map((h) => h.bloque) : BLOQUES;
  const pendientes = base.filter((b) => !r.hechos.has(b) && !r.iniciados.has(b));
  // Día sin horario (p. ej. sábado): "actividad fuera de horario" (HU-12b). Configurable por organización.
  const permiteSinHorario = config.permitir_dias_sin_horario !== false;
  const otraActividad = () => {
    if (!permiteSinHorario || !pendientes.length) return null;
    const b = pendientes.length === 1 ? pendientes[0] : null;
    return { accion: 'inicio_bloque', bloque: b, texto: b ? `Iniciar otra actividad (${NOMBRE_BLOQUE[b]})` : 'Iniciar actividad fuera de horario' };
  };

  if (r.pausaDesde) {
    estado = 'en_pausa';
    boton = { texto: 'Regresar de la pausa', accion: 'fin_pausa', bloque: r.bloqueAbierto, detalle: r.bloqueAbierto ? `Bloque de ${NOMBRE_BLOQUE[r.bloqueAbierto]} en pausa` : 'Comida entre bloques' };
    // Salidas directas desde la pausa (HU-13): registran primero el regreso, con confirmación (ver pasosPara).
    if (r.bloqueAbierto) {
      secundarias.push({ accion: 'fin_bloque', bloque: r.bloqueAbierto, texto: `Terminar bloque de ${NOMBRE_BLOQUE[r.bloqueAbierto]}` });
    } else if (!conHorario) {
      const otra = otraActividad();
      if (otra) secundarias.push(otra);
      preguntarBloque = !!otra && !otra.bloque;
    } else if (pendientes.length) {
      siguienteBloque = conHorario ? bloqueQueToca(pendientes, horario, minutos) : (pendientes.length === 1 ? pendientes[0] : null);
      secundarias.push(siguienteBloque
        ? { accion: 'inicio_bloque', bloque: siguienteBloque, texto: `Iniciar bloque de ${NOMBRE_BLOQUE[siguienteBloque]}` }
        : { accion: 'inicio_bloque', bloque: null, texto: 'Iniciar bloque' });
      preguntarBloque = !siguienteBloque;
    }
  } else if (r.bloqueAbierto) {
    estado = 'en_bloque';
    const b = r.bloqueAbierto;
    boton = { texto: `Terminar bloque de ${NOMBRE_BLOQUE[b]}`, accion: 'fin_bloque', bloque: b, detalle: r.sitio ? `Estás en ${r.sitio.nombre}` : detalleProgramado(b) };
    if (r.sitio) {
      secundarias.push({ accion: 'salida_sitio', texto: `Salir de ${r.sitio.nombre}` });
      secundarias.push({ accion: 'cambio_sitio', texto: 'Llegar a otro parque' });
    } else if (b === 'campo') {
      secundarias.push({ accion: 'llegada_sitio', texto: 'Registrar llegada a parque' });
    }
    secundarias.push({ accion: 'inicio_pausa', texto: 'Iniciar comida/pausa' });
  } else if (r.hechos.size === 0 && r.iniciados.size === 0) {
    estado = 'sin_jornada';
  } else if (conHorario && pendientes.length) {
    estado = 'entre_bloques';
  } else {
    // Con horario: ya se cerraron los bloques programados. Sin horario: cada actividad cerrada cierra la jornada,
    // con opción de iniciar otra del tipo que falte (el servidor agrupa por tipo de bloque en v_jornada_diaria).
    estado = 'jornada_cerrada';
    boton = null;
    if (!conHorario) { const otra = otraActividad(); if (otra) secundarias.push(otra); }
    secundarias.push({ accion: 'solicitar_correccion', texto: 'Solicitar corrección' });
  }

  // Olvido de fin: bloque abierto (también si quedó en pausa) 30 min después de su fin programado
  if (r.bloqueAbierto) {
    const b = r.bloqueAbierto;
    const h = programado(b);
    const margen = Number(config.recordatorio_salida_min ?? MARGEN_OLVIDO_MIN);
    if (h && minutos > aMinutos(h.fin) + margen) {
      alertas.push({ tipo: 'olvido_fin', bloque: b, texto: `¿Olvidaste checar salida? El bloque de ${NOMBRE_BLOQUE[b]} terminaba a las ${h.fin}. Termínalo ahora y, si hace falta, solicita una corrección.` });
    }
  }

  if (estado === 'sin_jornada' && !conHorario) {
    preguntarBloque = permiteSinHorario;
    boton = permiteSinHorario
      ? { texto: 'Iniciar actividad fuera de horario', accion: 'inicio_bloque', bloque: null, detalle: 'Hoy no tienes horario. Eliges escritorio o campo al checar' }
      : null;
    if (!permiteSinHorario) alertas.push({ tipo: 'sin_horario', texto: 'Hoy no tienes horario programado. Si vas a trabajar, pide a coordinación que lo autorice.' });
  } else if (estado === 'sin_jornada' || estado === 'entre_bloques') {
    siguienteBloque = conHorario ? bloqueQueToca(pendientes, horario, minutos) : (pendientes.length === 1 ? pendientes[0] : null);
    preguntarBloque = !siguienteBloque;
    boton = siguienteBloque
      ? { texto: `Iniciar bloque de ${NOMBRE_BLOQUE[siguienteBloque]}`, accion: 'inicio_bloque', bloque: siguienteBloque, detalle: detalleProgramado(siguienteBloque) }
      : { texto: 'Iniciar bloque', accion: 'inicio_bloque', bloque: null, detalle: '¿Qué bloque inicias? Lo eliges al checar' };
    if (estado === 'entre_bloques') secundarias.push({ accion: 'inicio_pausa', texto: 'Iniciar comida' });
    const otro = pendientes.find((b) => b !== siguienteBloque);
    if (siguienteBloque && otro) secundarias.push({ accion: 'inicio_bloque', bloque: otro, texto: `Iniciar bloque de ${NOMBRE_BLOQUE[otro]}` });
  }

  return {
    estado, fueraDeHorario: !conHorario, bloqueAbierto: r.bloqueAbierto, enSitio: r.sitio, siguienteBloque, preguntarBloque,
    boton, secundarias, alertas, anomalias: r.anomalias, pausaDesde: r.pausaDesde
  };
}

// ---------- Pasos a registrar para una acción ----------
// Reglas: terminar bloque o iniciar el siguiente estando en pausa → primero fin_pausa (con confirmación);
// terminar campo en un parque → salida_sitio;
// llegar a otro parque → salida del anterior y llegada al nuevo.
export function pasosPara(estadoDia, accion, { bloque, sitio } = {}) {
  const pasos = [];
  switch (accion) {
    case 'fin_bloque': {
      const b = bloque || estadoDia.bloqueAbierto;
      if (estadoDia.pausaDesde) pasos.push({ tipo: 'fin_pausa', confirmar: 'Estás en pausa. Para terminar el bloque se registrará primero tu regreso de la pausa. ¿Continuar?' });
      if (estadoDia.enSitio) pasos.push({ tipo: 'salida_sitio', sitio: estadoDia.enSitio });
      pasos.push({ tipo: 'fin_bloque', bloque: b });
      break;
    }
    case 'cambio_sitio':
      if (estadoDia.enSitio) pasos.push({ tipo: 'salida_sitio', sitio: estadoDia.enSitio });
      pasos.push({ tipo: 'llegada_sitio', sitio });
      break;
    case 'salida_sitio':
      pasos.push({ tipo: 'salida_sitio', sitio: estadoDia.enSitio });
      break;
    case 'inicio_bloque':
      if (estadoDia.pausaDesde) pasos.push({ tipo: 'fin_pausa', confirmar: 'Estás en la comida. Para iniciar el bloque se registrará primero tu regreso de la pausa. ¿Continuar?' });
      pasos.push({ tipo: 'inicio_bloque', bloque: bloque || estadoDia.siguienteBloque });
      break;
    default:
      pasos.push({ tipo: accion, ...(sitio ? { sitio } : {}) });
  }
  return pasos;
}

// ---------- Resumen para la tarjeta "Jornada de hoy" ----------
// filas: bloques (cerrado/abierto/pendiente) y pausas, en orden; minutos efectivos (la comida entre bloques no resta);
// calificacion: 'en_regla' | 'retardo' | 'revisar'
export function resumenDelDia({ eventos, horario = [], ahora = new Date(), zona = 'America/Mazatlan', config = {} }) {
  const r = recorrer(eventos);
  const t = (x) => new Date(x).getTime();
  const fin = t(ahora);
  const bloques = new Map();
  const pausas = [];
  let pausa = null;
  for (const e of r.ordenados) {
    if (e.tipo === 'inicio_bloque' && !bloques.has(e.bloque)) bloques.set(e.bloque, { bloque: e.bloque, inicio: e.hora, fin: null, modalidad: e.modalidad, revisar: false });
    if (e.tipo === 'fin_bloque' && bloques.has(e.bloque)) bloques.get(e.bloque).fin = e.hora;
    if (e.tipo === 'inicio_pausa') pausa = { inicio: e.hora, fin: null };
    if (e.tipo === 'fin_pausa' && pausa) { pausa.fin = e.hora; pausas.push(pausa); pausa = null; }
    if (e.tipo === 'fin_bloque' && pausa) { pausa.fin = e.hora; pausas.push(pausa); pausa = null; }
  }
  if (pausa) pausas.push(pausa);

  // Minutos efectivos: duración de bloques menos la parte de pausas que cae dentro de un bloque.
  let ms = 0;
  for (const b of bloques.values()) {
    const bi = t(b.inicio), bf = b.fin ? t(b.fin) : fin;
    if (bf <= bi) continue;
    ms += bf - bi;
    for (const p of pausas) {
      const pi = t(p.inicio), pf = p.fin ? t(p.fin) : fin;
      ms -= Math.max(0, Math.min(pf, bf) - Math.max(pi, bi));
    }
  }
  const minutosEfectivos = Math.max(0, Math.floor(ms / 60000));
  const minutosProgramados = horario.reduce((s, h) => s + aMinutos(h.fin) - aMinutos(h.inicio), 0);

  const filas = [];
  const vistos = new Set();
  for (const h of horario) {
    const b = bloques.get(h.bloque);
    vistos.add(h.bloque);
    filas.push({ tipo: 'bloque', bloque: h.bloque, modalidad: h.modalidad, programado: { inicio: h.inicio, fin: h.fin },
      inicio: b?.inicio ?? null, fin: b?.fin ?? null, estado: !b ? 'pendiente' : b.fin ? 'cerrado' : 'abierto' });
  }
  for (const b of bloques.values()) {
    if (!vistos.has(b.bloque)) filas.push({ tipo: 'bloque', bloque: b.bloque, modalidad: b.modalidad, programado: null, inicio: b.inicio, fin: b.fin, estado: b.fin ? 'cerrado' : 'abierto' });
  }
  for (const p of pausas) filas.push({ tipo: 'pausa', inicio: p.inicio, fin: p.fin, estado: p.fin ? 'cerrada' : 'abierta' });
  const clave = (f) => (f.inicio ? t(f.inicio) : Number.MAX_SAFE_INTEGER - 1e9 + (f.programado ? aMinutos(f.programado.inicio) : 0));
  filas.sort((a, b) => clave(a) - clave(b));

  // Calificación del día
  const tolerancia = Number(config.tolerancia_entrada_min ?? TOLERANCIA_ENTRADA_MIN);
  let calificacion = 'en_regla';
  for (const h of horario) {
    const b = bloques.get(h.bloque);
    if (b && partesLocales(b.inicio, zona).minutos > aMinutos(h.inicio) + tolerancia) calificacion = 'retardo';
  }
  if ((eventos || []).some((e) => e.estadoRevision === 'revisar') || r.anomalias.length) calificacion = 'revisar';

  return { filas, minutosEfectivos, minutosProgramados, calificacion };
}

// ---------- Recorrido de visitas a parques (HU-24) ----------
// [{ sitioId, nombre, clave, llegada, salida, enviado }] en orden; una visita abierta tiene salida = null.
// El fin del bloque de campo cierra la visita abierta (la app registra la salida antes, pero por si acaso).
export function recorridoDelDia(eventos) {
  const visitas = [];
  let abierta = null;
  for (const e of [...(eventos || [])].sort((a, b) => new Date(a.hora) - new Date(b.hora))) {
    if (e.tipo === 'llegada_sitio') {
      if (abierta) abierta.salida = abierta.salida ?? e.hora;
      abierta = { sitioId: e.sitioId ?? null, nombre: e.sitioNombre || 'Parque', clave: e.sitioClave || null, llegada: e.hora, salida: null, enviado: e.enviado !== false };
      visitas.push(abierta);
    } else if ((e.tipo === 'salida_sitio' || e.tipo === 'fin_bloque') && abierta) {
      abierta.salida = e.hora;
      abierta.enviado = abierta.enviado && e.enviado !== false;
      abierta = null;
    }
  }
  return visitas;
}

export const formatoHoras = hhmm;

// ----- fin de js/reglas.js -----

// ----- logica.js -----
// Lógica de la función avisos (HU-15b y HU-30). JavaScript puro: la usan index.ts (Supabase) y las pruebas locales.
// Usa las MISMAS reglas de jornada que la app (js/reglas.js), así el aviso del servidor dice lo mismo que la pantalla.
//
// Cada 5 minutos se calculan:
//   · al asesor: "¿Olvidaste checar salida?" si un bloque sigue abierto `recordatorio_salida_min` (30) después de su fin;
//   · a coordinación y administración: "Sin checar" (pasaron `aviso_sin_checar_min` (30) desde el inicio de un bloque
//     programado sin checada de entrada, y el bloque no ha terminado) y "Bloque sin cerrar" (`aviso_coord_bloque_abierto_min`
//     (60) después del fin). Un aviso por persona, bloque y día; nunca sobre uno mismo.
// Todo es configurable por organización (organizaciones.config). Nada se repite: `enviados` trae lo ya mandado.

export const DEFECTO = { recordatorio_salida_min: 30, aviso_sin_checar_min: 30, aviso_coord_bloque_abierto_min: 60 };
const aMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const NOMBRE = { escritorio: 'escritorio', campo: 'campo' };

// organizaciones: [{ id, zona_horaria, config }]; miembros: activos [{ id, organizacion_id, nombre_completo, rol }];
// horarios: filas de `horarios`; eventos: checadas recientes [{ miembro_id, tipo, bloque, modalidad, hora_efectiva, sitio_id }];
// enviados: Set de `${miembro_id}|${clave}`. Devuelve [{ miembro_id, organizacion_id, claves, titulo, cuerpo, tag, url }].
export function avisosPendientes({ ahora = new Date(), organizaciones, miembros, horarios, eventos, enviados = new Set() }) {
  const avisos = [];
  const yaEnviado = (miembroId, clave) => enviados.has(`${miembroId}|${clave}`);
  for (const org of organizaciones) {
    const zona = org.zona_horaria || 'America/Mazatlan';
    const config = { ...DEFECTO, ...(org.config || {}) };
    const { fecha, minutos } = partesLocales(ahora, zona);
    const gente = miembros.filter((m) => m.organizacion_id === org.id);
    const pendientesCoord = [];   // { persona, clave, texto }
    for (const m of gente) {
      const horario = horarioDelDia(horarios.filter((h) => h.miembro_id === m.id), ahora, zona);
      if (!horario.length) continue;   // días sin horario (p. ej. sábado): ni recordatorio ni "sin checar"
      const evs = eventos.filter((e) => e.miembro_id === m.id && partesLocales(e.hora_efectiva, zona).fecha === fecha)
        .map((e) => ({ id: e.id, tipo: e.tipo, bloque: e.bloque, modalidad: e.modalidad, hora: e.hora_efectiva, sitioId: e.sitio_id }));

      // Al asesor: olvido de salida (la misma alerta que muestra la app)
      for (const a of calcularEstado({ eventos: evs, horario, ahora, zona, config }).alertas.filter((x) => x.tipo === 'olvido_fin')) {
        const clave = `salida:${fecha}:${a.bloque}`;
        if (!yaEnviado(m.id, clave)) {
          avisos.push({ miembro_id: m.id, organizacion_id: org.id, claves: [clave], titulo: '¿Olvidaste checar salida?', cuerpo: a.texto,
            tag: `salida-${fecha}-${a.bloque}`, url: './#inicio' });
        }
      }

      // A coordinación: sin checar (dentro del bloque) y bloque sin cerrar (más tarde que el recordatorio del asesor)
      for (const h of horario) {
        const inicioChecado = evs.some((e) => e.tipo === 'inicio_bloque' && e.bloque === h.bloque);
        if (!inicioChecado && minutos > aMin(h.inicio) + Number(config.aviso_sin_checar_min) && minutos < aMin(h.fin)) {
          pendientesCoord.push({ persona: m, clave: `coord:sin_checar:${m.id}:${fecha}:${h.bloque}`,
            texto: `${m.nombre_completo} no ha iniciado ${NOMBRE[h.bloque]} (programado ${h.inicio})` });
        }
      }
      const configCoord = { ...config, recordatorio_salida_min: Number(config.aviso_coord_bloque_abierto_min) };
      for (const a of calcularEstado({ eventos: evs, horario, ahora, zona, config: configCoord }).alertas.filter((x) => x.tipo === 'olvido_fin')) {
        const fin = horario.find((h) => h.bloque === a.bloque)?.fin;
        pendientesCoord.push({ persona: m, clave: `coord:abierto:${m.id}:${fecha}:${a.bloque}`,
          texto: `${m.nombre_completo} no ha cerrado ${NOMBRE[a.bloque]} (terminaba ${fin})` });
      }
    }

    // Un solo aviso por persona de coordinación y revisión, con lo nuevo para ella (nunca sobre sí misma)
    for (const c of gente.filter((x) => x.rol === 'coordinador' || x.rol === 'admin')) {
      const nuevos = pendientesCoord.filter((p) => p.persona.id !== c.id && !yaEnviado(c.id, p.clave));
      if (!nuevos.length) continue;
      avisos.push({
        miembro_id: c.id, organizacion_id: org.id, claves: nuevos.map((p) => p.clave),
        titulo: nuevos.length === 1 ? 'Coordinación: 1 pendiente' : `Coordinación: ${nuevos.length} pendientes`,
        cuerpo: nuevos.map((p) => p.texto).join(' · '),
        tag: `coord-${fecha}-${String(minutos).padStart(4, '0')}`, url: './panel.html'
      });
    }
  }
  return avisos;
}

// ----- fin de logica.js -----

function llaveSecreta(): string | null {
  const clasica = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (clasica) return clasica;
  try {
    const nuevas = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    return nuevas.default || Object.values(nuevas)[0] as string || null;
  } catch { return null; }
}
const URL_SB = Deno.env.get('SUPABASE_URL') || '';
const LLAVE_SECRETA = llaveSecreta();
const sb: any = URL_SB && LLAVE_SECRETA ? createClient(URL_SB, LLAVE_SECRETA, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
// Solo para pruebas locales: permite fijar "ahora". En Supabase esta variable no existe.
const PERMITE_AHORA = Deno.env.get('AVISOS_PERMITE_AHORA') === '1';
const CONTACTO = 'https://github.com/raulopezazueta-bit/asistencia_pa';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
const unico = async (consulta: any) => { const { data, error } = await consulta; if (error) throw error; return data; };
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Llaves VAPID y contraseña del reloj: se crean una sola vez y se guardan en claves_push (solo la llave secreta las lee)
async function claves() {
  let fila = await unico(sb.from('claves_push').select('vapid, token_cron').eq('id', 1).maybeSingle());
  if (!fila) {
    const vapid = await webpush.exportVapidKeys(await webpush.generateVapidKeys({ extractable: true }));
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
    await sb.from('claves_push').insert({ id: 1, vapid, token_cron: token });   // si otra llamada ganó, se usa la suya
    fila = await unico(sb.from('claves_push').select('vapid, token_cron').eq('id', 1).single());
  }
  const servidor = await webpush.ApplicationServer.new({ contactInformation: CONTACTO, vapidKeys: await webpush.importVapidKeys(fila.vapid) });
  return { servidor, token: fila.token_cron as string, publica: base64url(await servidor.getVapidPublicKeyRaw()) };
}

// Envía a todos los teléfonos de una persona; quita los que ya no existen (410/404)
async function enviar(servidor: any, suscripciones: any[], aviso: any) {
  let ok = 0, fallidos = 0;
  const datos = JSON.stringify({ titulo: aviso.titulo, cuerpo: aviso.cuerpo, tag: aviso.tag, url: aviso.url });
  for (const s of suscripciones) {
    try {
      await servidor.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })
        .pushTextMessage(datos, { ttl: 4 * 3600, urgency: webpush.Urgency.High, topic: aviso.tag.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '_') });
      ok++;
    } catch (e: any) {
      fallidos++;
      const estatus = e?.response?.status;
      if (estatus === 404 || estatus === 410) await sb.from('suscripciones_push').delete().eq('endpoint', s.endpoint);
      else console.error('No se pudo enviar el aviso', estatus, e?.message);
    }
  }
  return { ok, fallidos };
}

async function revisar(ahora: Date) {
  const { servidor } = await claves();
  const desde = new Date(ahora.getTime() - 36 * 3600_000).toISOString();
  const [organizaciones, miembros, horarios, eventos, enviados, suscripciones] = await Promise.all([
    unico(sb.from('organizaciones').select('id, zona_horaria, config').eq('activa', true)),
    unico(sb.from('miembros').select('id, organizacion_id, nombre_completo, rol').eq('activo', true)),
    unico(sb.from('horarios').select('miembro_id, dia_semana, bloque, hora_inicio, hora_fin, modalidad, vigente_desde, vigente_hasta')),
    unico(sb.from('eventos_jornada').select('id, miembro_id, tipo, bloque, modalidad, hora_efectiva, sitio_id').gte('hora_efectiva', desde).lte('hora_efectiva', ahora.toISOString())),
    unico(sb.from('avisos_enviados').select('miembro_id, clave').gte('enviado_en', new Date(ahora.getTime() - 3 * 864e5).toISOString())),
    unico(sb.from('suscripciones_push').select('miembro_id, endpoint, p256dh, auth'))
  ]);
  const avisos = avisosPendientes({ ahora, organizaciones, miembros, horarios, eventos,
    enviados: new Set(enviados.map((x: any) => `${x.miembro_id}|${x.clave}`)) });
  const resumen = { avisos: avisos.length, enviados: 0, fallidos: 0, sin_telefono: 0 };
  for (const a of avisos) {
    // Se anota antes de enviar: si dos revisiones coinciden, solo una lo manda (clave única)
    const { error } = await sb.from('avisos_enviados').insert(a.claves.map((clave: string) => ({ organizacion_id: a.organizacion_id, miembro_id: a.miembro_id, clave })));
    if (error) continue;
    const suyas = suscripciones.filter((s: any) => s.miembro_id === a.miembro_id);
    if (!suyas.length) { resumen.sin_telefono++; continue; }
    const r = await enviar(servidor, suyas, a);
    resumen.enviados += r.ok;
    resumen.fallidos += r.fallidos;
  }
  return resumen;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!sb) {
    return json(req.method === 'GET' ? 200 : 500, { funcion: 'avisos', publicada: true, llave_secreta: false,
      error: 'La función avisos no encontró su llave secreta en Supabase. Avisa a soporte (Ecosistémica).' });
  }
  try {
    const url = new URL(req.url);
    // La app pide la llave pública para registrar el teléfono; abrir la dirección sin nada da el diagnóstico
    if (req.method === 'GET') {
      const { publica } = await claves();
      if (url.searchParams.has('llave')) return json(200, { llave_publica: publica });
      return json(200, { funcion: 'avisos', publicada: true, llave_secreta: true, claves_listas: true });
    }
    if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });
    const cuerpo = await req.json().catch(() => ({}));

    // Aviso de prueba a la persona que lo pide (Perfil › Probar aviso)
    if (cuerpo.accion === 'probar') {
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer /i, '');
      const { data } = token ? await sb.auth.getUser(token) : { data: { user: null } };
      if (!data.user) return json(401, { error: 'Sesión no válida. Vuelve a iniciar sesión.' });
      const mios = await unico(sb.from('miembros').select('id').eq('user_id', data.user.id).eq('activo', true));
      const suyas = await unico(sb.from('suscripciones_push').select('miembro_id, endpoint, p256dh, auth').in('miembro_id', mios.map((m: any) => m.id)));
      if (!suyas.length) return json(409, { error: 'Este teléfono aún no está registrado para recibir avisos.' });
      const { servidor } = await claves();
      const r = await enviar(servidor, suyas, { titulo: 'Avisos activados', cuerpo: 'Así llegará el recordatorio de salida, aunque la app esté cerrada.', tag: 'prueba', url: './#perfil' });
      return json(200, r);
    }

    // Revisión programada (pg_cron): exige la contraseña del reloj
    const { token } = await claves();
    if (req.headers.get('x-token-cron') !== token) return json(401, { error: 'No autorizado' });
    const ahora = PERMITE_AHORA && cuerpo.ahora ? new Date(cuerpo.ahora) : new Date();
    return json(200, await revisar(ahora));
  } catch (e) {
    console.error(e);
    return json(500, { error: 'No se pudo completar la revisión de avisos.' });
  }
});
