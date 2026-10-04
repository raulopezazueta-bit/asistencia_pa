// HU-15 · Recordatorio de salida: notificación del teléfono si un bloque sigue abierto después de su fin programado
// + recordatorio_salida_min (30 por omisión). Una sola vez por bloque y día; también con la app en segundo plano.
// Reloj: lunes 5-oct-2026, hora de Culiacán; campo programado 16:00–20:00. Notificaciones capturadas (no se muestran).
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, eventoServidor as ev, USUARIOS } from './simulador.js';

// El Chromium "headless shell" niega siempre las notificaciones: este archivo usa el Chromium completo.
test.use({ channel: 'chromium' });

const DIA = '2026-10-05';
const CAMPO_ABIERTO = [
  ev('inicio_bloque', `${DIA}T09:00`, { bloque: 'escritorio', modalidad: 'teletrabajo' }),
  ev('fin_bloque', `${DIA}T13:00`, { bloque: 'escritorio', modalidad: 'teletrabajo' }),
  ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo' })
];

async function abrir(page, context, hora, { eventos = CAMPO_ABIERTO, permiso = true, configPA = {}, reloj = 'fijo' } = {}) {
  if (permiso) await context.grantPermissions(['notifications']);
  // Se capturan las notificaciones que pide la app
  await page.addInitScript(() => {
    window.__avisos = [];
    ServiceWorkerRegistration.prototype.showNotification = function (titulo, opciones) { window.__avisos.push({ titulo, ...opciones }); return Promise.resolve(); };
  });
  const instante = new Date(`${DIA}T${hora}:00-07:00`);
  if (reloj === 'fijo') await page.clock.setFixedTime(instante);
  else await page.clock.install({ time: instante });
  await simularSupabase(page, { sitiosPA: 20, eventos: eventos.map((x) => ({ ...x })), configPA });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  await expect(page.locator('#pantalla-app')).toBeVisible();
}
const avisos = (page) => page.evaluate(() => window.__avisos);

test('20:31 con el campo abierto: un aviso en la app y una notificación (solo una vez)', async ({ page, context }) => {
  await abrir(page, context, '20:31');
  await expect(page.locator('[data-alerta="olvido_fin"]')).toContainText('¿Olvidaste checar salida?');
  await expect.poll(() => avisos(page)).toHaveLength(1);
  const [a] = await avisos(page);
  expect(a).toMatchObject({ titulo: '¿Olvidaste checar salida?', tag: `salida-${DIA}-campo`, icon: 'assets/icon-192.png' });
  expect(a.body).toContain('El bloque de campo terminaba a las 20:00');
  // Al volver a abrir la app no se repite
  await page.reload();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(page.locator('[data-alerta="olvido_fin"]')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await avisos(page)).toHaveLength(0);
});

test('antes del margen no avisa; al pasar el margen avisa (app abierta, reloj corriendo)', async ({ page, context }) => {
  await abrir(page, context, '20:20', { reloj: 'corriendo' });
  await expect(page.locator('#boton-principal-texto')).toHaveText('Terminar bloque de campo');
  expect(await avisos(page)).toHaveLength(0);
  await page.clock.runFor(11 * 60_000);
  await expect.poll(() => avisos(page)).toHaveLength(1);
});

test('con la app en segundo plano también avisa', async ({ page, context }) => {
  await abrir(page, context, '20:25', { reloj: 'corriendo' });
  await expect(page.locator('#boton-principal-texto')).toHaveText('Terminar bloque de campo');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(7 * 60_000);
  await expect.poll(() => avisos(page)).toHaveLength(1);
});

test('margen configurable (recordatorio_salida_min = 10); Perfil muestra el recordatorio activado', async ({ page, context }) => {
  await abrir(page, context, '20:11', { configPA: { recordatorio_salida_min: 10 } });
  await expect.poll(() => avisos(page)).toHaveLength(1);
  await page.locator('[data-pestana="perfil"]').click();
  await expect(page.locator('#recordatorio-estado')).toContainText('Activado: si un bloque sigue abierto 10 minutos después');
  await expect(page.locator('#recordatorio-activar')).toBeHidden();
});

test('bloque cerrado a tiempo: no hay aviso', async ({ page, context }) => {
  await abrir(page, context, '20:45', { eventos: [...CAMPO_ABIERTO, ev('fin_bloque', `${DIA}T20:00`, { bloque: 'campo' })] });
  await expect(page.locator('#jornada-cerrada')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await avisos(page)).toHaveLength(0);
});

test('sin permiso: el aviso dentro de la app sigue; en Perfil se ofrece activar y, al aceptar, avisa', async ({ page, context }) => {
  await abrir(page, context, '20:40', { permiso: false });
  await expect(page.locator('[data-alerta="olvido_fin"]')).toBeVisible();
  expect(await avisos(page)).toHaveLength(0);
  await page.locator('[data-pestana="perfil"]').click();
  const permiso = await page.evaluate(() => Notification.permission);
  if (permiso === 'default') {
    await expect(page.locator('#recordatorio-activar')).toBeVisible();
    await expect(page.locator('#recordatorio-estado')).toContainText('Necesitamos tu permiso');
  } else {
    await expect(page.locator('#recordatorio-estado')).toContainText('bloqueadas');
  }
  await context.grantPermissions(['notifications']);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));   // al volver a la app se repinta
  await expect.poll(() => avisos(page)).toHaveLength(1);
});
