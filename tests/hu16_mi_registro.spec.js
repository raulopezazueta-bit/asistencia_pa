// HU-16 · Mi registro: la persona consulta su historial por periodo, lo imprime o guarda en PDF y lo descarga en CSV;
// ve las checadas que coordinación observó. Reloj: lunes 5-oct-2026, hora de Culiacán. Datos ficticios.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { simularSupabase, entrar, senal, eventoServidor as ev, USUARIOS } from './simulador.js';

const DIA = '2026-10-05';
const OBSERVADA = ev('fin_bloque', `${DIA}T20:00`, { id: 'eeeeeeee-0000-0000-0000-0000000000b2', bloque: 'campo', estado_revision: 'revisar', motivos_revision: ['fuera_de_geocerca'] });
const EVENTOS = [
  ev('inicio_bloque', `${DIA}T09:02`, { bloque: 'escritorio', modalidad: 'teletrabajo' }),
  ev('fin_bloque', `${DIA}T13:00`, { bloque: 'escritorio', modalidad: 'teletrabajo' }),
  ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo' }),
  OBSERVADA,
  // De otra persona: nunca debe aparecer
  ev('inicio_bloque', `${DIA}T10:00`, { bloque: 'campo', miembro_id: 'aaaaaaaa-0000-0000-0000-000000000011' })
];
const REVISIONES = [{ evento_id: OBSERVADA.id, decision: 'observada', comentario: 'La checada quedó a 300 m del parque', organizacion_id: '11111111-1111-1111-1111-111111111111',
  revisado_por: 'aaaaaaaa-0000-0000-0000-000000000002', revisado_en: '2026-10-06T04:00:00.000Z' }];

async function abrirHistorial(page) {
  await page.clock.setFixedTime(new Date(`${DIA}T21:00:00-07:00`));
  const sim = await simularSupabase(page, { sitiosPA: 20, eventos: EVENTOS.map((x) => ({ ...x })), revisiones: REVISIONES.map((x) => ({ ...x })) });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.locator('[data-pestana="historial"]').click();
  return sim;
}

test('historial: periodo por omisión y checadas observadas con el comentario de coordinación', async ({ page }) => {
  await abrirHistorial(page);
  await expect(page.locator('#mi-registro-desde')).toHaveValue('2026-10-01');
  await expect(page.locator('#mi-registro-hasta')).toHaveValue(DIA);
  await expect(page.locator('#observadas')).toBeVisible();
  const fila = page.locator('#observadas-lista .lista__fila');
  await expect(fila).toHaveCount(1);
  await expect(fila).toContainText('Fin de bloque de campo');
  await expect(fila).toContainText('lun 5 oct · 20:00');
  await expect(fila).toContainText('Coordinación: La checada quedó a 300 m del parque');
});

test('ver mi registro: abre la página para imprimir solo con mis datos', async ({ page }) => {
  await abrirHistorial(page);
  await page.locator('#mi-registro-ver').click();
  await expect(page).toHaveURL(/reporte\.html\?desde=2026-10-01&hasta=2026-10-05&mio=1$/);
  await expect(page.locator('#reporte')).toBeVisible();
  await expect(page).toHaveTitle('Mi registro de jornada · 2026-10-01 a 2026-10-05');
  await expect(page.locator('.reporte__barra a')).toHaveText('Volver a la app');
  await expect(page.locator('#reporte-emitio')).toHaveText('Asesor de Prueba (Asesoría)');
  await expect(page.locator('.reporte__persona')).toHaveCount(1);
  await expect(page.locator('.reporte__persona h2')).toHaveText('Asesor de Prueba');
  const fila = page.locator(`.reporte__persona tr[data-fecha="${DIA}"]`);
  await expect(fila).toContainText('Escritorio (teletrabajo) 09:02–13:00; Campo 16:00–20:00');
  await expect(fila).toContainText('7:58');
  await expect(fila).toContainText('Fin de bloque 20:00 (Fuera de zona) · observada: La checada quedó a 300 m del parque');
  await expect(page.locator('#reporte-personas')).not.toContainText('Persona Compartida');
});

test('descargar CSV de mi registro; validaciones y sin señal', async ({ page, context }) => {
  const sim = await abrirHistorial(page);
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.locator('#mi-registro-csv').click()]);
  expect(descarga.suggestedFilename()).toBe('mi_registro_2026-10-01_2026-10-05.csv');
  const filas = readFileSync(await descarga.path(), 'utf8').replace(/^﻿/, '').trim().split('\r\n');
  expect(filas.slice(1)).toEqual(['Parques Alegres IAP,,Asesor de Prueba,2026-10-05,09:02,20:00,478,7:58,7.97,0,no,si,no,no']);
  await page.locator('#mi-registro-desde').fill('2026-10-09');
  await page.locator('#mi-registro-ver').click();
  await expect(page.locator('#mi-registro-error')).toHaveText('La fecha "Desde" debe ser anterior o igual a "Hasta".');
  await page.locator('#mi-registro-desde').fill('2026-10-01');
  await senal(context, sim, false);
  await page.locator('#mi-registro-csv').click();
  await expect(page.locator('#mi-registro-error')).toHaveText('Sin señal: para descargar tu registro necesitas conexión.');
  await page.locator('#mi-registro-ver').click();
  await expect(page.locator('#mi-registro-error')).toHaveText('Sin señal: para consultar tu registro necesitas conexión.');
  await senal(context, sim, true);
});

test('contra la API local (vista oficial y RLS reales): mi registro del asesor de PA', async ({ page }) => {
  const { apiLocalDisponible, conectarApiLocal, CUENTAS } = await import('./api_local.js');
  test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
  await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, CUENTAS.asesorPA);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.goto('reporte.html?desde=2026-09-28&hasta=2026-10-01&mio=1');
  await expect(page.locator('#reporte')).toBeVisible();
  await expect(page.locator('.reporte__persona')).toHaveCount(1);
  const fila = page.locator('.reporte__persona tr[data-fecha="2026-10-01"]');
  await expect(fila).toContainText('Campo 16:00–20:00');
  await expect(fila).toContainText('4:00');
  // El asesor no puede abrir el reporte de la organización
  await page.goto('reporte.html?desde=2026-09-28&hasta=2026-10-01');
  await expect(page.locator('#reporte-estado')).toHaveText('El reporte de la organización es solo para coordinación.');
});
