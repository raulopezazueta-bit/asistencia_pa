// Nómina semanal (HU-32): horas ordinarias de lunes a viernes contra la jornada semanal y compensación por actividad
// fuera de horario. Módulo puro. Regla del Product Owner (Parques Alegres, oct-2026), toda configurable en
// organizaciones.config:
//   jornada_semanal_horas   40  → horas ordinarias por semana (las de días con horario)
//   horas_medio_dia_libre    4  → lo que vale el medio día libre
//   medio_dia_libre_por  'semana' → una semana con actividad fuera de horario (p. ej. sábado) da medio día libre la
//                                    semana siguiente; con 'dia', uno por cada día fuera de horario trabajado
// La actividad fuera de horario NO se paga como extra: se compensa con tiempo libre. El medio día libre de una semana
// baja las horas esperadas de esa semana (no cuenta como falta).

const DEFECTO = { jornada_semanal_horas: 40, horas_medio_dia_libre: 4, medio_dia_libre_por: 'semana' };

export function reglasNomina(config = {}) {
  return {
    jornadaMin: Number(config.jornada_semanal_horas ?? DEFECTO.jornada_semanal_horas) * 60,
    medioDiaMin: Number(config.horas_medio_dia_libre ?? DEFECTO.horas_medio_dia_libre) * 60,
    por: config.medio_dia_libre_por === 'dia' ? 'dia' : 'semana'
  };
}

const sumarDias = (fecha, n) => { const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const lunesDe = (fecha) => sumarDias(fecha, -((new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7));

// Medios días libres que genera una semana según sus días fuera de horario trabajados
function mediosDias(diasFuera, reglas) {
  if (!diasFuera) return 0;
  return reglas.por === 'dia' ? diasFuera : 1;
}

// personas: salida de armarReporte (días con fecha, minutos y fueraDeHorario). Deben incluir la semana ANTERIOR a
// `desde` para saber si se ganó medio día libre. Devuelve una fila por persona y semana que toque [desde, hasta].
export function semanasNomina(personas, { desde, hasta, hoy, config = {} }) {
  const reglas = reglasNomina(config);
  const primerLunes = lunesDe(desde);
  const filas = [];
  for (const p of personas) {
    const porSemana = new Map();
    for (const d of p.dias) {
      const lunes = lunesDe(d.fecha);
      if (!porSemana.has(lunes)) porSemana.set(lunes, { minutosLV: 0, minutosFuera: 0, diasFuera: 0 });
      const s = porSemana.get(lunes);
      if (d.fueraDeHorario) { s.minutosFuera += d.minutos; if (d.minutos > 0) s.diasFuera++; }
      else s.minutosLV += d.minutos;
    }
    for (let lunes = primerLunes; lunes <= hasta; lunes = sumarDias(lunes, 7)) {
      const s = porSemana.get(lunes) || { minutosLV: 0, minutosFuera: 0, diasFuera: 0 };
      const anterior = porSemana.get(sumarDias(lunes, -7));
      const libres = mediosDias(anterior?.diasFuera ?? 0, reglas);
      const esperadas = Math.max(0, reglas.jornadaMin - libres * reglas.medioDiaMin);
      const domingo = sumarDias(lunes, 6);
      const completa = !hoy || domingo < hoy;   // una semana en curso aún no tiene faltante
      filas.push({
        miembro: p.miembro, semana: lunes, domingo, completa,
        minutosLV: s.minutosLV,
        ordinarias: Math.min(s.minutosLV, reglas.jornadaMin),
        excedenteLV: Math.max(0, s.minutosLV - reglas.jornadaMin),
        minutosFuera: s.minutosFuera, diasFuera: s.diasFuera,
        generaMediosDias: mediosDias(s.diasFuera, reglas),
        mediosDiasEstaSemana: libres,
        esperadas,
        faltante: completa ? Math.max(0, esperadas - s.minutosLV) : 0
      });
    }
  }
  return filas;
}

const horas = (min) => (min / 60).toFixed(2);
const celda = (v) => { const t = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const COLUMNAS = ['organizacion', 'num_empleado', 'nombre', 'semana_inicio', 'semana_fin', 'semana_completa', 'horas_lunes_a_viernes',
  'horas_ordinarias', 'horas_excedentes_lunes_a_viernes', 'horas_fuera_de_horario', 'dias_fuera_de_horario',
  'medios_dias_libres_ganados', 'medios_dias_libres_esta_semana', 'horas_esperadas', 'horas_faltantes'];

// CSV semanal para nómina: horas en decimales (7.50 = 7 h 30 min). UTF-8 con BOM para Excel.
export function csvSemanal(filas, organizacion) {
  const lineas = [COLUMNAS.join(',')];
  for (const f of filas) {
    lineas.push([organizacion, f.miembro.num_empleado || '', f.miembro.nombre_completo, f.semana, f.domingo, f.completa ? 'si' : 'no',
      horas(f.minutosLV), horas(f.ordinarias), horas(f.excedenteLV), horas(f.minutosFuera), f.diasFuera,
      f.generaMediosDias, f.mediosDiasEstaSemana, horas(f.esperadas), horas(f.faltante)].map(celda).join(','));
  }
  return `﻿${lineas.join('\r\n')}\r\n`;
}
