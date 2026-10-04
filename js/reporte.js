// Reporte de jornada (HU-31): datos para la página de impresión (autoridad) y el CSV para nómina.
// Módulo puro. Las horas oficiales vienen de la vista v_jornada_diaria (la misma regla del servidor: la comida entre
// bloques no resta, un bloque sin cerrar no suma); las checadas sirven para el detalle y las marcas.
import { partesLocales, horarioDelDia } from './reglas.js';
import { MOTIVOS } from './bandeja.js';

const NOMBRE_TIPO = {
  inicio_bloque: 'inicio de bloque', fin_bloque: 'fin de bloque', inicio_pausa: 'inicio de pausa',
  fin_pausa: 'regreso de pausa', llegada_sitio: 'llegada a parque', salida_sitio: 'salida de parque'
};
const hora = (iso, zona) => {
  const m = partesLocales(iso, zona).minutos;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const horasMinutos = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

// miembros: [{ id, nombre_completo, num_empleado, rol }]; dias: filas de v_jornada_diaria;
// eventos: checadas del periodo (ya sin las corregidas por incidencia); revisiones: [{ evento_id, decision, comentario }];
// horarios: filas con miembro_id. Devuelve [{ miembro, dias: [...], totalMinutos, diasConRegistro }].
export function armarReporte({ miembros, dias, eventos, revisiones = [], horarios = [], zona = 'America/Mazatlan' }) {
  const revision = new Map(revisiones.map((r) => [r.evento_id, r]));
  const personas = [];
  for (const m of miembros) {
    const evsPersona = eventos.filter((e) => e.miembro_id === m.id)
      .map((e) => ({ ...e, fecha: partesLocales(e.hora_efectiva, zona).fecha }))
      .sort((a, b) => new Date(a.hora_efectiva) - new Date(b.hora_efectiva));
    const oficiales = new Map(dias.filter((d) => d.miembro_id === m.id).map((d) => [String(d.fecha).slice(0, 10), d]));
    const fechas = [...new Set([...oficiales.keys(), ...evsPersona.map((e) => e.fecha)])].sort();
    const filas = [];
    for (const fecha of fechas) {
      const d = oficiales.get(fecha);
      const evs = evsPersona.filter((e) => e.fecha === fecha);
      // Bloques con su modalidad (de la checada de inicio)
      const bloques = Object.entries(d?.bloques || {}).map(([bloque, b]) => ({
        bloque, inicio: b.inicio ? hora(b.inicio, zona) : null, fin: b.fin ? hora(b.fin, zona) : null,
        modalidad: evs.find((e) => e.tipo === 'inicio_bloque' && e.bloque === bloque)?.modalidad || 'presencial'
      })).sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
      const pausas = [];
      let abierta = null;
      for (const e of evs) {
        if (e.tipo === 'inicio_pausa') abierta = { inicio: hora(e.hora_efectiva, zona), fin: null };
        if (e.tipo === 'fin_pausa' && abierta) { abierta.fin = hora(e.hora_efectiva, zona); pausas.push(abierta); abierta = null; }
      }
      if (abierta) pausas.push(abierta);

      const marcas = [];
      if (d?.jornada_abierta) marcas.push('Bloque sin cerrar (no suma horas)');
      if (d?.bloque_inconsistente) marcas.push('Bloque con fin antes del inicio');
      const horario = horarioDelDia(horarios.filter((h) => h.miembro_id === m.id), new Date(`${fecha}T12:00:00Z`), zona);
      if (!horario.length && evs.length) marcas.push('Fuera de horario');
      for (const e of evs.filter((x) => x.origen === 'incidencia')) marcas.push(`Incidencia aprobada: ${NOMBRE_TIPO[e.tipo]}${e.bloque ? ` de ${e.bloque}` : ''} ${hora(e.hora_efectiva, zona)}`);
      for (const e of evs.filter((x) => x.estado_revision === 'revisar')) {
        const r = revision.get(e.id);
        const motivos = (e.motivos_revision || []).map((x) => MOTIVOS[x] || x).join(', ');
        const estado = r ? (r.decision === 'validada' ? 'validada' : `observada${r.comentario ? `: ${r.comentario}` : ''}`) : 'por revisar';
        const nombre = NOMBRE_TIPO[e.tipo];
        marcas.push(`${nombre[0].toUpperCase()}${nombre.slice(1)} ${hora(e.hora_efectiva, zona)} (${motivos}) · ${estado}`);
      }
      filas.push({
        fecha, entrada: d?.inicio_jornada ? hora(d.inicio_jornada, zona) : null, salida: d?.fin_jornada ? hora(d.fin_jornada, zona) : null,
        bloques, pausas, minutosPausa: d?.minutos_pausa ?? 0, minutos: d?.minutos_efectivos ?? 0,
        abierta: !!d?.jornada_abierta, revision: evs.some((e) => e.estado_revision === 'revisar'),
        incidencia: evs.some((e) => e.origen === 'incidencia'), fueraDeHorario: !horario.length && evs.length > 0, marcas
      });
    }
    personas.push({ miembro: m, dias: filas, totalMinutos: filas.reduce((s, f) => s + f.minutos, 0), diasConRegistro: filas.filter((f) => f.minutos > 0 || f.bloques.length).length });
  }
  return personas;
}

// CSV genérico para nómina: una fila por persona y día. UTF-8 con BOM (Excel muestra bien los acentos).
const COLUMNAS = ['organizacion', 'num_empleado', 'nombre', 'fecha', 'entrada', 'salida', 'minutos_efectivos', 'horas_efectivas',
  'horas_decimal', 'minutos_pausa_en_bloque', 'bloque_sin_cerrar', 'con_revision', 'con_incidencia', 'fuera_de_horario'];
const celda = (v) => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export function csvNomina(personas, organizacion) {
  const lineas = [COLUMNAS.join(',')];
  for (const p of personas) {
    for (const d of p.dias) {
      lineas.push([organizacion, p.miembro.num_empleado || '', p.miembro.nombre_completo, d.fecha, d.entrada || '', d.salida || '',
        d.minutos, horasMinutos(d.minutos), (d.minutos / 60).toFixed(2), d.minutosPausa,
        d.abierta ? 'si' : 'no', d.revision ? 'si' : 'no', d.incidencia ? 'si' : 'no', d.fueraDeHorario ? 'si' : 'no'].map(celda).join(','));
    }
  }
  return `﻿${lineas.join('\r\n')}\r\n`;
}
