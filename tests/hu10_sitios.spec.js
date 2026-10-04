// HU-10 · Sitios en caché: descarga al iniciar sesión y una vez al día, IndexedDB, búsqueda, sin señal.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, senal, USUARIOS } from './simulador.js';
import { apiLocalDisponible, conectarApiLocal, CUENTAS, ID } from './api_local.js';

const descargas = (sim) => sim.registro.filter((r) => r.ruta === '/rest/v1/v_sitios_app' && r.metodo === 'GET');
const enTelefono = (page) => page.evaluate(async () => (await (await import('./js/almacen.js')).leerTodo('sitios')).length);

async function entrarYDescargar(page, opciones, usuario = USUARIOS.asesor) {
  const sim = await simularSupabase(page, opciones);
  await page.goto('index.html');
  await entrar(page, usuario);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.locator('[data-pestana="visitas"]').click();
  await expect(page.locator('#catalogo-estado')).toContainText('actualizado hoy');
  return sim;
}

async function buscar(page, texto) {
  await page.locator('#catalogo-buscar').fill(texto);
  await expect(page.locator('#catalogo-resultados li').first()).toBeVisible();
  return page.locator('#catalogo-resultados li');
}

test('al iniciar sesión descarga el catálogo y lo guarda en el teléfono', async ({ page }) => {
  const sim = await entrarYDescargar(page);
  await expect(page.locator('#catalogo-estado')).toContainText('782 parques guardados y 1 sitio más');
  expect(await enTelefono(page)).toBe(783);   // 782 parques + domicilio propio
  expect(descargas(sim)).toHaveLength(1);
  expect(descargas(sim)[0].query).toContain('organizacion_id=eq.11111111-1111-1111-1111-111111111111');
});

test('búsqueda por nombre (sin acentos), clave, id oficial y colonia', async ({ page }) => {
  await entrarYDescargar(page);
  let r = await buscar(page, 'alamo');
  await expect(r.first()).toContainText('Parque Álamo Ficticio');
  r = await buscar(page, 'NANDU');
  await expect(r.first()).toContainText('Jardín Ñandú Ficticio');
  r = await buscar(page, 'f-0123');
  await expect(r.first()).toContainText('Parque Ficticio 123');
  await expect(r.first().locator('.sitio__clave')).toHaveText('F-0123');
  r = await buscar(page, 'FX-100045');
  await expect(r.first()).toContainText('Parque Ficticio 045');
  r = await buscar(page, 'ficticia norte 01');
  await expect(r.first()).toContainText('Colonia Ficticia Norte');
  expect(await r.count()).toBeLessThanOrEqual(20);
  r = await buscar(page, 'zzz inexistente');
  await expect(r.first()).toHaveText('Sin resultados para “zzz inexistente”.');
});

test('sin señal: el catálogo y la búsqueda siguen funcionando', async ({ page, context }) => {
  const sim = await entrarYDescargar(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await senal(context, sim, false);
  await page.reload();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.locator('[data-pestana="visitas"]').click();
  await expect(page.locator('#catalogo-estado')).toContainText('782 parques guardados');
  const r = await buscar(page, 'ficticio 500');
  await expect(r.first()).toContainText('Parque Ficticio 500');
  // Forzar actualización sin señal conserva la copia guardada
  await page.locator('#catalogo-actualizar').click();
  await expect(page.locator('#catalogo-estado')).toContainText('Sin señal: se usa la copia guardada (782 parques');
  expect(await enTelefono(page)).toBe(783);
  await senal(context, sim, true);
});

test('se descarga una vez al día, no en cada apertura', async ({ page }) => {
  const sim = await entrarYDescargar(page);
  await page.reload();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.waitForTimeout(500);
  expect(descargas(sim)).toHaveLength(1);
  // Simula que la última descarga fue ayer
  await page.evaluate(async () => {
    const a = await import('./js/almacen.js');
    const meta = await a.leerMeta('sitios_meta');
    await a.guardarMeta('sitios_meta', { ...meta, fechaLocal: '2000-01-01' });
  });
  await page.reload();
  await expect.poll(() => descargas(sim).length).toBe(2);
});

test('catálogos de más de 1000 sitios se descargan por páginas', async ({ page }) => {
  const sim = await entrarYDescargar(page, { sitiosPA: 1500 });
  await expect(page.locator('#catalogo-estado')).toContainText('1500 parques guardados');
  expect(descargas(sim).map((d) => new URLSearchParams(d.query).get('offset'))).toEqual(['0', '1000']);
  expect(await enTelefono(page)).toBe(1501);
});

test('cada organización solo descarga sus sitios', async ({ page }) => {
  await entrarYDescargar(page, {}, USUARIOS.demo);
  await expect(page.locator('#catalogo-estado')).toContainText('3 parques guardados ·');
  const r = await buscar(page, 'ficticio');
  await expect(r.first().locator('.sitio__clave')).toHaveText(/^G-/);
});

test('al cerrar sesión se borra el catálogo del teléfono', async ({ page }) => {
  await entrarYDescargar(page);
  await page.locator('[data-pestana="perfil"]').click();
  await page.locator('#perfil-salir').click();
  await expect(page.locator('#pantalla-acceso')).toBeVisible();
  expect(await enTelefono(page)).toBe(0);
});

test('contra la API local (PostgREST + RLS reales): columnas y GeoJSON de v_sitios_app', async ({ page }) => {
  test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
  await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, CUENTAS.asesorPA);
  await page.locator('[data-pestana="visitas"]').click();
  await expect(page.locator('#catalogo-estado')).toContainText('2 parques guardados y 1 sitio más');
  const filas = await page.evaluate(async () => (await (await import('./js/almacen.js')).leerTodo('sitios')));
  const p1 = filas.find((f) => f.id === 'bbbbbbbb-0000-0000-0000-000000000001');
  expect(p1).toMatchObject({ clave: 'PA-1', tipo: 'parque', radioM: 80, toleranciaM: 30 });
  expect(p1.lat).toBeCloseTo(24.8046, 4);
  expect(p1.perimetro.type).toBe('MultiPolygon');
  expect(filas.every((f) => f.organizacionId === ID.orgPA)).toBe(true);
});
