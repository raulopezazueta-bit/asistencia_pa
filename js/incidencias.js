// Incidencias (HU-28/29): solicitudes de corrección del asesor. Nada se edita ni se borra:
// al aprobarse, el servidor agrega una checada nueva con origen 'incidencia'; si era una corrección de hora,
// la checada original sigue guardada pero deja de contar (igual que en la vista v_jornada_diaria, migración 0003).
import * as api from './api.js';
import { leerMeta, guardarMeta } from './almacen.js';

export const TIPOS = {
  omision: 'Olvidé checar',
  correccion_hora: 'La hora quedó mal',
  fuera_geocerca: 'Estaba en el sitio, pero salió fuera de zona',
  otro: 'Otro'
};
export const CHECADAS = {
  inicio_bloque: 'Inicio de bloque', fin_bloque: 'Fin de bloque', inicio_pausa: 'Inicio de comida/pausa',
  fin_pausa: 'Regreso de comida/pausa', llegada_sitio: 'Llegada a parque', salida_sitio: 'Salida de parque'
};
export const ESTADOS = { pendiente: ['Pendiente', 'chip--aviso'], aprobada: ['Aprobada', 'chip--ok'], rechazada: ['Rechazada', 'chip--critico'] };

export function nombreChecada(tipo, bloque) {
  return `${CHECADAS[tipo] || tipo}${bloque ? ` de ${bloque}` : ''}`;
}

// Solicitudes de la persona; sin señal, la última copia guardada.
export async function mias(perfil) {
  try {
    const filas = await api.misIncidencias(perfil.miembroId);
    await guardarMeta('incidencias', { miembroId: perfil.miembroId, filas });
    return { filas, sinConexion: false };
  } catch (error) {
    if (!api.esErrorDeRed(error)) console.warn('No se pudieron leer las incidencias', error);
    const copia = await leerMeta('incidencias');
    return { filas: copia?.miembroId === perfil.miembroId ? copia.filas : [], sinConexion: true };
  }
}

// Ids de checadas cuya hora fue corregida por una incidencia aprobada (ya no cuentan).
export function reemplazadas(filas) {
  return new Set(filas.filter((i) => i.estado === 'aprobada' && i.tipo === 'correccion_hora' && i.evento_original_id)
    .map((i) => i.evento_original_id));
}

export async function solicitar(perfil, datos) {
  const fila = { id: crypto.randomUUID(), miembro_id: perfil.miembroId, ...datos };
  await api.solicitarIncidencia(fila);
  return fila;
}
