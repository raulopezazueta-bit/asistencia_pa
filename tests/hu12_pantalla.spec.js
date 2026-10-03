// HU-12 · Pantalla de Inicio: botón principal, bloques del día, horas y alertas, con y sin señal.
// El reloj de la página se fija en un lunes (5-oct-2026) a distintas horas de Culiacán.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, senal, eventoServidor as ev, USUARIOS } from './simulador.js';

const DIA = '2026-10-05';
const MANANA = [
  ev('inicio_bloque', `${DIA}T09:01`, { bloque: 'escritorio', modalidad: 'teletrabajo' }),
  ev('fin_bloque', `${DIA}T13:04`, { bloque: 'escritorio', modalidad: 'teletrabajo' }),
  ev('inicio_pausa', `${DIA}T13:04`),
  ev('fin_pausa', `${DIA}T13:55`)
];

async function abrirA(page, hora, { eventos = [], usuario = USUARIOS.asesor } = {}) {
  await page.clock.setFixedTime(new Date(`${DIA}T${hora}:00-07:00`));
  const sim = await simularSupabase(page, { eventos, sitiosPA: 20 });
  await page.goto('index.html');
  await entrar(page, usuario);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  return sim;
}

const textoBoton = (page) => page.locator('#boton-principal-texto');
const filas = (page) => page.locator('#lista-bloques .lista__fila');

test('8:30 sin checar: iniciar bloque de escritorio y ambos bloques pendientes', async ({ page }) => {
  await abrirA(page, '08:30');
  await expect(textoBoton(page)).toHaveText('Iniciar bloque de escritorio');
  await expect(page.locator('#boton-principal-detalle')).toHaveText('Teletrabajo · Programado 09:00 – 13:00');
  await expect(page.locator('#horas-programadas')).toHaveText('de 8:00 h programadas');
  await expect(filas(page)).toHaveCount(2);
  await expect(filas(page).nth(0)).toContainText('Bloque escritorio');
  await expect(filas(page).nth(0)).toContainText('Pendiente');
  await expect(page.locator('#calificacion-hoy')).toBeHidden();
  await expect(page.locator('#acciones-secundarias button')).toHaveText(['Iniciar bloque de campo']);
});

test('14:00 tras escritorio y comida: iniciar campo, 4:03 h, en regla', async ({ page }) => {
  await abrirA(page, '14:00', { eventos: MANANA });
  await expect(textoBoton(page)).toHaveText('Iniciar bloque de campo');
  await expect(page.locator('#horas-hoy')).toHaveText('4:03');
  await expect(page.locator('#calificacion-hoy')).toHaveText('En regla');
  await expect(filas(page)).toHaveCount(3);
  await expect(filas(page).nth(0)).toContainText('Teletrabajo · 09:01 – 13:04');
  await expect(filas(page).nth(0)).toContainText('Cerrado');
  await expect(filas(page).nth(1)).toContainText('Comida/pausa');
  await expect(filas(page).nth(2)).toContainText('Programado 16:00 – 20:00');
  await expect(page.locator('#acciones-secundarias button').first()).toHaveText('Iniciar comida');
});

test('olvido de fin: escritorio abierto a las 16:00 muestra la alerta', async ({ page }) => {
  await abrirA(page, '16:00', { eventos: [MANANA[0]] });
  await expect(textoBoton(page)).toHaveText('Terminar bloque de escritorio');
  await expect(page.locator('[data-alerta="olvido_fin"]')).toContainText('¿Olvidaste checar salida?');
  await expect(filas(page).nth(0)).toContainText('En curso');
});

test('pausa abierta en campo: regresar de la pausa', async ({ page }) => {
  await abrirA(page, '18:10', { eventos: [...MANANA, ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo' }), ev('inicio_pausa', `${DIA}T18:00`)] });
  await expect(textoBoton(page)).toHaveText('Regresar de la pausa');
  await expect(page.locator('#boton-principal-detalle')).toHaveText('Bloque de campo en pausa');
  await expect(page.locator('#acciones-secundarias button')).toHaveText(['Terminar bloque de campo']);
});

test('retardo y jornada cerrada', async ({ page }) => {
  const dia = [
    ev('inicio_bloque', `${DIA}T09:25`, { bloque: 'escritorio', modalidad: 'teletrabajo' }),
    ev('fin_bloque', `${DIA}T13:00`, { bloque: 'escritorio' }),
    ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo' }),
    ev('fin_bloque', `${DIA}T20:00`, { bloque: 'campo' })
  ];
  await abrirA(page, '20:05', { eventos: dia });
  await expect(page.locator('#boton-principal')).toBeHidden();
  await expect(page.locator('#jornada-cerrada')).toBeVisible();
  await expect(page.locator('#calificacion-hoy')).toHaveText('Retardo');
  await expect(page.locator('#horas-hoy')).toHaveText('7:35');
  await expect(page.locator('#acciones-secundarias button')).toHaveText(['Solicitar corrección']);
});

test('sin horario cargado: pregunta qué bloque inicia', async ({ page }) => {
  await abrirA(page, '10:00', { usuario: USUARIOS.coordinador });
  await expect(textoBoton(page)).toHaveText('Iniciar bloque');
  await expect(page.locator('#boton-principal-detalle')).toHaveText('¿Qué bloque inicias? Lo eliges al checar');
  await expect(page.locator('#horas-programadas')).toHaveText('Sin horario cargado para hoy');
});

test('sin señal: el estado del día se arma con el horario y los eventos guardados', async ({ page, context }) => {
  const sim = await abrirA(page, '14:00', { eventos: MANANA });
  await expect(page.locator('#horas-hoy')).toHaveText('4:03');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await senal(context, sim, false);
  await page.reload();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(textoBoton(page)).toHaveText('Iniciar bloque de campo');
  await expect(page.locator('#horas-hoy')).toHaveText('4:03');
  await expect(filas(page)).toHaveCount(3);
  await senal(context, sim, true);
});

test('contra la API local (PostgREST + RLS reales): lee horario y eventos del día', async ({ page }) => {
  const { apiLocalDisponible, conectarApiLocal, CUENTAS } = await import('./api_local.js');
  test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
  // En datos_ficticios.sql el asesor de PA tiene horario solo los lunes y eventos de campo el jueves 1-oct 16:00–20:00.
  await page.clock.setFixedTime(new Date('2026-10-01T21:00:00-07:00'));
  await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, CUENTAS.asesorPA);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(page.locator('#horas-hoy')).toHaveText('4:00');
  await expect(textoBoton(page)).toHaveText('Iniciar bloque de escritorio');   // sin horario el jueves: ofrece el otro bloque
  await expect(filas(page).nth(0)).toContainText('16:00 – 20:00');
  // El lunes sí hay horario
  const filasHorario = await page.evaluate(async () => (await (await import('./js/almacen.js')).leerMeta('horarios')).filas.length);
  expect(filasHorario).toBe(2);
});
