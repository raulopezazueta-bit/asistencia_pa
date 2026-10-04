// Tablero del día para coordinación (HU-27, docs/ESPECIFICACION.md §8). Módulo puro: recibe los datos de la
// organización y devuelve las tarjetas y la tabla por persona, con las mismas reglas que la app del asesor (js/reglas.js).
import { calcularEstado, resumenDelDia, horarioDelDia, rangoDelDia, partesLocales } from './reglas.js';

const TOLERANCIA_ENTRADA_MIN = 10;
const aMinutos = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

// miembros: [{ id, nombre_completo, rol }]; horarios: filas de `horarios` con miembro_id;
// eventos: filas de `eventos_jornada` de la semana (lunes → ahora); corregidas: Set de ids reemplazados por incidencia;
// sitios: catálogo [{ id, nombre, clave, tipo }]; pendientes: número de incidencias por resolver.
export function tableroDelDia({ miembros, horarios, eventos, corregidas = new Set(), sitios = [], pendientes = 0, ahora = new Date(), zona = 'America/Mazatlan', config = {} }) {
  const hoy = rangoDelDia(ahora, zona);
  const porSitio = new Map(sitios.map((s) => [s.id, s]));
  const vigentes = eventos.filter((e) => !corregidas.has(e.id));
  const deHoy = vigentes.filter((e) => { const t = new Date(e.hora_efectiva).getTime(); return t >= hoy.desde.getTime() && t < hoy.hasta.getTime(); });
  const minAhora = partesLocales(ahora, zona).minutos;
  const tolerancia = Number(config.tolerancia_entrada_min ?? TOLERANCIA_ENTRADA_MIN);

  const filas = [];
  for (const m of miembros) {
    const horario = horarioDelDia(horarios.filter((h) => h.miembro_id === m.id), ahora, zona);
    const evs = deHoy.filter((e) => e.miembro_id === m.id).map((e) => ({
      id: e.id, tipo: e.tipo, bloque: e.bloque, modalidad: e.modalidad, hora: e.hora_efectiva, sitioId: e.sitio_id,
      sitioNombre: porSitio.get(e.sitio_id)?.nombre, estadoRevision: e.estado_revision
    }));
    // Solo personas que hoy tienen horario o registraron algo (p. ej. administración sin horario no aparece)
    if (!horario.length && !evs.length) continue;
    const r = resumenDelDia({ eventos: evs, horario, ahora, zona, config });
    const e = calcularEstado({ eventos: evs, horario, ahora, zona, config });
    const entrada = evs.filter((x) => x.tipo === 'inicio_bloque').sort((a, b) => new Date(a.hora) - new Date(b.hora))[0]?.hora ?? null;

    let estado;
    if (evs.length) estado = r.calificacion;   // en_regla | retardo | revisar
    else if (horario.some((h) => minAhora > aMinutos(h.inicio) + tolerancia)) estado = 'sin_checar';
    else estado = 'por_iniciar';

    // Dónde está ahora: parque actual; si no, el sitio de la última checada del bloque abierto
    let sitio = null;
    if (e.enSitio) sitio = e.enSitio.nombre;
    else if (e.bloqueAbierto) {
      const inicio = [...evs].reverse().find((x) => x.tipo === 'inicio_bloque' && x.bloque === e.bloqueAbierto);
      const ultima = [...evs].sort((a, b) => new Date(a.hora) - new Date(b.hora)).filter((x) => x.sitioNombre).pop();
      sitio = inicio?.modalidad === 'teletrabajo' ? 'Teletrabajo' : ultima?.sitioNombre ?? null;
    }
    const situacion = e.estado === 'en_pausa' ? 'en_pausa' : e.bloqueAbierto ? 'en_jornada' : evs.length ? 'fuera' : 'sin_registro';
    filas.push({ miembroId: m.id, nombre: m.nombre_completo, rol: m.rol, entrada, sitio, minutos: r.minutosEfectivos,
      programados: r.minutosProgramados, estado, situacion, bloqueAbierto: e.bloqueAbierto || null, olvido: e.alertas.some((a) => a.tipo === 'olvido_fin') });
  }
  const ORDEN = { sin_checar: 0, revisar: 1, retardo: 2, en_regla: 3, por_iniciar: 4 };
  filas.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.nombre.localeCompare(b.nombre, 'es'));

  // Tarjetas
  const conZona = vigentes.filter((e) => e.dentro_geocerca === true || e.dentro_geocerca === false);
  const parques = new Set(deHoy.filter((e) => e.sitio_id && porSitio.get(e.sitio_id)?.tipo === 'parque'
    && ['llegada_sitio', 'inicio_bloque', 'fin_bloque'].includes(e.tipo)).map((e) => e.sitio_id));
  return {
    filas,
    tarjetas: {
      enJornada: filas.filter((f) => f.situacion === 'en_jornada' || f.situacion === 'en_pausa').length,
      total: filas.length,
      dentroDeZona: conZona.length ? Math.round((conZona.filter((e) => e.dentro_geocerca).length / conZona.length) * 100) : null,
      checadasConZona: conZona.length,
      pendientes,
      parquesHoy: parques.size
    }
  };
}
