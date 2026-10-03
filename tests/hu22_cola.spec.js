// HU-22 · Cola sin señal completa (ESPECIFICACION §5): recargar sin señal, reintentos escalonados,
// Background Sync con la app cerrada, indicador fijo, errores para soporte, limpieza a 35 días y cierre de sesión.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, senal, tomarSelfie, USUARIOS } from './simulador.js';
import { apiLocalDisponible, conectarApiLocal, CUENTAS } from './api_local.js';

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
const pendientes = (page) => page.evaluate(async () => (await (await import('./js/almacen.js')).leerTodo('eventos_pendientes')));

test('criterio del backlog: checar sin señal, recargar la app sin señal, volver la señal y llegar al servidor', async ({ page, context }) => {
  const sim = await entrarYAbrirChecada(page, context);
  const p = await checarSinSenal(page, context, sim);
  expect(p.evento.capturado_sin_conexion).toBe(true);

  await page.reload();                                           // sin señal: el cascarón sale del teléfono
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(indicador(page)).toHaveText('1 por enviar');
  await expect(page.locator('#boton-principal-texto')).toHaveText('Terminar bloque de campo');
  expect(sim.estado.recibidos).toHaveLength(0);

  await senal(context, sim, true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(indicador(page)).toHaveText('Todo enviado');
  expect(sim.estado.recibidos).toHaveLength(1);
  expect(sim.estado.recibidos[0]).toMatchObject({ id: p.id, capturado_sin_conexion: true, hora_dispositivo: p.evento.hora_dispositivo });
  expect(sim.estado.selfies.map((s) => s.ruta)).toEqual([p.evento.selfie_path]);
  expect(await pendientes(page)).toHaveLength(0);
});

test('reintentos escalonados: 30 s, 1, 2, 5 y 10 min; al volver la señal se intenta de inmediato', async ({ page, context }) => {
  const sim = await entrarYAbrirChecada(page, context);
  const p = await checarSinSenal(page, context, sim);
  expect(p.intentos).toBe(1);
  expect(p.proximoIntento - Date.parse('2026-10-05T16:00:00-07:00')).toBe(30_000);

  const r = await page.evaluate(async () => {
    const cola = await import('./js/cola.js');
    const ids = ['aaaaaaaa-0000-0000-0000-000000000001'];
    const esperas = [1, 2, 3, 4, 5, 9].map((n) => cola.esperaTras(n) / 1000);
    const sinForzar = await cola.enviarPendientes(ids);                 // aún no toca: no intenta
    const forzadoSinRed = await cola.enviarPendientes(ids, { forzar: true }); // sin señal: falla y espera más
    const [despues] = await (await import('./js/almacen.js')).leerTodo('eventos_pendientes');
    return { esperas, sinForzar, forzadoSinRed, intentos: despues.intentos, espera: despues.proximoIntento - Date.now() };
  });
  expect(r.esperas).toEqual([30, 60, 120, 300, 600, 600]);
  expect(r.sinForzar).toBe(0);
  expect(r.forzadoSinRed).toBe(0);
  expect(r.intentos).toBe(2);
  expect(r.espera).toBe(60_000);
  expect(sim.estado.recibidos).toHaveLength(0);
});

test('si el servidor rechaza el evento (validación), queda para soporte y se avisa', async ({ page, context }) => {
  const sim = await entrarYAbrirChecada(page, context, { rechazarEventos: true });
  await page.locator('#boton-principal').click();
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado:visible #checada-resultado-titulo')).toHaveText('No se pudo registrar');
  await page.locator('#checada-listo').click();
  await expect(indicador(page)).toHaveText('1 con error · avisa a coordinación');
  const [p] = await pendientes(page);
  expect(p.estado).toBe('soporte');
  expect(p.ultimoError).toContain('check constraint');
  expect(sim.registro.filter((r) => r.metodo === 'POST' && r.ruta === '/rest/v1/eventos_jornada')).toHaveLength(1);
});

test('cerrar sesión con checadas sin enviar: avisa; lo pendiente se queda y solo lo envía su dueño', async ({ page, context }) => {
  const sim = await entrarYAbrirChecada(page, context);
  await checarSinSenal(page, context, sim);           // se cierra sesión todavía sin señal
  await page.locator('[data-pestana="perfil"]').click();
  const dialogo = page.waitForEvent('dialog');
  await page.locator('#perfil-salir').click();
  const d = await dialogo;
  expect(d.message()).toContain('Tienes 1 checada sin enviar');
  await d.dismiss();
  await expect(page.locator('#pantalla-app')).toBeVisible();          // canceló: sigue dentro

  page.once('dialog', (d) => d.accept());
  await page.locator('#perfil-salir').click();
  await expect(page.locator('#pantalla-acceso')).toBeVisible();
  expect(await pendientes(page)).toHaveLength(1);                      // no se perdió

  // Vuelve la señal y otra persona entra en el mismo teléfono: no envía lo ajeno
  await senal(context, sim, true);
  await entrar(page, USUARIOS.coordinador);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(indicador(page)).toHaveText('Todo enviado');
  await page.waitForTimeout(500);
  expect(sim.estado.recibidos).toHaveLength(0);

  // Vuelve el dueño: se envía
  page.once('dialog', (d) => d.accept());
  await page.locator('[data-pestana="perfil"]').click();
  await page.locator('#perfil-salir').click();
  await entrar(page, USUARIOS.asesor);
  await expect.poll(() => sim.estado.recibidos.length).toBe(1);
});

test('limpieza: el registro local conserva 35 días de lo enviado y nunca borra lo pendiente', async ({ page, context }) => {
  await entrarYAbrirChecada(page, context);
  const r = await page.evaluate(async () => {
    const a = await import('./js/almacen.js');
    const cola = await import('./js/cola.js');
    const dias = (n) => new Date(Date.now() - n * 864e5).toISOString();
    const fila = (id, d, enviado) => ({ id, miembroId: 'm', enviado, evento: { hora_dispositivo: dias(d) } });
    for (const f of [fila('viejo-enviado', 40, true), fila('viejo-pendiente', 40, false), fila('reciente', 10, true)]) await a.guardar('eventos_locales', f);
    const borrados = await cola.limpiarRegistroLocal();
    return { borrados, quedan: (await a.leerTodo('eventos_locales')).map((x) => x.id).sort() };
  });
  expect(r.borrados).toBe(1);
  expect(r.quedan).toEqual(['reciente', 'viejo-pendiente']);
});

test('contra la API local (trigger real): llega con capturado_sin_conexion y hora_efectiva = hora del teléfono', async ({ page, context }) => {
  test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 24.8047, longitude: -107.4372, accuracy: 6 });
  const red = await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, CUENTAS.asesorPA);
  await expect(page.locator('#pantalla-app')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-pestana="visitas"]').click();
  await expect(page.locator('#catalogo-estado')).toContainText('2 parques guardados');
  await page.locator('[data-pestana="inicio"]').click();
  await page.evaluate(() => navigator.serviceWorker.ready);

  await senal(context, red, false);
  await page.locator('#boton-principal').click();
  if (await page.locator('#checada-elegir').isVisible()) await page.locator('#checada-elegir [data-bloque="campo"]').click();
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado:visible #checada-resultado-titulo')).toHaveText('Guardado en el teléfono');
  await page.locator('#checada-listo').click();
  // Puede ser más de un evento (p. ej. salida del parque + fin de bloque), según lo que ya haya en la base local.
  const todos = await pendientes(page);
  const p = todos.find((x) => ['inicio_bloque', 'fin_bloque'].includes(x.evento.tipo));
  await page.reload();
  await expect(indicador(page)).toHaveText(`${todos.length} por enviar`);

  await page.waitForTimeout(1500);   // que pase tiempo real: la hora del servidor ya no coincide con la del teléfono
  await senal(context, red, true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(indicador(page)).toHaveText('Todo enviado');
  const fila = await page.evaluate(async (id) => {
    const { cliente } = await import('./js/api.js');
    return (await cliente.from('eventos_jornada').select('capturado_sin_conexion, hora_dispositivo, hora_efectiva, hora_servidor, dentro_geocerca, selfie_path').eq('id', id)).data[0];
  }, p.id);
  expect(fila.capturado_sin_conexion).toBe(true);
  expect(Date.parse(fila.hora_efectiva)).toBe(Date.parse(p.evento.hora_dispositivo));
  expect(Date.parse(fila.hora_servidor)).toBeGreaterThan(Date.parse(fila.hora_efectiva) + 1000);
  expect(fila.dentro_geocerca).toBe(true);
  expect(fila.selfie_path).toBe(p.evento.selfie_path);
});
