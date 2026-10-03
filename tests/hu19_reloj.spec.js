// HU-19 · Hora doble: aviso si el reloj del teléfono difiere más que el umbral (10 min por defecto) de la hora del servidor.
// El reloj de la página se fija en un lunes a las 16:00; el "servidor" sella su hora en el token al iniciar sesión.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, senal, USUARIOS } from './simulador.js';
import { desfaseDesdeToken } from '../js/reloj.js';

const TELEFONO = new Date('2026-10-05T16:00:00-07:00');
const minutos = (m) => new Date(TELEFONO.getTime() + m * 60_000);

async function entrarCon(page, context, horaServidor, opciones = {}) {
  await page.clock.setFixedTime(TELEFONO);
  const sim = await simularSupabase(page, { sitiosPA: 20, horaServidor, ...opciones });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(page.locator('#horas-programadas')).toHaveText('de 8:00 h programadas');   // Inicio ya pintado
  return sim;
}
const aviso = (page) => page.locator('#aviso-reloj');

test('desfase calculado desde el token: + adelantado, − atrasado, null sin dato', () => {
  const tok = (carga) => `x.${Buffer.from(JSON.stringify(carga)).toString('base64url')}.y`;
  expect(desfaseDesdeToken(tok({ iat: 1000 }), 1_600_000)).toBe(600);
  expect(desfaseDesdeToken(tok({ iat: 1000 }), 400_000)).toBe(-600);
  expect(desfaseDesdeToken(tok({ sub: 'x' }), 1_000_000)).toBeNull();
  expect(desfaseDesdeToken('basura')).toBeNull();
});

test('teléfono atrasado 15 min: aviso en Inicio y en la checada', async ({ page, context }) => {
  await entrarCon(page, context, minutos(15));
  await expect(aviso(page)).toBeVisible();
  await expect(aviso(page)).toContainText('va atrasada 15 min respecto a la del servidor');
  await expect(aviso(page)).toContainText('Ponla en automático');
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 24.7601, longitude: -107.4301, accuracy: 8 });
  await page.locator('#boton-principal').click();
  await expect(page.locator('#checada-reloj')).toContainText('va atrasada 15 min');
});

test('teléfono adelantado 2 h 5 min: aviso con horas', async ({ page, context }) => {
  await entrarCon(page, context, minutos(-125));
  await expect(aviso(page)).toContainText('va adelantada 2 h 5 min');
});

test('diferencia de 3 min (dentro del umbral): sin aviso', async ({ page, context }) => {
  await entrarCon(page, context, minutos(3));
  await expect(aviso(page)).toBeHidden();
});

test('el umbral es configurable por organización (umbral_desfase_min)', async ({ page, context }) => {
  await entrarCon(page, context, minutos(15), { configPA: { umbral_desfase_min: 20 } });
  await expect(aviso(page)).toBeHidden();
});

test('sin señal se sigue avisando con la última medición', async ({ page, context }) => {
  const sim = await entrarCon(page, context, minutos(15));
  await expect(aviso(page)).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await senal(context, sim, false);
  await page.reload();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(aviso(page)).toContainText('va atrasada 15 min');
});

test('cerrar sesión borra la medición', async ({ page, context }) => {
  await entrarCon(page, context, minutos(15));
  await page.locator('[data-pestana="perfil"]').click();
  await page.locator('#perfil-salir').click();
  await expect(page.locator('#pantalla-acceso')).toBeVisible();
  expect(await page.evaluate(async () => (await import('./js/almacen.js')).leerMeta('reloj'))).toBeUndefined();
});
