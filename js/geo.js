// Ubicación y geocerca en el teléfono (HU-17, docs/ESPECIFICACION.md §4).
// El GPS se lee SOLO al checar (nunca en segundo plano). Los cálculos son informativos:
// la decisión que cuenta la toma el servidor (trigger preparar_evento con PostGIS).

const R = 6371008.8;              // radio medio de la Tierra (m)
const RAD = Math.PI / 180;
export const RADIO_BUSQUEDA_M = 500;   // igual que el servidor
export const TOPE_PRECISION_M = 50;    // la precisión estimada suma como máximo 50 m de margen

// ---------- Distancias (proyección equirectangular local; suficiente a escala de parque) ----------
function proyectar([lon, lat], lat0) {
  return [lon * RAD * R * Math.cos(lat0 * RAD), lat * RAD * R];
}

export function distanciaMetros(a, b) {
  // a, b: { lat, lon } · haversine
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function distanciaASegmento(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const largo2 = dx * dx + dy * dy;
  let t = largo2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / largo2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// ---------- Punto en polígono (ray casting) ----------
function enAnillo([x, y], anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

// multipoligono: coordenadas GeoJSON MultiPolygon [[[ [lon,lat], ... ] (exterior), [...] (huecos) ], ...]
export function puntoEnMultipoligono(punto, multipoligono) {
  const p = [punto.lon, punto.lat];
  return multipoligono.some(([exterior, ...huecos]) => enAnillo(p, exterior) && !huecos.some((h) => enAnillo(p, h)));
}

// Distancia en metros del punto al perímetro; 0 si está dentro (igual que ST_Distance de PostGIS).
export function distanciaAlPoligono(punto, multipoligono) {
  if (puntoEnMultipoligono(punto, multipoligono)) return 0;
  const lat0 = punto.lat;
  const p = proyectar([punto.lon, punto.lat], lat0);
  let minima = Infinity;
  for (const poligono of multipoligono) {
    for (const anillo of poligono) {
      for (let i = 1; i < anillo.length; i++) {
        minima = Math.min(minima, distanciaASegmento(p, proyectar(anillo[i - 1], lat0), proyectar(anillo[i], lat0)));
      }
    }
  }
  return minima;
}

// ---------- Geocerca de un sitio ----------
// sitio: { lat, lon, radioM, toleranciaM, perimetro (GeoJSON|null) } · precision en metros (o null)
// Regla (igual que el servidor): con polígono, distancia ≤ tolerancia + min(precisión, 50);
// sin polígono, distancia al centro ≤ radio + min(precisión, 50).
export function evaluarSitio(sitio, punto, precision) {
  const margen = Math.min(Number(precision) || 0, TOPE_PRECISION_M);
  const conPoligono = Boolean(sitio.perimetro?.coordinates?.length);
  const distancia = conPoligono
    ? distanciaAlPoligono(punto, sitio.perimetro.coordinates)
    : distanciaMetros(punto, { lat: sitio.lat, lon: sitio.lon });
  const limite = (conPoligono ? Number(sitio.toleranciaM) : Number(sitio.radioM)) + margen;
  return { distancia, dentro: distancia <= limite, conPoligono, limite };
}

// Sitio que contiene el punto o, si ninguno, el más cercano a ≤ 500 m (por distancia al perímetro o al centro).
// Devuelve { sitio, distancia, dentro, conPoligono } o null.
export function sitioParaPunto(sitios, punto, precision) {
  const grados = RADIO_BUSQUEDA_M / 111000 + 0.01;   // filtro rápido por caja
  let mejor = null;
  for (const s of sitios) {
    if (Math.abs(s.lat - punto.lat) > grados || Math.abs(s.lon - punto.lon) > grados / Math.cos(punto.lat * RAD)) continue;
    const r = evaluarSitio(s, punto, precision);
    if (r.distancia <= RADIO_BUSQUEDA_M && (!mejor || r.distancia < mejor.distancia)) mejor = { sitio: s, ...r };
  }
  return mejor;
}

// ---------- Lectura del GPS (solo al checar) ----------
// Llama a getCurrentPosition varias veces durante máximo `duracionMs` y se queda con la de menor precisión estimada.
// alLeer(mejor, segundosRestantes) se llama con cada lectura. Devuelve un control con:
//   resultado: Promise<{ mejor: {lat, lon, precision, hora} | null, error: 'permiso'|'no_disponible'|null }>
//   detener(): termina antes (p. ej. la persona confirmó con precisión ≤ 20 m)
export function leerUbicacion({ duracionMs = 20000, alLeer = () => {}, geolocalizacion = globalThis.navigator?.geolocation } = {}) {
  let detenido = false;
  let terminar;
  const fin = new Promise((r) => { terminar = r; });
  const inicio = Date.now();
  const resultado = (async () => {
    if (!geolocalizacion) return { mejor: null, error: 'no_disponible' };
    let mejor = null;
    let error = null;
    while (!detenido) {
      const restante = duracionMs - (Date.now() - inicio);
      if (restante <= 0) break;
      const lectura = await Promise.race([
        new Promise((ok) => geolocalizacion.getCurrentPosition(
          (pos) => ok({ pos }),
          (e) => ok({ e }),
          { enableHighAccuracy: true, timeout: restante, maximumAge: 0 }
        )),
        fin.then(() => ({ detenido: true }))
      ]);
      if (lectura.detenido) break;
      if (lectura.e) {
        if (lectura.e.code === 1) { error = 'permiso'; break; }     // PERMISSION_DENIED
        if (lectura.e.code === 2 && !mejor) error = 'no_disponible';  // POSITION_UNAVAILABLE
        if (lectura.e.code === 3) break;                             // TIMEOUT: se acabó el tiempo
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      const c = lectura.pos.coords;
      const nueva = { lat: c.latitude, lon: c.longitude, precision: c.accuracy, hora: new Date(lectura.pos.timestamp).toISOString() };
      if (!mejor || nueva.precision < mejor.precision) mejor = nueva;
      error = null;
      alLeer(mejor, Math.max(0, Math.ceil((duracionMs - (Date.now() - inicio)) / 1000)));
      await Promise.race([new Promise((r) => setTimeout(r, 1000)), fin]);
    }
    return { mejor, error: mejor ? null : error ?? 'no_disponible' };
  })();
  return { resultado, detener: () => { detenido = true; terminar(); } };
}
