// HU-15b / HU-30 · Avisos con la app cerrada (Web Push): lógica de la función avisos, registro del teléfono en la app,
// aviso de prueba, baja al cerrar sesión y recepción del aviso en el service worker. Lunes 5-oct-2026. Datos ficticios.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, eventoServidor as ev, HORARIO_ASESOR, USUARIOS, LLAVE_PUSH_PUBLICA } from './simulador.js';
import { avisosPendientes } from '../supabase/functions/avisos/logica.js';

const ORG = { id: 'org', zona_horaria: 'America/Mazatlan', config: {} };
const ANA = { id: 'ana', organizacion_id: 'org', nombre_completo: 'Ana Ficticia', rol: 'asesor' };
const BETO = { id: 'beto', organizacion_id: 'org', nombre_completo: 'Beto Ficticio', rol: 'asesor' };
const COORD = { id: 'coord', organizacion_id: 'org', nombre_completo: 'Coordinación Ficticia', rol: 'coordinador' };
const horario = (m) => HORARIO_ASESOR.map((h) => ({ ...h, miembro_id: m }));
const evento = (m, tipo, hhmm, bloque) => ({ ...ev(tipo, `2026-10-05T${hhmm}`, { bloque }), miembro_id: m });
const a = (hhmm) => new Date(`2026-10-05T${hhmm}:00-07:00`);
const calcular = (hhmm, { eventos = [], enviados = [], config = {}, miembros = [ANA, BETO, COORD], horarios = [...horario('ana'), ...horario('beto'), ...horario('coord')] } = {}) =>
  avisosPendientes({ ahora: a(hhmm), organizaciones: [{ ...ORG, config }], miembros, horarios, eventos, enviados: new Set(enviados) });

test('asesor: "¿Olvidaste checar salida?" a los 30 min del fin; una sola vez', () => {
  const eventos = [evento('ana', 'inicio_bloque', '16:00', 'campo'), evento('beto', 'inicio_bloque', '16:00', 'campo'), evento('beto', 'fin_bloque', '20:00', 'campo'),
    evento('coord', 'inicio_bloque', '16:00', 'campo'), evento('coord', 'fin_bloque', '20:00', 'campo')];
  expect(calcular('20:29', { eventos }).filter((x) => x.miembro_id === 'ana')).toEqual([]);
  const r = calcular('20:31', { eventos });
  expect(r).toEqual([{ miembro_id: 'ana', organizacion_id: 'org', claves: ['salida:2026-10-05:campo'], titulo: '¿Olvidaste checar salida?',
    cuerpo: expect.stringContaining('El bloque de campo terminaba a las 20:00'), tag: 'salida-2026-10-05-campo', url: './#inicio' }]);
  expect(calcular('20:40', { eventos, enviados: ['ana|salida:2026-10-05:campo'] })).toEqual([]);
  // A coordinación, una hora después del fin (60 min): un solo aviso agrupado
  const coord = calcular('21:01', { eventos, enviados: ['ana|salida:2026-10-05:campo'] });
  expect(coord.map((x) => [x.miembro_id, x.titulo, x.cuerpo, x.claves, x.url])).toEqual([
    ['coord', 'Coordinación: 1 pendiente', 'Ana Ficticia no ha cerrado campo (terminaba 20:00)', ['coord:abierto:ana:2026-10-05:campo'], './panel.html']]);
});

test('coordinación: "sin checar" a los 30 min del inicio, agrupado, nunca sobre sí misma ni después del bloque', () => {
  const r = calcular('09:31');
  expect(r.map((x) => [x.miembro_id, x.titulo, x.cuerpo])).toEqual([
    ['coord', 'Coordinación: 2 pendientes', 'Ana Ficticia no ha iniciado escritorio (programado 09:00) · Beto Ficticio no ha iniciado escritorio (programado 09:00)']]);
  expect(calcular('09:29')).toEqual([]);
  expect(calcular('13:30')).toEqual([]);                                  // el bloque ya terminó: ya no se avisa
  const yaAvisado = calcular('09:45', { enviados: ['coord|coord:sin_checar:ana:2026-10-05:escritorio'] });
  expect(yaAvisado[0].claves).toEqual(['coord:sin_checar:beto:2026-10-05:escritorio']);
  expect(calcular('09:16', { config: { aviso_sin_checar_min: 15 } })).toHaveLength(1);   // configurable
  // Dos personas de coordinación: cada una recibe lo de las demás, no lo propio
  const COORD2 = { ...COORD, id: 'coord2', nombre_completo: 'Admin Ficticia', rol: 'admin' };
  const dos = calcular('09:31', { miembros: [ANA, COORD, COORD2], horarios: [...horario('ana'), ...horario('coord'), ...horario('coord2')] });
  expect(dos.map((x) => [x.miembro_id, x.cuerpo])).toEqual([
    ['coord', 'Ana Ficticia no ha iniciado escritorio (programado 09:00) · Admin Ficticia no ha iniciado escritorio (programado 09:00)'],
    ['coord2', 'Ana Ficticia no ha iniciado escritorio (programado 09:00) · Coordinación Ficticia no ha iniciado escritorio (programado 09:00)']]);
});

test('días sin horario (sábado): ningún aviso', () => {
  const sabado = avisosPendientes({ ahora: new Date('2026-10-10T10:00:00-07:00'), organizaciones: [ORG], miembros: [ANA, COORD],
    horarios: [...horario('ana')], eventos: [], enviados: new Set() });
  expect(sabado).toEqual([]);
});

// Push simulado en el navegador: no hay servicio de avisos real en las pruebas
async function conPushFalso(page) {
  await page.addInitScript(() => {
    // La suscripción "vive" en el navegador como la real: se conserva al recargar
    const ENDPOINT = 'https://push.ejemplo.test/telefono-1';
    const crear = () => ({ endpoint: ENDPOINT,
      toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: `B${'x'.repeat(86)}`, auth: 'a'.repeat(22) } }),
      unsubscribe: async () => { window.__push.bajas++; localStorage.removeItem('__sub'); return true; } });
    window.__push = { suscripciones: 0, bajas: 0, opciones: null };
    PushManager.prototype.getSubscription = async () => (localStorage.getItem('__sub') ? crear() : null);
    PushManager.prototype.subscribe = async function (opciones) {
      window.__push.suscripciones++;
      window.__push.opciones = { userVisibleOnly: opciones.userVisibleOnly, llave: Array.from(new Uint8Array(opciones.applicationServerKey)) };
      localStorage.setItem('__sub', '1');
      return crear();
    };
  });
}

// Chromium completo (no la versión mínima): es el que permite notificaciones
test.use({ channel: 'chromium' });

test.describe('en la app', () => {

  test('al activar el recordatorio el teléfono se registra; aviso de prueba; al cerrar sesión se da de baja', async ({ page, context }) => {
    await conPushFalso(page);
    await page.clock.setFixedTime(new Date('2026-10-05T10:00:00-07:00'));
    const sim = await simularSupabase(page, { sitiosPA: 5 });
    await page.goto('index.html');
    await entrar(page, USUARIOS.asesor);
    await expect(page.locator('#pantalla-app')).toBeVisible();
    await page.locator('[data-pestana="perfil"]').click();
    await expect(page.locator('#recordatorio-probar')).toBeHidden();
    await context.grantPermissions(['notifications']);
    await page.locator('#recordatorio-activar').click();
    await expect(page.locator('#recordatorio-push')).toHaveText('Con la app cerrada: activado en este teléfono.');
    const push = await page.evaluate(() => window.__push);
    expect(push.opciones.userVisibleOnly).toBe(true);
    expect(Buffer.from(push.opciones.llave).toString('base64url')).toBe(LLAVE_PUSH_PUBLICA);
    expect(sim.estado.suscripciones).toEqual([{ miembro_id: 'aaaaaaaa-0000-0000-0000-000000000001', endpoint: 'https://push.ejemplo.test/telefono-1',
      p256dh: `B${'x'.repeat(86)}`, auth: 'a'.repeat(22) }]);
    await page.locator('#recordatorio-probar').click();
    await expect(page.locator('#recordatorio-push')).toHaveText('Aviso de prueba enviado: debe llegar en unos segundos, aunque cierres la app.');
    expect(sim.estado.pruebasAviso).toBe(1);
    // Al volver a abrir no se registra de nuevo
    await page.reload();
    await expect(page.locator('#pantalla-app')).toBeVisible();
    await page.locator('[data-pestana="perfil"]').click();
    await expect(page.locator('#recordatorio-probar')).toBeVisible();
    expect((await page.evaluate(() => window.__push)).suscripciones).toBe(0);   // ya tenía su suscripción: no pide otra
    expect(sim.estado.suscripciones).toHaveLength(1);
    // Cerrar sesión: el teléfono deja de recibir avisos de esta cuenta
    await page.locator('#perfil-salir').click();
    await expect(page.locator('#pantalla-acceso')).toBeVisible();
    expect(sim.estado.suscripciones).toEqual([]);
    expect((await page.evaluate(() => window.__push)).bajas).toBe(1);
  });

  test('coordinación: el texto explica que también recibe las alertas de coordinación', async ({ page, context }) => {
    await conPushFalso(page);
    await context.grantPermissions(['notifications']);
    await simularSupabase(page, { sitiosPA: 5 });
    await page.goto('index.html');
    await entrar(page, USUARIOS.coordinador);
    await expect(page.locator('#pantalla-app')).toBeVisible();
    await page.locator('[data-pestana="perfil"]').click();
    await expect(page.locator('#recordatorio-push')).toContainText('también recibes las alertas de coordinación');
  });

  test('el service worker muestra el aviso que llega por Web Push, aunque la app no esté a la vista', async ({ page, context }) => {
    await context.grantPermissions(['notifications']);
    await simularSupabase(page, { sitiosPA: 5 });
    await page.goto('index.html');
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    const registro = await new Promise((ok) => cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { const r = e.registrations.find((x) => !x.isDeleted); if (r) ok(r); }));
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(page.url()).origin, registrationId: registro.registrationId,
      data: JSON.stringify({ titulo: 'Coordinación: 1 pendiente', cuerpo: 'Ana Ficticia no ha cerrado campo (terminaba 20:00)', tag: 'coord-prueba', url: './panel.html' }) });
    await expect.poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => [n.title, n.body, n.tag, n.data.url])))
      .toEqual([['Coordinación: 1 pendiente', 'Ana Ficticia no ha cerrado campo (terminaba 20:00)', 'coord-prueba', './panel.html']]);
  });
});

test('la versión de un solo archivo de la función avisos está al día con index.ts + logica.js + js/reglas.js', async () => {
  const { armar } = await import('../supabase/functions/armar_un_archivo.mjs');
  const { readFileSync } = await import('node:fs');
  const actual = readFileSync(new URL('../supabase/functions/avisos/index_un_archivo.ts', import.meta.url), 'utf8');
  expect(actual, 'corre: node supabase/functions/armar_un_archivo.mjs').toBe(armar('avisos'));
});
