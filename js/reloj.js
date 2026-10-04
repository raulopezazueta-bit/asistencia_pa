// Hora doble (HU-19): diferencia entre el reloj del teléfono y la hora del servidor.
// La hora del servidor se toma del "permiso de entrada" (JWT) recién emitido: su campo "iat" es el instante
// en que el servidor lo firmó. Se mide al iniciar sesión y en cada renovación (≈ cada hora con señal).
import { leerMeta, guardarMeta } from './almacen.js';

// Segundos que el teléfono va adelantado (+) o atrasado (−) respecto al servidor; null si no se puede saber.
export function desfaseDesdeToken(token, ahoraMs = Date.now()) {
  try {
    const carga = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const iat = JSON.parse(atob(carga)).iat;
    return Number.isFinite(iat) ? Math.round(ahoraMs / 1000 - iat) : null;
  } catch {
    return null;
  }
}

export async function medir(token) {
  const desfaseSeg = desfaseDesdeToken(token);
  if (desfaseSeg !== null) await guardarMeta('reloj', { desfaseSeg, medidoEn: new Date().toISOString() });
  return desfaseSeg;
}

function duracion(seg) {
  const min = Math.round(Math.abs(seg) / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Texto del aviso, o null si la diferencia está dentro del umbral de la organización (umbral_desfase_min, 10 por defecto).
export async function aviso(config = {}) {
  const r = await leerMeta('reloj').catch(() => null);
  if (!r) return null;
  const umbralSeg = Number(config.umbral_desfase_min ?? 10) * 60;
  if (Math.abs(r.desfaseSeg) <= umbralSeg) return null;
  const sentido = r.desfaseSeg > 0 ? 'adelantada' : 'atrasada';
  return `La hora de tu teléfono va ${sentido} ${duracion(r.desfaseSeg)} respecto a la del servidor. ` +
    'Ponla en automático (Ajustes → Fecha y hora). Con señal, tus checadas cuentan con la hora del servidor.';
}
