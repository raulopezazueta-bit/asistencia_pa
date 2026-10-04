// Mis horas (HU-14): horas efectivas del día y de la semana (lunes a domingo, zona de la organización).
// Días pasados: vista oficial v_jornada_diaria del servidor (bloques cerrados; la comida entre bloques no resta).
// Hoy y los días con checadas aún en el teléfono: se calculan aquí con las mismas reglas (js/reglas.js),
// sumando lo guardado sin enviar, y se marcan "por enviar".
import * as api from './api.js';
import * as jornada from './jornada.js';
import * as incidencias from './incidencias.js';
import { leerMeta, guardarMeta, leerTodo } from './almacen.js';
import { partesLocales, rangoDelDia, horarioDelDia, resumenDelDia, diasDeLaSemana } from './reglas.js';

const mediodia = (fecha) => new Date(`${fecha}T12:00:00Z`);   // instante seguro dentro de ese día local

async function conCopia(clave, miembroId, lunes, pedir) {
  try {
    const filas = await pedir();
    await guardarMeta(clave, { miembroId, lunes, filas });
    return { filas, sinConexion: false };
  } catch (error) {
    if (!api.esErrorDeRed(error)) console.warn(`No se pudo leer ${clave}`, error);
    const copia = await leerMeta(clave);
    return { filas: copia?.miembroId === miembroId && copia.lunes === lunes ? copia.filas : [], sinConexion: true };
  }
}

// Devuelve { dias: [{ fecha, minutos, programados, fuente, porEnviar, revisar, abierta, futuro, hoy }], total, totalProgramado, sinConexion }
export async function semana(perfil, ahora = new Date()) {
  const zona = perfil.organizacion.zonaHoraria;
  const config = perfil.organizacion.config || {};
  const fechas = diasDeLaSemana(ahora, zona);
  const hoy = partesLocales(ahora, zona).fecha;
  const lunes = fechas[0];
  const desde = rangoDelDia(mediodia(lunes), zona).desde;
  const hasta = rangoDelDia(mediodia(fechas[6]), zona).hasta;

  const [oficial, delServidor, locales, horarios, solicitudes] = await Promise.all([
    conCopia('semana_oficial', perfil.miembroId, lunes, () => api.miJornadaDiaria(perfil.miembroId, lunes, fechas[6])),
    conCopia('semana_eventos', perfil.miembroId, lunes, () => api.misEventos(perfil.miembroId, desde.toISOString(), hasta.toISOString())),
    leerTodo('eventos_locales').catch(() => []),
    jornada.horarios(perfil),
    incidencias.mias(perfil)
  ]);
  const corregidas = incidencias.reemplazadas(solicitudes.filas);
  const filasHorario = horarios;
  const porFecha = new Map(oficial.filas.map((f) => [String(f.fecha).slice(0, 10), f]));

  // Eventos por día local: los del servidor (hora efectiva) + los del teléfono aún sin enviar
  const eventosDia = new Map(fechas.map((f) => [f, []]));
  const idsServidor = new Set();
  for (const e of delServidor.filas) {
    idsServidor.add(e.id);
    if (corregidas.has(e.id)) continue;   // igual que la vista oficial: la hora corregida reemplaza a la original
    const f = partesLocales(e.hora_efectiva, zona).fecha;
    eventosDia.get(f)?.push({ id: e.id, tipo: e.tipo, bloque: e.bloque, modalidad: e.modalidad, hora: e.hora_efectiva, estadoRevision: e.estado_revision });
  }
  const pendientesDia = new Set();
  for (const x of locales) {
    if (x.miembroId !== perfil.miembroId || idsServidor.has(x.id)) continue;
    const e = x.evento;
    const f = partesLocales(e.hora_dispositivo, zona).fecha;
    if (!eventosDia.has(f)) continue;
    eventosDia.get(f).push({ id: e.id, tipo: e.tipo, bloque: e.bloque, modalidad: e.modalidad, hora: e.hora_dispositivo });
    if (!x.enviado) pendientesDia.add(f);
  }

  const dias = fechas.map((fecha) => {
    const horario = horarioDelDia(filasHorario, mediodia(fecha), zona);
    const programados = horario.reduce((s, h) => s + (Number(h.fin.slice(0, 2)) * 60 + Number(h.fin.slice(3))) - (Number(h.inicio.slice(0, 2)) * 60 + Number(h.inicio.slice(3))), 0);
    const base = { fecha, programados, hoy: fecha === hoy, futuro: fecha > hoy, porEnviar: pendientesDia.has(fecha) };
    if (base.futuro) return { ...base, minutos: 0, fuente: null, revisar: false, abierta: false };
    if (fecha === hoy || base.porEnviar || (!porFecha.has(fecha) && eventosDia.get(fecha).length)) {
      // Días pasados: un bloque abierto no suma (igual que la vista del servidor); hoy suma hasta ahora.
      const corte = fecha === hoy ? ahora : rangoDelDia(mediodia(fecha), zona).desde;
      const r = resumenDelDia({ eventos: eventosDia.get(fecha), horario, ahora: corte, zona, config });
      const abierta = r.filas.some((f) => f.tipo === 'bloque' && f.estado === 'abierto');
      return { ...base, minutos: r.minutosEfectivos, fuente: 'telefono', revisar: r.calificacion === 'revisar', abierta };
    }
    const f = porFecha.get(fecha);
    return { ...base, minutos: f?.minutos_efectivos ?? 0, fuente: f ? 'servidor' : null, revisar: !!f?.con_revision, abierta: !!f?.jornada_abierta };
  });
  return {
    dias,
    total: dias.reduce((s, d) => s + d.minutos, 0),
    totalProgramado: dias.reduce((s, d) => s + d.programados, 0),
    sinConexion: oficial.sinConexion || delServidor.sinConexion
  };
}

// Medio día libre (HU-32): la actividad fuera de horario de la semana pasada da medio día libre esta semana.
// Devuelve el número de medios días que tiene esta semana, o null sin señal.
export async function mediosDiasEstaSemana(perfil, ahora = new Date()) {
  const zona = perfil.organizacion.zonaHoraria;
  const fechas = diasDeLaSemana(new Date(ahora.getTime() - 7 * 864e5), zona);
  try {
    const [dias, filasHorario] = await Promise.all([api.miJornadaDiaria(perfil.miembroId, fechas[0], fechas[6]), jornada.horarios(perfil)]);
    const fuera = dias.filter((d) => d.minutos_efectivos > 0
      && !horarioDelDia(filasHorario, new Date(`${String(d.fecha).slice(0, 10)}T12:00:00Z`), zona).length).length;
    if (!fuera) return 0;
    return perfil.organizacion.config?.medio_dia_libre_por === 'dia' ? fuera : 1;
  } catch { return null; }
}
