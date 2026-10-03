// HU-13 · Pausas: inicio y regreso de comida/pausa (sin selfie, configurable), cierre automático confirmado
// al terminar el bloque o al iniciar el siguiente estando en pausa. Reloj: lunes 5-oct-2026, Culiacán.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, tomarSelfie, eventoServidor as ev, USUARIOS } from './simulador.js';

const DIA = '2026-10-05';
const PARQUE_1 = { latitude: 24.7601, longitude: -107.4301, accuracy: 8 };
const ENTRE_PARQUES = { latitude: 24.7615, longitude: -107.4285, accuracy: 8 };
const ESCRITORIO = [
  ev('inicio_bloque', `${DIA}T09:00`, { bloque: 'escritorio', modalidad: 'teletrabajo' }),
  ev('fin_bloque', `${DIA}T13:00`, { bloque: 'escritorio', modalidad: 'teletrabajo' })
];
const CAMPO_ABIERTO = [...ESCRITORIO, ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo' })];

async function abrirA(page, context, hora, { eventos = [], gps = PARQUE_1, configPA = {} } = {}) {
  await page.clock.setFixedTime(new Date(`${DIA}T${hora}:00-07:00`));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(gps);
  const sim = await simularSupabase(page, { eventos, sitiosPA: 60, configPA });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  await page.locator('[data-pestana="visitas"]').click();
  await expect(page.locator('#catalogo-estado')).toContainText('actualizado');
  await page.locator('[data-pestana="inicio"]').click();
  return sim;
}
const textoBoton = (page) => page.locator('#boton-principal-texto');
const secundaria = (page, texto) => page.locator('#acciones-secundarias button', { hasText: texto });
const resultado = (page) => page.locator('#checada-resultado:visible #checada-resultado-titulo');
async function confirmarYCerrar(page) {
  await page.locator('#checada-confirmar').click();
  await expect(resultado(page)).toHaveText('Registrado');
  await page.locator('#checada-listo').click();
}

test('iniciar y regresar de la pausa en campo: sin selfie ni justificación, aunque esté fuera de zona', async ({ page, context }) => {
  const sim = await abrirA(page, context, '18:00', { eventos: CAMPO_ABIERTO, gps: ENTRE_PARQUES });
  await expect(secundaria(page, 'Iniciar comida/pausa')).toBeEnabled();
  await secundaria(page, 'Iniciar comida/pausa').click();
  await expect(page.locator('#checada-titulo')).toHaveText('Inicio de comida/pausa');
  await expect(page.locator('#checada-confirmar-texto')).toHaveText('Confirmar pausa');
  await expect(page.locator('#checada-selfie')).toBeHidden();
  await expect(page.locator('#checada-zona')).toContainText('En pausas no se pide justificación.');
  await expect(page.locator('#checada-justificacion-campo')).toBeHidden();
  await confirmarYCerrar(page);
  expect(sim.estado.recibidos.at(-1)).toMatchObject({ tipo: 'inicio_pausa', bloque: null, modalidad: 'presencial', selfie_path: null, justificacion: null });

  await expect(textoBoton(page)).toHaveText('Regresar de la pausa');
  await expect(page.locator('#lista-bloques [data-fila="pausa"]')).toContainText('En pausa');
  await page.locator('#boton-principal').click();
  await expect(page.locator('#checada-titulo')).toHaveText('Regreso de la pausa');
  await confirmarYCerrar(page);
  expect(sim.estado.recibidos.at(-1)).toMatchObject({ tipo: 'fin_pausa', bloque: null });
  await expect(textoBoton(page)).toHaveText('Terminar bloque de campo');
});

test('terminar el bloque estando en pausa: confirma y registra regreso, luego salida (la selfie va en la salida)', async ({ page, context }) => {
  const sim = await abrirA(page, context, '19:58', { eventos: [...CAMPO_ABIERTO, ev('inicio_pausa', `${DIA}T19:30`)] });
  await expect(textoBoton(page)).toHaveText('Regresar de la pausa');

  // Si no confirma, no pasa nada
  page.once('dialog', (d) => d.dismiss());
  await secundaria(page, 'Terminar bloque de campo').click();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  expect(sim.estado.recibidos).toHaveLength(0);

  let mensaje = '';
  page.once('dialog', async (d) => { mensaje = d.message(); await d.accept(); });
  await secundaria(page, 'Terminar bloque de campo').click();
  await expect(page.locator('#checada-titulo')).toHaveText('Salida · campo');
  expect(mensaje).toContain('se registrará primero tu regreso de la pausa');
  await tomarSelfie(page);
  await confirmarYCerrar(page);
  expect(sim.estado.recibidos.map((e) => e.tipo)).toEqual(['fin_pausa', 'fin_bloque']);
  expect(sim.estado.recibidos[0].selfie_path).toBeNull();
  expect(sim.estado.recibidos[1].selfie_path).toMatch(/\.webp$/);
  await expect(page.locator('#jornada-cerrada')).toBeVisible();
});

test('comida entre bloques e iniciar el bloque de campo desde la comida', async ({ page, context }) => {
  const sim = await abrirA(page, context, '13:10', { eventos: [...ESCRITORIO] });
  await secundaria(page, 'Iniciar comida').click();
  await expect(page.locator('#checada-titulo')).toHaveText('Inicio de comida/pausa');
  await confirmarYCerrar(page);
  expect(sim.estado.recibidos.at(-1)).toMatchObject({ tipo: 'inicio_pausa', bloque: null });
  await expect(page.locator('#boton-principal-detalle')).toHaveText('Comida entre bloques');

  page.once('dialog', (d) => d.accept());
  await secundaria(page, 'Iniciar bloque de campo').click();
  await expect(page.locator('#checada-titulo')).toHaveText('Entrada · campo');
  await tomarSelfie(page);
  await confirmarYCerrar(page);
  expect(sim.estado.recibidos.slice(-2).map((e) => e.tipo)).toEqual(['fin_pausa', 'inicio_bloque']);
  await expect(textoBoton(page)).toHaveText('Terminar bloque de campo');
});

test('la pausa dentro del bloque resta de las horas; la comida entre bloques no', async ({ page, context }) => {
  await abrirA(page, context, '18:00', { eventos: [
    ...ESCRITORIO,
    ev('inicio_pausa', `${DIA}T13:00`), ev('fin_pausa', `${DIA}T14:00`),                      // comida entre bloques: no resta
    ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo' }),
    ev('inicio_pausa', `${DIA}T17:00`), ev('fin_pausa', `${DIA}T17:20`)                       // dentro del bloque: resta 20 min
  ] });
  await expect(page.locator('#horas-hoy')).toHaveText('5:40');   // 4:00 escritorio + 2:00 campo − 0:20
});

test('si la organización lo pide (selfie_en_pausas_y_visitas), la pausa también lleva selfie', async ({ page, context }) => {
  const sim = await abrirA(page, context, '18:00', { eventos: CAMPO_ABIERTO, configPA: { selfie_en_pausas_y_visitas: true } });
  await secundaria(page, 'Iniciar comida/pausa').click();
  await expect(page.locator('#checada-selfie')).toBeVisible();
  await expect(page.locator('#checada-confirmar')).toBeDisabled();
  await tomarSelfie(page);
  await confirmarYCerrar(page);
  expect(sim.estado.recibidos.at(-1).selfie_path).toMatch(/\.webp$/);
});
