// Lógica de la función avisos (HU-15b y HU-30). JavaScript puro: la usan index.ts (Supabase) y las pruebas locales.
// Usa las MISMAS reglas de jornada que la app (js/reglas.js), así el aviso del servidor dice lo mismo que la pantalla.
//
// Cada 5 minutos se calculan:
//   · al asesor: "¿Olvidaste checar salida?" si un bloque sigue abierto `recordatorio_salida_min` (30) después de su fin;
//   · a coordinación y administración: "Sin checar" (pasaron `aviso_sin_checar_min` (30) desde el inicio de un bloque
//     programado sin checada de entrada, y el bloque no ha terminado) y "Bloque sin cerrar" (`aviso_coord_bloque_abierto_min`
//     (60) después del fin). Un aviso por persona, bloque y día; nunca sobre uno mismo.
// Todo es configurable por organización (organizaciones.config). Nada se repite: `enviados` trae lo ya mandado.
import { partesLocales, horarioDelDia, calcularEstado } from '../../../js/reglas.js';

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
