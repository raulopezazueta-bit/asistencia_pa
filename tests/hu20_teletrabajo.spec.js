// HU-20 · Bloque de escritorio en teletrabajo: la modalidad sale de horarios; sin validar zona mientras
// validar_domicilio = false; con validar_domicilio = true solo cuenta el domicilio propio (migración 0002).
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, tomarSelfie, eventoServidor as ev, HORARIO_ASESOR, USUARIOS } from './simulador.js';

const DIA = '2026-10-05';
const PARQUE_1 = { latitude: 24.7601, longitude: -107.4301, accuracy: 8 };      // también es el domicilio ficticio del asesor
const LEJOS = { latitude: 24.7000, longitude: -107.5000, accuracy: 10 };         // a kilómetros de todo
const A_200_M = { latitude: 24.7618, longitude: -107.4301, accuracy: 8 };         // ~190 m del domicilio
const EN_OFICINA = HORARIO_ASESOR.map((h) => (h.bloque === 'escritorio' ? { ...h, modalidad: 'presencial' } : h));

async function abrirA(page, context, hora, { gps = PARQUE_1, ...opciones } = {}) {
  await page.clock.setFixedTime(new Date(`${DIA}T${hora}:00-07:00`));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(gps);
  const sim = await simularSupabase(page, { sitiosPA: 60, ...opciones });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  await page.locator('[data-pestana="visitas"]').click();
  await expect(page.locator('#catalogo-estado')).toContainText('actualizado');
  await page.locator('[data-pestana="inicio"]').click();
  return sim;
}
async function checar(page) {
  await page.locator('#boton-principal').click();
  await expect(page.locator('#checada-precision')).not.toHaveText('—');
}
async function confirmar(page) {
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado:visible #checada-resultado-titulo')).toHaveText('Registrado');
}

test('teletrabajo (desde horarios): lejos de todo, sin validar zona ni pedir justificación', async ({ page, context }) => {
  const sim = await abrirA(page, context, '08:55', { gps: LEJOS });
  await expect(page.locator('#boton-principal-detalle')).toHaveText('Teletrabajo · Programado 09:00 – 13:00');
  await checar(page);
  await expect(page.locator('#checada-zona')).toHaveText('Teletrabajo: tu ubicación se guarda, pero no se valida la zona.');
  await expect(page.locator('#checada-justificacion-campo')).toBeHidden();
  await confirmar(page);
  await expect(page.locator('#checada-resultado-lista')).toContainText('No aplica (teletrabajo)');
  expect(sim.estado.recibidos[0]).toMatchObject({ modalidad: 'teletrabajo', lat: 24.7, lon: -107.5 });
});

test('escritorio presencial (oficina, desde horarios): sí se valida la zona, sin justificación obligatoria', async ({ page, context }) => {
  const sim = await abrirA(page, context, '08:55', { gps: LEJOS, horarioAsesor: EN_OFICINA });
  await expect(page.locator('#boton-principal-detalle')).toHaveText('Programado 09:00 – 13:00');
  await checar(page);
  await expect(page.locator('#checada-zona')).toHaveText('No estás en ningún sitio del catálogo.');
  await expect(page.locator('#checada-justificacion-campo')).toBeHidden();
  await confirmar(page);
  await expect(page.locator('#checada-resultado-lista')).toContainText('Fuera');
  expect(sim.estado.recibidos[0]).toMatchObject({ modalidad: 'presencial', bloque: 'escritorio' });
});

test('la salida conserva la modalidad con la que se inició el bloque', async ({ page, context }) => {
  const sim = await abrirA(page, context, '12:58', { gps: LEJOS, horarioAsesor: EN_OFICINA,
    eventos: [ev('inicio_bloque', `${DIA}T09:00`, { bloque: 'escritorio', modalidad: 'teletrabajo' })] });
  await checar(page);
  await expect(page.locator('#checada-titulo')).toHaveText('Salida · escritorio');
  await expect(page.locator('#checada-zona')).toContainText('Teletrabajo');
  await confirmar(page);
  expect(sim.estado.recibidos[0]).toMatchObject({ tipo: 'fin_bloque', modalidad: 'teletrabajo' });
});

test.describe('con validar_domicilio = true (pendiente de decisión legal)', () => {
  const configPA = { validar_domicilio: true };

  test('en casa: dentro de la zona del domicilio propio, aunque haya un parque en el mismo lugar', async ({ page, context }) => {
    const sim = await abrirA(page, context, '08:55', { configPA });
    await checar(page);
    await expect(page.locator('#checada-sitio')).toHaveText('Domicilio ficticio');
    await expect(page.locator('#checada-zona')).toHaveText('Dentro de la zona de Domicilio ficticio.');
    await confirmar(page);
    await expect(page.locator('#checada-resultado-lista')).toContainText('Dentro');
    expect(sim.estado.recibidos[0]).toMatchObject({ modalidad: 'teletrabajo', sitio_id: 'dddddddd-dddd-0000-0000-000000000001' });
  });

  test('lejos de casa: fuera de la zona del domicilio (no cuenta el parque cercano)', async ({ page, context }) => {
    const sim = await abrirA(page, context, '08:55', { configPA, gps: A_200_M });
    await checar(page);
    await expect(page.locator('#checada-zona')).toContainText('Fuera de la zona de Domicilio ficticio');
    await confirmar(page);
    await expect(page.locator('#checada-resultado-lista')).toContainText('Fuera');   // según el servidor
    expect(sim.estado.recibidos[0]).toMatchObject({ sitio_id: 'dddddddd-dddd-0000-0000-000000000001' });
  });
});
