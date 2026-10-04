// Horario semanal (HU-09): conversión entre las filas de `horarios` (una por día y bloque) y el editor del panel.
// Módulo puro: no toca la pantalla ni Supabase.
export const NOMBRE_DIA = { 1: 'lun', 2: 'mar', 3: 'mié', 4: 'jue', 5: 'vie', 6: 'sáb', 7: 'dom' };

// Filas vigentes de `horarios` → [{ bloque, dias, inicio, fin, modalidad }] para el editor
export function bloquesDeFilas(filas) {
  return ['escritorio', 'campo'].map((bloque) => {
    const de = filas.filter((f) => f.bloque === bloque).sort((a, b) => a.dia_semana - b.dia_semana);
    return { bloque, dias: de.map((f) => f.dia_semana), inicio: String(de[0]?.hora_inicio || '').slice(0, 5),
      fin: String(de[0]?.hora_fin || '').slice(0, 5), modalidad: de[0]?.modalidad || 'presencial' };
  });
}

export function resumenHorario(bloques) {
  const partes = bloques.filter((b) => b.dias.length).map((b) => {
    const dias = b.dias.join(',') === '1,2,3,4,5' ? 'L–V' : b.dias.map((d) => NOMBRE_DIA[d]).join(', ');
    return `${b.bloque} ${dias} ${b.inicio}–${b.fin}${b.modalidad === 'teletrabajo' ? ' (teletrabajo)' : ''}`;
  });
  return partes.length ? partes.join(' · ') : 'Sin horario';
}

// Valida el editor y devuelve las filas para `horarios`, o { error }
export function filasDeBloques(bloques) {
  const filas = [];
  for (const b of bloques) {
    if (!b.dias.length) continue;
    if (!b.inicio || !b.fin || b.fin <= b.inicio) return { error: `En ${b.bloque}, la hora de fin debe ser posterior a la de inicio.` };
    for (const d of b.dias) filas.push({ dia_semana: d, bloque: b.bloque, hora_inicio: b.inicio, hora_fin: b.fin, modalidad: b.modalidad });
  }
  const [e, c] = bloques;
  if (e.dias.some((d) => c.dias.includes(d)) && e.inicio < c.fin && c.inicio < e.fin) return { error: 'Los bloques de escritorio y campo se enciman en algún día.' };
  return { filas };
}

