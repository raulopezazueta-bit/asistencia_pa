// HU-17 · "El servidor coincide con el cálculo del cliente": js/geo.js frente al trigger preparar_evento (PostGIS real).
// Requiere la API local: `bash supabase/tests/e2e/levantar_api_local.sh` (o `npm run prueba:completa`).
// Sitios de supabase/tests/e2e/datos_ficticios.sql: PA-1 con polígono (~100×110 m), PA-2 sin polígono (radio 80 m).
import { test, expect } from '@playwright/test';
import { entrar } from './simulador.js';
import { apiLocalDisponible, conectarApiLocal, CUENTAS } from './api_local.js';

test.beforeAll(async () => {
  test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
});

test.beforeEach(async ({ page }) => {
  await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, CUENTAS.asesorPA);
  await page.locator('[data-pestana="visitas"]').click();
  await expect(page.locator('#catalogo-estado')).toContainText('2 parques guardados');
});

// Calcula en el teléfono, envía SIN sitio_id (para que el servidor elija por su cuenta) y devuelve ambos resultados.
function checarEn(page, punto) {
  return page.evaluate(async (punto) => {
    const geo = await import('./js/geo.js');
    const sitios = await import('./js/sitios.js');
    const api = await import('./js/api.js');
    const perfil = { miembroId: 'aaaaaaaa-0000-0000-0000-000000000001', organizacionId: '11111111-1111-1111-1111-111111111111' };
    const catalogo = await sitios.todos(perfil.organizacionId);
    const cliente = geo.sitioParaPunto(catalogo, punto, punto.precision);
    const evento = { id: crypto.randomUUID(), miembro_id: perfil.miembroId, tipo: 'llegada_sitio', bloque: null, modalidad: 'presencial',
      hora_dispositivo: new Date().toISOString(), capturado_sin_conexion: false, lat: punto.lat, lon: punto.lon, precision_m: punto.precision, sitio_id: null };
    const servidor = await api.insertarEvento(evento);
    const repetido = await api.insertarEvento(evento);   // reintento: no debe duplicar ni fallar
    const { data: filas } = await api.cliente.from('eventos_jornada').select('id').eq('id', evento.id);
    return {
      cliente: cliente && { sitio: cliente.sitio.clave, distancia: cliente.distancia, dentro: cliente.dentro },
      servidor: { sitioId: servidor.sitio_id, distancia: servidor.distancia_sitio_m, dentro: servidor.dentro_geocerca, motivos: servidor.motivos_revision,
        horaEfectiva: servidor.hora_efectiva },
      sitioIdCliente: cliente?.sitio.id ?? null,
      repetido, copias: filas.length
    };
  }, punto);
}

function coinciden(r) {
  expect(r.servidor.sitioId).toBe(r.sitioIdCliente);
  expect(r.servidor.dentro).toBe(r.cliente.dentro);
  expect(Math.abs(r.servidor.distancia - r.cliente.distancia)).toBeLessThan(1.5);   // proyección local vs. geodésica
  expect(r.repetido).toBeNull();
  expect(r.copias).toBe(1);
  expect(Math.abs(new Date(r.servidor.horaEfectiva) - Date.now())).toBeLessThan(60_000);   // hora del servidor
}

test('caso 1 · dentro del polígono de PA-1: ambos dicen dentro, distancia 0', async ({ page }) => {
  const r = await checarEn(page, { lat: 24.8047, lon: -107.4372, precision: 6 });
  expect(r.cliente).toMatchObject({ sitio: 'PA-1', distancia: 0, dentro: true });
  coinciden(r);
  expect(r.servidor.motivos).toEqual([]);
});

test('caso 2 · ~100 m al norte de PA-1: ambos dicen fuera, misma distancia', async ({ page }) => {
  const r = await checarEn(page, { lat: 24.8060, lon: -107.4373, precision: 6 });
  expect(r.cliente).toMatchObject({ sitio: 'PA-1', dentro: false });
  expect(r.cliente.distancia).toBeGreaterThan(95);
  coinciden(r);
  expect(r.servidor.motivos).toContain('fuera_de_geocerca');
});

test('caso 3 · PA-2 sin polígono, ~55 m del centro (radio 80): ambos dicen dentro', async ({ page }) => {
  const r = await checarEn(page, { lat: 24.8005, lon: -107.4000, precision: 5 });
  expect(r.cliente).toMatchObject({ sitio: 'PA-2', dentro: true });
  coinciden(r);
});

test('caso límite · PA-2 a ~87 m del centro con precisión 5 (límite 85 m): ambos dicen fuera', async ({ page }) => {
  const r = await checarEn(page, { lat: 24.80078, lon: -107.4000, precision: 5 });
  expect(r.cliente).toMatchObject({ sitio: 'PA-2', dentro: false });
  coinciden(r);
});

test('recorrido completo por la pantalla: checar dentro de PA-1 y ver "Dentro" según el servidor', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 24.8047, longitude: -107.4372, accuracy: 6 });
  await page.locator('[data-pestana="inicio"]').click();
  await page.locator('#boton-principal').click();   // inicio o fin, según lo que ya haya en la base local
  if (await page.locator('#checada-elegir').isVisible()) await page.locator('#checada-elegir [data-bloque="campo"]').click();
  await expect(page.locator('#checada-zona')).toHaveText('Dentro de la zona de Parque Ficticio Uno.');
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado:visible #checada-resultado-titulo')).toHaveText('Registrado');
  await expect(page.locator('#checada-resultado-lista')).toContainText('Dentro');
  await expect(page.locator('#checada-resultado-lista')).toContainText('Distancia según el servidor0 m');
});
