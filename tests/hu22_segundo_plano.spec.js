// HU-22 · Background Sync: con la app cerrada, el service worker envía lo pendiente al volver la señal.
// El Chromium "headless shell" (el ligero de pruebas) trae Background Sync apagado: este archivo usa el Chromium completo.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, senal, tomarSelfie, USUARIOS } from './simulador.js';

test.use({ channel: 'chromium' });

const PARQUE_1 = { latitude: 24.7601, longitude: -107.4301, accuracy: 8 };
const indicador = (page) => page.locator('#indicador-envio');

async function entrarYAbrirChecada(page, context, opciones = {}, usuario = USUARIOS.asesor) {
  await page.clock.setFixedTime(new Date('2026-10-05T16:00:00-07:00'));
  await context.grantPermissions(['geolocation', 'background-sync']);
  await context.setGeolocation(PARQUE_1);
  const sim = await simularSupabase(page, { sitiosPA: 60, ...opciones });
  await page.goto('index.html');
  await entrar(page, usuario);
  await page.locator('[data-pestana="visitas"]').click();
  await expect(page.locator('#catalogo-estado')).toContainText('actualizado');
  await page.locator('[data-pestana="inicio"]').click();
  await expect(indicador(page)).toHaveText('Todo enviado');
  await page.evaluate(() => navigator.serviceWorker.ready);
  return sim;
}

async function checarSinSenal(page, context, sim) {
  await senal(context, sim, false);
  await page.locator('#boton-principal').click();
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado:visible #checada-resultado-titulo')).toHaveText('Guardado en el teléfono');
  await page.locator('#checada-listo').click();
  return page.evaluate(async () => (await (await import('./js/almacen.js')).leerTodo('eventos_pendientes'))[0]);
}

test('con la app cerrada, el service worker envía la selfie y el evento al volver la señal', async ({ page, context }) => {
  const sim = await entrarYAbrirChecada(page, context);
  const p = await checarSinSenal(page, context, sim);
  const origen = new URL(page.url()).origin;
  const etiquetas = await page.evaluate(async () => (await navigator.serviceWorker.ready).sync.getTags());
  expect(etiquetas).toContain('enviar-pendientes');

  // Cerrar la app y recuperar la señal
  const otra = await context.newPage();
  await page.close();
  await senal(context, sim, true);
  const cdp = await context.newCDPSession(otra);
  const registro = new Promise((ok) => cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
    const r = registrations.find((x) => x.scopeURL.startsWith(origen) && !x.isDeleted);
    if (r) ok(r.registrationId);
  }));
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.dispatchSyncEvent', { origin: origen, registrationId: await registro, tag: 'enviar-pendientes', lastChance: false });

  // El navegador también dispara el envío por su cuenta al volver la señal: lo que importa es que el servidor
  // guarde UNA sola checada (reintentar nunca duplica).
  await expect.poll(() => new Set(sim.estado.recibidos.map((e) => e.id)).size, { timeout: 10_000 }).toBe(1);
  expect(sim.estado.recibidos[0]).toMatchObject({ id: p.id, capturado_sin_conexion: true });
  expect(sim.estado.recibidos[0]._prefer).toContain('resolution=ignore-duplicates');
  expect(sim.estado.selfies.map((s) => s.ruta)).toEqual([p.evento.selfie_path]);   // una sola foto guardada
  expect(sim.estado.selfies[0].tipo).toBe('image/webp');

  // Al volver a abrir la app ya no hay nada pendiente
  await otra.goto('index.html');
  await expect(otra.locator('#pantalla-app')).toBeVisible();
  await expect(otra.locator('#indicador-envio')).toHaveText('Todo enviado');
});
