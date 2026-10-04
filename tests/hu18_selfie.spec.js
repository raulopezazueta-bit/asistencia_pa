// HU-18 · Selfie de evidencia (sin reconocimiento facial): cámara falsa de Chromium, respaldo con archivo,
// ≤ 60 KB, ruta en el bucket, cámara apagada al terminar, envío sin señal y opción configurable.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { simularSupabase, entrar, senal, tomarSelfie, USUARIOS } from './simulador.js';

const PARQUE_1 = { latitude: 24.7601, longitude: -107.4301, accuracy: 8 };
const FOTO = readFileSync(new URL('./recursos/foto_prueba.jpg', import.meta.url));   // imagen abstracta, sin personas

async function abrirChecada(page, context, opciones = {}) {
  await page.clock.setFixedTime(new Date('2026-10-05T16:00:00-07:00'));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(PARQUE_1);
  const sim = await simularSupabase(page, { sitiosPA: 60, ...opciones });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  await page.locator('[data-pestana="visitas"]').click();
  await expect(page.locator('#catalogo-estado')).toContainText('actualizado');
  await page.locator('[data-pestana="inicio"]').click();
  await page.locator('#boton-principal').click();
  await expect(page.locator('#checada-precision')).toHaveText('±8 m');
  return sim;
}
const camaraEncendida = (page) => page.evaluate(() => {
  const v = document.getElementById('selfie-video');
  return !!v.srcObject && v.srcObject.getTracks().some((t) => t.readyState === 'live');
});

test('selfie obligatoria: sin foto no se puede confirmar; con foto se sube antes del evento', async ({ page, context }) => {
  const sim = await abrirChecada(page, context);
  await expect(page.locator('#checada-selfie')).toBeVisible();
  await expect(page.locator('#selfie-estado')).toContainText('Sin reconocimiento facial');
  await expect(page.locator('#selfie-tomar')).toBeVisible();
  expect(await camaraEncendida(page)).toBe(true);
  await expect(page.locator('#checada-confirmar')).toBeDisabled();

  await page.locator('#selfie-tomar').click();
  await expect(page.locator('#selfie-foto')).toBeVisible();
  expect(await camaraEncendida(page)).toBe(false);              // se apaga en cuanto se captura
  await expect(page.locator('#checada-confirmar')).toBeDisabled();   // falta "Usar esta foto"
  await page.locator('#selfie-usar').click();
  await expect(page.locator('#selfie-estado')).toContainText('Selfie lista');
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado:visible #checada-resultado-titulo')).toHaveText('Registrado');
  await expect(page.locator('#checada-resultado-lista')).toContainText('SelfieEnviada');

  expect(sim.estado.selfies).toHaveLength(1);
  const s = sim.estado.selfies[0];
  const e = sim.estado.recibidos[0];
  expect(s.ruta).toBe(`11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/2026/10/${e.id}.webp`);
  expect(e.selfie_path).toBe(s.ruta);
  expect(s.tipo).toBe('image/webp');
  expect(s.bytes).toBeGreaterThan(1000);
  expect(s.bytes).toBeLessThanOrEqual(60 * 1024);
  expect(s.upsert).toBe('false');                               // nunca reemplaza
  const orden = sim.registro.filter((r) => r.metodo === 'POST' && !r.ruta.startsWith('/auth')).map((r) => r.ruta.split('/')[3]);
  expect(orden).toEqual(['object', 'eventos_jornada']);           // primero la selfie, luego el evento
});

test('repetir vuelve a encender la cámara; cancelar la apaga', async ({ page, context }) => {
  await abrirChecada(page, context);
  await page.locator('#selfie-tomar').click();
  await page.locator('#selfie-repetir').click();
  await expect(page.locator('#selfie-tomar')).toBeVisible();
  await expect.poll(() => camaraEncendida(page)).toBe(true);
  await page.locator('#checada-cancelar').click();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  expect(await camaraEncendida(page)).toBe(false);
});

test('si la cámara en vivo falla: respaldo con la cámara del teléfono (archivo), comprimido a 480 px y ≤ 60 KB', async ({ page, context }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permiso negado', 'NotAllowedError'));
  });
  const sim = await abrirChecada(page, context);
  await expect(page.locator('#selfie-estado')).toContainText('No se pudo abrir la cámara');
  await expect(page.locator('#selfie-archivo-boton')).toBeVisible();
  await page.locator('#selfie-archivo').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: FOTO });
  await page.locator('#selfie-usar').click();
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado:visible #checada-resultado-titulo')).toHaveText('Registrado');
  expect(FOTO.length).toBeGreaterThan(100 * 1024);
  expect(sim.estado.selfies[0].bytes).toBeLessThanOrEqual(60 * 1024);
  const ancho = await page.evaluate(async () => {
    const r = await fetch(document.getElementById('selfie-foto').src).catch(() => null);
    return r ? (await createImageBitmap(await r.blob())).width : null;
  });
  if (ancho !== null) expect(ancho).toBe(480);
});

test('navegador sin WebP (algunos iPhone): la selfie sale en JPEG con extensión .jpg', async ({ page, context }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb, tipo, calidad) {
      return original.call(this, cb, tipo === 'image/webp' ? 'image/png' : tipo, calidad);
    };
  });
  const sim = await abrirChecada(page, context);
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado:visible #checada-resultado-titulo')).toHaveText('Registrado');
  expect(sim.estado.selfies[0].tipo).toBe('image/jpeg');
  expect(sim.estado.selfies[0].ruta).toMatch(/\.jpg$/);
});

test('sin señal: la selfie se guarda en el teléfono y se sube antes que el evento al volver la señal', async ({ page, context }) => {
  const sim = await abrirChecada(page, context);
  await senal(context, sim, false);
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado:visible #checada-resultado-titulo')).toHaveText('Guardado en el teléfono');
  await expect(page.locator('#checada-resultado-lista')).toContainText('se enviará con la checada');
  const guardada = await page.evaluate(async () => {
    const [p] = await (await import('./js/almacen.js')).leerTodo('eventos_pendientes');
    return { tamano: p.selfieBlob?.size, tipo: p.selfieBlob?.type, ruta: p.evento.selfie_path };
  });
  expect(guardada.tamano).toBeGreaterThan(1000);
  expect(guardada.tipo).toBe('image/webp');
  await page.locator('#checada-listo').click();

  await senal(context, sim, true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => sim.estado.recibidos.length).toBe(1);
  expect(sim.estado.selfies.map((s) => s.ruta)).toEqual([guardada.ruta]);
  expect(sim.estado.recibidos[0]).toMatchObject({ selfie_path: guardada.ruta, capturado_sin_conexion: true });
  const quedan = await page.evaluate(async () => (await (await import('./js/almacen.js')).leerTodo('eventos_pendientes')).length);
  expect(quedan).toBe(0);   // la selfie ya no queda en el teléfono
});

test('si la organización no exige selfie (selfie_obligatoria = false), es opcional', async ({ page, context }) => {
  const sim = await abrirChecada(page, context, { configPA: { selfie_obligatoria: false } });
  await expect(page.locator('#selfie-estado')).toContainText('Opcional');
  await expect(page.locator('#checada-confirmar')).toBeEnabled();
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado:visible #checada-resultado-titulo')).toHaveText('Registrado');
  expect(sim.estado.selfies).toHaveLength(0);
  expect(sim.estado.recibidos[0].selfie_path).toBeNull();
  expect(await camaraEncendida(page)).toBe(false);
});

test('reintento de una selfie ya subida (409) se da por buena y no duplica', async ({ page, context }) => {
  await abrirChecada(page, context);
  const r = await page.evaluate(async () => {
    const api = await import('./js/api.js');
    const blob = new Blob([new Uint8Array(2000)], { type: 'image/webp' });
    const ruta = '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/2026/10/prueba.webp';
    await api.subirSelfie(ruta, blob);
    await api.subirSelfie(ruta, blob);   // segunda vez: 409 → sin error
    let ajeno = null;
    try { await api.subirSelfie('22222222-2222-2222-2222-222222222222/otro/2026/10/x.webp', blob); } catch (e) { ajeno = e.message; }
    return { ajeno };
  });
  expect(r.ajeno).toMatch(/security|Unauthorized/i);   // carpeta de otra organización: rechazado
});
