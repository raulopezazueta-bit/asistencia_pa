// HU-17 · Checada con GPS y geocerca (pantalla): GPS simulado, con y sin señal, simulador de Supabase.
// Reloj de la página: lunes 5-oct-2026 (Culiacán). Catálogo ficticio: Parque Ficticio 001 en 24.76, -107.43 (±45 m).
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, senal, tomarSelfie, eventoServidor as ev, USUARIOS } from './simulador.js';
import { CONFIG } from '../config.js';

const DIA = '2026-10-05';
const PARQUE_1 = { latitude: 24.7601, longitude: -107.4301, accuracy: 8 };
const ENTRE_PARQUES = { latitude: 24.7615, longitude: -107.4285, accuracy: 8 };   // ~100 m del perímetro más cercano

async function abrirA(page, context, hora, { eventos = [], usuario = USUARIOS.asesor, gps = PARQUE_1 } = {}) {
  await page.clock.setFixedTime(new Date(`${DIA}T${hora}:00-07:00`));
  if (gps) {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(gps);
  }
  const sim = await simularSupabase(page, { eventos, sitiosPA: 60 });
  await page.goto('index.html');
  await entrar(page, usuario);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.locator('[data-pestana="visitas"]').click();
  await expect(page.locator('#catalogo-estado')).toContainText('actualizado');   // catálogo listo
  await page.locator('[data-pestana="inicio"]').click();
  return sim;
}
const principal = (page) => page.locator('#boton-principal');
const enviados = (sim) => sim.estado.recibidos;
const resultado = (page) => page.locator('#checada-resultado:visible #checada-resultado-titulo');

test('entrada a campo dentro del parque: llega al servidor y cambia el botón', async ({ page, context }) => {
  const sim = await abrirA(page, context, '16:00');
  await expect(page.locator('#boton-principal-texto')).toHaveText('Iniciar bloque de campo');
  await principal(page).click();
  await expect(page.locator('#pantalla-checada')).toBeVisible();
  await expect(page.locator('#checada-titulo')).toHaveText('Entrada · campo');
  await expect(page.locator('#checada-sitio')).toHaveText('Parque Ficticio 001');
  await expect(page.locator('#checada-precision')).toHaveText('±8 m');
  await expect(page.locator('#checada-zona')).toHaveText('Dentro de la zona de Parque Ficticio 001.');
  await expect(page.locator('#checada-justificacion-campo')).toBeHidden();
  await expect(page.locator('#checada-mapa .m-zona')).toHaveCount(1);
  await expect(page.locator('#checada-mapa .m-punto')).toHaveCount(1);
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(resultado(page)).toHaveText('Registrado');
  await expect(page.locator('#checada-resultado-lista')).toContainText('Dentro');
  await expect(page.locator('#checada-resultado-lista')).toContainText('SelfieEnviada');
  await expect(page.locator('#checada-resultado-lista')).not.toContainText('sin selfie');

  expect(enviados(sim)).toHaveLength(1);
  const e = enviados(sim)[0];
  expect(e).toMatchObject({ tipo: 'inicio_bloque', bloque: 'campo', modalidad: 'presencial', capturado_sin_conexion: false, lat: 24.7601, lon: -107.4301, precision_m: 8, justificacion: null, version_app: CONFIG.VERSION_APP });
  expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(e.sitio_id).toBe('ffffffff-0000-0000-0000-000000000001');
  expect(e).not.toHaveProperty('organizacion_id');      // la pone el servidor
  expect(e).not.toHaveProperty('hora_servidor');        // la pone el servidor
  expect(e._prefer).toContain('resolution=ignore-duplicates');
  expect(e._query).toContain('on_conflict=id');

  await page.locator('#checada-listo').click();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(page.locator('#boton-principal-texto')).toHaveText('Terminar bloque de campo');
});

test('campo fuera de zona: justificación obligatoria (mínimo 5 caracteres)', async ({ page, context }) => {
  const sim = await abrirA(page, context, '16:00', { gps: ENTRE_PARQUES });
  await principal(page).click();
  await tomarSelfie(page);
  await expect(page.locator('#checada-zona')).toContainText('Fuera de la zona de');
  await expect(page.locator('#checada-justificacion-campo')).toBeVisible();
  await expect(page.locator('#checada-confirmar')).toBeDisabled();
  await page.locator('#checada-justificacion').fill('ok');
  await expect(page.locator('#checada-confirmar')).toBeDisabled();
  await page.locator('#checada-justificacion').fill('Reunión con el comité en la explanada');
  await expect(page.locator('#checada-confirmar')).toBeEnabled();
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado-lista')).toContainText('Fuera');
  expect(enviados(sim)[0].justificacion).toBe('Reunión con el comité en la explanada');
});

test('escritorio en teletrabajo: guarda la ubicación sin validar zona ni pedir justificación', async ({ page, context }) => {
  const sim = await abrirA(page, context, '08:55', { gps: { latitude: 24.70, longitude: -107.50, accuracy: 12 } });
  await expect(page.locator('#boton-principal-texto')).toHaveText('Iniciar bloque de escritorio');
  await principal(page).click();
  await expect(page.locator('#checada-zona')).toHaveText('Teletrabajo: tu ubicación se guarda, pero no se valida la zona.');
  await expect(page.locator('#checada-justificacion-campo')).toBeHidden();
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado-lista')).toContainText('No aplica (teletrabajo)');
  expect(enviados(sim)[0]).toMatchObject({ modalidad: 'teletrabajo', lat: 24.7, lon: -107.5, bloque: 'escritorio' });
});

test('sin señal: se guarda en el teléfono y se envía al volver la señal con capturado_sin_conexion', async ({ page, context }) => {
  const sim = await abrirA(page, context, '16:00');
  await senal(context, sim, false);
  await principal(page).click();
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(resultado(page)).toHaveText('Guardado en el teléfono');
  await page.locator('#checada-listo').click();
  await expect(page.locator('#boton-principal-texto')).toHaveText('Terminar bloque de campo');   // el estado usa lo guardado
  await expect(page.locator('#aviso-pendientes')).toHaveText('1 checada guardada en el teléfono, por enviar.');
  expect(enviados(sim)).toHaveLength(0);

  await senal(context, sim, true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => enviados(sim).length).toBe(1);
  expect(enviados(sim)[0]).toMatchObject({ tipo: 'inicio_bloque', capturado_sin_conexion: true });
  await expect(page.locator('#aviso-pendientes')).toBeHidden();
});

test('sin permiso de GPS: avisa, pide justificación en campo y registra sin ubicación', async ({ page, context }) => {
  const sim = await abrirA(page, context, '16:00', { gps: null });
  await principal(page).click();
  await expect(page.locator('#checada-zona')).toContainText('Se registrará sin ubicación y quedará para revisión.');
  await expect(page.locator('#checada-justificacion-campo')).toBeVisible();
  await page.locator('#checada-justificacion').fill('El teléfono no dio ubicación');
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado-lista')).toContainText('sin ubicación');
  expect(enviados(sim)[0]).toMatchObject({ lat: null, lon: null, precision_m: null });
});

test('terminar campo estando en un parque: primero salida del parque, luego fin de bloque', async ({ page, context }) => {
  const sim = await abrirA(page, context, '19:58', { eventos: [
    ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo' }),
    ev('llegada_sitio', `${DIA}T16:05`, { sitio_id: 'ffffffff-0000-0000-0000-000000000001' })
  ] });
  await expect(page.locator('#boton-principal-texto')).toHaveText('Terminar bloque de campo');
  await expect(page.locator('#boton-principal-detalle')).toHaveText('Estás en Parque Ficticio 001');
  await principal(page).click();
  await expect(page.locator('#checada-titulo')).toHaveText('Salida · campo');
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(resultado(page)).toHaveText('Registrado');
  expect(enviados(sim).map((e) => e.tipo)).toEqual(['salida_sitio', 'fin_bloque']);
  expect(enviados(sim)[0].sitio_id).toBe('ffffffff-0000-0000-0000-000000000001');
  expect(enviados(sim)[0].hora_dispositivo < enviados(sim)[1].hora_dispositivo).toBe(true);
  await page.locator('#checada-listo').click();
  await expect(page.locator('#jornada-cerrada')).toBeHidden();   // falta escritorio (horario de 2 bloques)
  await expect(page.locator('#boton-principal-texto')).toHaveText('Iniciar bloque de escritorio');
});

test('sin horario: elige el bloque al checar; cancelar no registra nada', async ({ page, context }) => {
  const sim = await abrirA(page, context, '10:00', { usuario: USUARIOS.coordinador });
  await principal(page).click();
  await expect(page.locator('#checada-elegir')).toBeVisible();
  await page.locator('#checada-cancelar').click();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  expect(enviados(sim)).toHaveLength(0);

  await principal(page).click();
  await page.locator('#checada-elegir [data-bloque="campo"]').click();
  await expect(page.locator('#checada-titulo')).toHaveText('Entrada · campo');
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(resultado(page)).toHaveText('Registrado');
  expect(enviados(sim)[0]).toMatchObject({ bloque: 'campo', miembro_id: 'aaaaaaaa-0000-0000-0000-000000000002' });
});
