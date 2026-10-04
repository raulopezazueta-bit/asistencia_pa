// Bandeja de revisión (HU-23). Módulo puro: separa las checadas "revisar" en por revisar y revisadas.
// Una checada queda revisada si coordinación dejó su decisión (tabla revisiones, migración 0004) o si una incidencia
// aprobada ya la corrigió o la aclaró (corrección de hora o "fuera de zona").

export const MOTIVOS = {
  fuera_de_geocerca: 'Fuera de zona', sin_ubicacion: 'Sin ubicación', sin_selfie: 'Sin selfie',
  reloj_desfasado: 'Reloj del teléfono desfasado', hora_futura: 'Hora en el futuro', sin_conexion_prolongada: 'Enviada muchas horas después'
};

export function armarBandeja({ eventos, revisiones = [], incidencias = [] }) {
  const revision = new Map(revisiones.map((r) => [r.evento_id, r]));
  const porRevisar = [];
  const revisadas = [];
  for (const e of eventos) {
    const deEsta = incidencias.filter((i) => i.evento_original_id === e.id);
    const aclarada = deEsta.find((i) => i.estado === 'aprobada' && ['correccion_hora', 'fuera_geocerca'].includes(i.tipo)) || null;
    const item = { evento: e, revision: revision.get(e.id) || null, incidenciaAprobada: aclarada,
      incidenciaPendiente: deEsta.some((i) => i.estado === 'pendiente') };
    (item.revision || item.incidenciaAprobada ? revisadas : porRevisar).push(item);
  }
  return { porRevisar, revisadas };
}
