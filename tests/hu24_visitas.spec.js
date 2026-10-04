// HU-24 · Visitas a parques: llegada (por GPS o elegida del catálogo), salida, "llegar a otro parque" cierra el anterior,
// recorrido del día en la pestaña Visitas. Reloj: lunes 5-oct-2026; catálogo ficticio (Parque 001 en 24.76, -107.43).
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, senal, eventoServidor as ev, USUARIOS } from './simulador.js';
import { recorridoDelDia } from '../js/reglas.js';

const DIA = '2026-10-05';
const P = (i) => `ffffffff-0000-0000-0000-${String(i).padStart(12, '0')}`;
const EN_P1 = { latitude: 24.7601, longitude: -107.4301, accuracy: 8 };
const EN_P2 = { latitude: 24.7601, longitude: -107.4271, accuracy: 8 };
const LEJOS = { latitude: 24.7000, longitude: -107.5000, accuracy: 10 };
const CAMPO = [ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo' })];

async function abrirA(page, context, hora, { eventos = CAMPO, gps = EN_P1 } = {}) {
  await page.clock.setFixedTime(new Date(`${DIA}T${hora}:00-07:00`));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(gps);
  const sim = await simularSupabase(page, { sitiosPA: 60, eventos: eventos.map((e) => ({ ...e })) });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  await page.locator('[data-pestana="visitas"]').click();
  await expect(page.locator('#catalogo-estado')).toContainText('actualizado');
  return sim;
}
const accion = (page, texto) => page.locator('#visitas-acciones button', { hasText: texto });
const resultado = (page) => page.locator('#checada-resultado:visible #checada-resultado-titulo');
const filas = (page) => page.locator('#recorrido-lista .lista__fila');

test('recorrido: llegadas y salidas en orden; llegar a otro parque o terminar el bloque cierran la visita abierta', () => {
  const h = (hh) => `${DIA}T${hh}:00-07:00`;
  const r = recorridoDelDia([
    { tipo: 'llegada_sitio', hora: h('16:05'), sitioId: 'a', sitioNombre: 'A', enviado: true },
    { tipo: 'llegada_sitio', hora: h('17:00'), sitioId: 'b', sitioNombre: 'B', enviado: false },
    { tipo: 'salida_sitio', hora: h('17:40'), enviado: true },
    { tipo: 'llegada_sitio', hora: h('18:00'), sitioId: 'c', sitioNombre: 'C', enviado: true },
    { tipo: 'fin_bloque', hora: h('20:00'), enviado: true }
  ]);
  expect(r.map((v) => [v.nombre, v.salida !== null, v.enviado])).toEqual([['A', true, true], ['B', true, false], ['C', true, true]]);
});

test('llegada a parque por GPS: sin selfie, dentro de zona, aparece en el recorrido', async ({ page, context }) => {
  const sim = await abrirA(page, context, '16:05');
  await expect(filas(page)).toHaveCount(0);
  await expect(page.locator('#recorrido-nota')).toHaveText('Aún no registras llegadas a parques hoy.');
  await accion(page, 'Registrar llegada a parque').click();
  await expect(page.locator('#checada-titulo')).toHaveText('Llegada a parque');
  await expect(page.locator('#checada-sitio')).toHaveText('Parque Ficticio 001');
  await expect(page.locator('#checada-zona')).toHaveText('Dentro de la zona de Parque Ficticio 001.');
  await expect(page.locator('#checada-selfie')).toBeHidden();
  await page.locator('#checada-confirmar').click();
  await expect(resultado(page)).toHaveText('Registrado');
  await page.locator('#checada-listo').click();
  expect(sim.estado.recibidos[0]).toMatchObject({ tipo: 'llegada_sitio', bloque: null, sitio_id: P(1), justificacion: null, selfie_path: null });
  await page.locator('[data-pestana="visitas"]').click();
  await expect(filas(page)).toHaveCount(1);
  await expect(filas(page).first()).toContainText('Parque Ficticio 001');
  await expect(filas(page).first()).toContainText('16:05 – en curso · F-0001');
  await expect(filas(page).first()).toContainText('Enviado');
  await expect(accion(page, 'Registrar llegada a otro parque')).toBeVisible();
  await expect(accion(page, 'Salir de Parque Ficticio 001')).toBeVisible();
  await page.locator('[data-pestana="inicio"]').click();
  await expect(page.locator('#boton-principal-detalle')).toHaveText('Estás en Parque Ficticio 001');
});

test('llegar a otro parque registra la salida del anterior y la llegada al nuevo', async ({ page, context }) => {
  const sim = await abrirA(page, context, '17:00', { gps: EN_P2,
    eventos: [...CAMPO, ev('llegada_sitio', `${DIA}T16:05`, { sitio_id: P(1) })] });
  await expect(filas(page)).toHaveCount(1);
  await accion(page, 'Registrar llegada a otro parque').click();
  await expect(page.locator('#checada-titulo')).toHaveText('Cambio de parque');
  await expect(page.locator('#checada-sitio')).toHaveText('Parque Ficticio 002');
  await page.locator('#checada-confirmar').click();
  await expect(resultado(page)).toHaveText('Registrado');
  await page.locator('#checada-listo').click();
  expect(sim.estado.recibidos.map((e) => [e.tipo, e.sitio_id])).toEqual([['salida_sitio', P(1)], ['llegada_sitio', P(2)]]);
  await page.locator('[data-pestana="visitas"]').click();
  await expect(filas(page)).toHaveCount(2);
  await expect(filas(page).nth(0)).toContainText('16:05 – 17:00');
  await expect(filas(page).nth(1)).toContainText('Parque Ficticio 002');
  await expect(filas(page).nth(1)).toContainText('en curso');
});

test('sin parque cerca: elegirlo del catálogo; fuera de su zona pide justificación', async ({ page, context }) => {
  const sim = await abrirA(page, context, '16:30', { gps: LEJOS });
  await accion(page, 'Registrar llegada a parque').click();
  await expect(page.locator('#checada-zona')).toContainText('No hay un parque a menos de 500 m');
  await expect(page.locator('#checada-confirmar')).toBeDisabled();
  await page.locator('#checada-otro-parque').click();
  await page.locator('#checada-buscar').fill('alamo');
  await page.locator('#checada-resultados .opcion', { hasText: 'Parque Álamo Ficticio' }).click();
  await expect(page.locator('#checada-sitio')).toHaveText('Parque Álamo Ficticio');
  await expect(page.locator('#checada-zona')).toContainText('Fuera de la zona de Parque Álamo Ficticio');
  await expect(page.locator('#checada-justificacion-campo')).toBeVisible();
  await expect(page.locator('#checada-confirmar')).toBeDisabled();
  await page.locator('#checada-justificacion').fill('El GPS no da la ubicación dentro del parque');
  await page.locator('#checada-confirmar').click();
  await expect(resultado(page)).toHaveText('Registrado');
  expect(sim.estado.recibidos[0]).toMatchObject({ tipo: 'llegada_sitio', sitio_id: P(12), justificacion: 'El GPS no da la ubicación dentro del parque' });
});

test('salida de parque: del parque actual, sin justificación aunque ya esté lejos', async ({ page, context }) => {
  const sim = await abrirA(page, context, '17:00', { gps: LEJOS,
    eventos: [...CAMPO, ev('llegada_sitio', `${DIA}T16:05`, { sitio_id: P(1) })] });
  await accion(page, 'Salir de Parque Ficticio 001').click();
  await expect(page.locator('#checada-titulo')).toHaveText('Salida de Parque Ficticio 001');
  await expect(page.locator('#checada-sitio')).toHaveText('Parque Ficticio 001');
  await expect(page.locator('#checada-justificacion-campo')).toBeHidden();
  await expect(page.locator('#checada-sitio-elegir')).toBeHidden();
  await page.locator('#checada-confirmar').click();
  await expect(resultado(page)).toHaveText('Registrado');
  await page.locator('#checada-listo').click();
  expect(sim.estado.recibidos[0]).toMatchObject({ tipo: 'salida_sitio', sitio_id: P(1) });
  await page.locator('[data-pestana="visitas"]').click();
  await expect(filas(page).first()).toContainText('16:05 – 17:00');
  await expect(accion(page, 'Registrar llegada a parque')).toBeVisible();
});

test('sin señal: la visita queda "En cola" y se envía al volver la señal', async ({ page, context }) => {
  const sim = await abrirA(page, context, '16:10');
  await senal(context, sim, false);
  await accion(page, 'Registrar llegada a parque').click();
  await page.locator('#checada-confirmar').click();
  await expect(resultado(page)).toHaveText('Guardado en el teléfono');
  await page.locator('#checada-listo').click();
  await page.locator('[data-pestana="visitas"]').click();
  await expect(filas(page).first()).toContainText('En cola');
  await senal(context, sim, true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(filas(page).first()).toContainText('Enviado');
  expect(sim.estado.recibidos[0]).toMatchObject({ tipo: 'llegada_sitio', capturado_sin_conexion: true });
});

test('fuera del bloque de campo no se ofrecen visitas', async ({ page, context }) => {
  await abrirA(page, context, '10:00', { eventos: [ev('inicio_bloque', `${DIA}T09:00`, { bloque: 'escritorio', modalidad: 'teletrabajo' })] });
  await expect(page.locator('#recorrido-nota')).toHaveText('Las visitas a parques se registran durante el bloque de campo.');
  await expect(page.locator('#visitas-acciones button')).toHaveCount(0);
});
