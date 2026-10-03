// HU-17 · Pruebas unitarias de js/geo.js (geocerca en el teléfono).
import { test, expect } from '@playwright/test';
import { puntoEnMultipoligono, distanciaAlPoligono, distanciaMetros, evaluarSitio, sitioParaPunto, leerUbicacion } from '../js/geo.js';

// Parque ficticio ~100×110 m (mismo que supabase/tests/e2e/datos_ficticios.sql, PA-1)
const CUADRO = [[[[-107.4378, 24.8041], [-107.4368, 24.8041], [-107.4368, 24.8051], [-107.4378, 24.8051], [-107.4378, 24.8041]]]];
// Parque con hueco (p. ej. una construcción excluida)
const CON_HUECO = [[
  [[-107.4378, 24.8041], [-107.4368, 24.8041], [-107.4368, 24.8051], [-107.4378, 24.8051], [-107.4378, 24.8041]],
  [[-107.4375, 24.8044], [-107.4371, 24.8044], [-107.4371, 24.8048], [-107.4375, 24.8048], [-107.4375, 24.8044]]
]];
const P1 = { id: 'p1', nombre: 'Parque Uno', lat: 24.8046, lon: -107.4373, radioM: 80, toleranciaM: 30, perimetro: { type: 'MultiPolygon', coordinates: CUADRO } };
const P2 = { id: 'p2', nombre: 'Parque Dos (sin polígono)', lat: 24.8000, lon: -107.4000, radioM: 80, toleranciaM: 30, perimetro: null };

test('punto en polígono: dentro, fuera y en un hueco', () => {
  expect(puntoEnMultipoligono({ lat: 24.8047, lon: -107.4372 }, CUADRO)).toBe(true);
  expect(puntoEnMultipoligono({ lat: 24.8060, lon: -107.4372 }, CUADRO)).toBe(false);
  expect(puntoEnMultipoligono({ lat: 24.8046, lon: -107.4373 }, CON_HUECO)).toBe(false);   // en el hueco
  expect(puntoEnMultipoligono({ lat: 24.8042, lon: -107.4377 }, CON_HUECO)).toBe(true);    // entre hueco y borde
});

test('distancia al perímetro: 0 dentro; al norte ≈ diferencia de latitud', () => {
  expect(distanciaAlPoligono({ lat: 24.8047, lon: -107.4372 }, CUADRO)).toBe(0);
  // 0.0009° al norte del borde = ~100 m
  expect(distanciaAlPoligono({ lat: 24.8060, lon: -107.4373 }, CUADRO)).toBeCloseTo(100.1, 0);
  // Esquina: distancia diagonal al vértice
  const d = distanciaAlPoligono({ lat: 24.8060, lon: -107.4359 }, CUADRO);
  expect(d).toBeGreaterThan(130);
  expect(d).toBeLessThan(140);
});

test('distancia entre puntos (haversine)', () => {
  expect(distanciaMetros({ lat: 24.8, lon: -107.4 }, { lat: 24.801, lon: -107.4 })).toBeCloseTo(111.2, 0);
});

test('regla de zona con polígono: tolerancia + min(precisión, 50)', () => {
  // ~44 m al norte del borde: fuera con precisión 6 (límite 36), dentro con precisión 20 (límite 50)
  const punto = { lat: 24.80550, lon: -107.4373 };
  expect(evaluarSitio(P1, punto, 6)).toMatchObject({ dentro: false, conPoligono: true, limite: 36 });
  expect(evaluarSitio(P1, punto, 20)).toMatchObject({ dentro: true, limite: 50 });
  // La precisión aporta como máximo 50 m
  expect(evaluarSitio(P1, { lat: 24.8060, lon: -107.4373 }, 500)).toMatchObject({ dentro: false, limite: 80 });
});

test('regla de zona sin polígono: radio + min(precisión, 50) al centro', () => {
  expect(evaluarSitio(P2, { lat: 24.8005, lon: -107.4000 }, 5)).toMatchObject({ dentro: true, conPoligono: false });   // ~56 m
  expect(evaluarSitio(P2, { lat: 24.8009, lon: -107.4000 }, 5)).toMatchObject({ dentro: false });                     // ~100 m > 85
  expect(evaluarSitio(P2, { lat: 24.8009, lon: -107.4000 }, 25).dentro).toBe(true);                                    // ~100 m ≤ 105
});

test('sitio para el punto: el que lo contiene, o el más cercano a ≤ 500 m, o ninguno', () => {
  const sitios = [P1, P2];
  expect(sitioParaPunto(sitios, { lat: 24.8047, lon: -107.4372 }, 8)).toMatchObject({ sitio: { id: 'p1' }, distancia: 0, dentro: true });
  const cerca = sitioParaPunto(sitios, { lat: 24.8090, lon: -107.4373 }, 8);   // ~430 m al norte de P1
  expect(cerca.sitio.id).toBe('p1');
  expect(cerca.dentro).toBe(false);
  expect(sitioParaPunto(sitios, { lat: 24.8200, lon: -107.4373 }, 8)).toBeNull();   // > 500 m de todo
});

// GPS falso para probar la lectura sin navegador
function gpsFalso(lecturas) {
  let i = 0;
  return {
    getCurrentPosition(ok, error) {
      const l = lecturas[Math.min(i++, lecturas.length - 1)];
      setTimeout(() => (l.code ? error({ code: l.code }) : ok({ coords: { latitude: l.lat, longitude: l.lon, accuracy: l.acc }, timestamp: Date.now() })), 5);
    }
  };
}

test('lectura de GPS: se queda con la de menor precisión estimada', async () => {
  const lecturas = [];
  const control = leerUbicacion({ duracionMs: 3500, geolocalizacion: gpsFalso([{ lat: 1, lon: 1, acc: 40 }, { lat: 2, lon: 2, acc: 9 }, { lat: 3, lon: 3, acc: 25 }]), alLeer: (m) => lecturas.push(m.precision) });
  const { mejor, error } = await control.resultado;
  expect(error).toBeNull();
  expect(mejor).toMatchObject({ lat: 2, lon: 2, precision: 9 });
  expect(lecturas.slice(0, 2)).toEqual([40, 9]);
});

test('lectura de GPS: se puede detener antes (confirmar con buena precisión)', async () => {
  const control = leerUbicacion({ duracionMs: 20000, geolocalizacion: gpsFalso([{ lat: 5, lon: 5, acc: 12 }]), alLeer: () => control.detener() });
  const inicio = Date.now();
  const { mejor } = await control.resultado;
  expect(mejor.precision).toBe(12);
  expect(Date.now() - inicio).toBeLessThan(2000);
});

test('lectura de GPS: permiso negado', async () => {
  const { mejor, error } = await leerUbicacion({ duracionMs: 2000, geolocalizacion: gpsFalso([{ code: 1 }]) }).resultado;
  expect(mejor).toBeNull();
  expect(error).toBe('permiso');
});

test('lectura de GPS: sin GPS en el aparato', async () => {
  expect(await leerUbicacion({ geolocalizacion: null }).resultado).toEqual({ mejor: null, error: 'no_disponible' });
});
