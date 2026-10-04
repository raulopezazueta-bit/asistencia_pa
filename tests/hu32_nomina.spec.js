// HU-32 · Nómina semanal: 40 h ordinarias de lunes a viernes; la actividad fuera de horario (fin de semana) no se paga
// como extra: da medio día libre la semana siguiente, que baja las horas esperadas de esa semana. Datos ficticios.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { simularSupabase, entrar, eventoServidor as ev, USUARIOS } from './simulador.js';
import { semanasNomina, csvSemanal, lunesDe } from '../js/nomina.js';

const PERSONA = { id: 'm1', nombre_completo: 'Asesor de Prueba', num_empleado: 'F-001', rol: 'asesor' };
const dia = (fecha, horas, fuera = false) => ({ fecha, minutos: Math.round(horas * 60), fueraDeHorario: fuera });
const lv = (lunes, horasPorDia) => horasPorDia.map((h, i) => {
  const d = new Date(`${lunes}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
  return dia(d.toISOString().slice(0, 10), h);
});

test('lunes de una fecha', () => {
  expect(lunesDe('2026-10-05')).toBe('2026-10-05');
  expect(lunesDe('2026-10-10')).toBe('2026-10-05');
  expect(lunesDe('2026-10-11')).toBe('2026-10-05');
  expect(lunesDe('2026-10-04')).toBe('2026-09-28');
});

test('semanas: ordinarias contra 40 h, fuera de horario, medio día libre la semana siguiente, excedente y faltante', () => {
  const personas = [{ miembro: PERSONA, dias: [
    ...lv('2026-09-28', [8, 8, 8, 8, 8]), dia('2026-10-03', 3, true),          // semana 1: 40 h + sábado 3 h
    ...lv('2026-10-05', [8, 8, 4, 8, 8]),                                       // semana 2: 36 h (tomó su medio día)
    ...lv('2026-10-12', [8, 8, 8, 8, 9]), dia('2026-10-17', 2, true), dia('2026-10-18', 1, true),   // semana 3: 41 h + sáb y dom
    ...lv('2026-10-19', [8, 8, 8])                                              // semana 4 en curso
  ] }];
  const filas = semanasNomina(personas, { desde: '2026-10-01', hasta: '2026-10-21', hoy: '2026-10-21', config: {} });
  expect(filas.map((f) => [f.semana, f.minutosLV / 60, f.ordinarias / 60, f.excedenteLV / 60, f.minutosFuera / 60, f.diasFuera,
    f.generaMediosDias, f.mediosDiasEstaSemana, f.esperadas / 60, f.faltante / 60, f.completa])).toEqual([
    ['2026-09-28', 40, 40, 0, 3, 1, 1, 0, 40, 0, true],
    ['2026-10-05', 36, 36, 0, 0, 0, 0, 1, 36, 0, true],    // el medio día libre no cuenta como falta
    ['2026-10-12', 41, 40, 1, 3, 2, 1, 0, 40, 0, true],
    ['2026-10-19', 24, 24, 0, 0, 0, 0, 1, 36, 0, false]    // en curso: sin faltante todavía
  ]);
  // Configurable: un medio día por cada día fuera de horario, jornada de 48 h
  const otra = semanasNomina(personas, { desde: '2026-10-12', hasta: '2026-10-25', hoy: '2026-10-30', config: { medio_dia_libre_por: 'dia', jornada_semanal_horas: 48 } });
  expect(otra.map((f) => [f.semana, f.generaMediosDias, f.mediosDiasEstaSemana, f.esperadas / 60, f.faltante / 60])).toEqual([
    ['2026-10-12', 2, 0, 48, 7], ['2026-10-19', 0, 2, 40, 16]
  ]);
  const csv = csvSemanal(filas.slice(0, 2), 'Parques Alegres IAP').replace(/^﻿/, '').trim().split('\r\n');
  expect(csv[0]).toBe('organizacion,num_empleado,nombre,semana_inicio,semana_fin,semana_completa,horas_lunes_a_viernes,horas_ordinarias,horas_excedentes_lunes_a_viernes,horas_fuera_de_horario,dias_fuera_de_horario,medios_dias_libres_ganados,medios_dias_libres_esta_semana,horas_esperadas,horas_faltantes');
  expect(csv[1]).toBe('Parques Alegres IAP,F-001,Asesor de Prueba,2026-09-28,2026-10-04,si,40.00,40.00,0.00,3.00,1,1,0,40.00,0.00');
  expect(csv[2]).toBe('Parques Alegres IAP,F-001,Asesor de Prueba,2026-10-05,2026-10-11,si,36.00,36.00,0.00,0.00,0,0,1,36.00,0.00');
});

// Sábado 3-oct (fuera de horario) y lunes 5-oct (jornada normal) para el asesor ficticio
const EVENTOS = [
  ev('inicio_bloque', '2026-10-03T09:00', { bloque: 'campo' }), ev('fin_bloque', '2026-10-03T12:00', { bloque: 'campo' }),
  ev('inicio_bloque', '2026-10-05T09:00', { bloque: 'escritorio', modalidad: 'teletrabajo' }), ev('fin_bloque', '2026-10-05T13:00', { bloque: 'escritorio', modalidad: 'teletrabajo' }),
  ev('inicio_bloque', '2026-10-05T16:00', { bloque: 'campo' }), ev('fin_bloque', '2026-10-05T20:00', { bloque: 'campo' })
];

test('panel: CSV semanal para nómina con el medio día libre ganado y el que corresponde', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-12T10:00:00-07:00'));
  await simularSupabase(page, { sitiosPA: 5, eventos: EVENTOS.map((x) => ({ ...x })) });
  await page.goto('index.html');
  await entrar(page, USUARIOS.coordinador);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.goto('panel.html');
  await page.locator('#reporte-desde').fill('2026-10-01');
  await page.locator('#reporte-hasta').fill('2026-10-11');
  await page.locator('#reporte-persona').selectOption({ label: 'Asesor de Prueba' });
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.locator('#reporte-semanal').click()]);
  expect(descarga.suggestedFilename()).toBe('semanas_parques-alegres_2026-10-01_2026-10-11.csv');
  const filas = readFileSync(await descarga.path(), 'utf8').replace(/^﻿/, '').trim().split('\r\n');
  expect(filas.slice(1)).toEqual([
    'Parques Alegres IAP,,Asesor de Prueba,2026-09-28,2026-10-04,si,0.00,0.00,0.00,3.00,1,1,0,40.00,40.00',
    'Parques Alegres IAP,,Asesor de Prueba,2026-10-05,2026-10-11,si,8.00,8.00,0.00,0.00,0,0,1,36.00,28.00'
  ]);
});

test('app: en Historial el asesor ve que esta semana tiene medio día libre', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-05T21:00:00-07:00'));
  await simularSupabase(page, { sitiosPA: 5, eventos: EVENTOS.map((x) => ({ ...x })) });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.locator('[data-pestana="historial"]').click();
  await expect(page.locator('#semana-nota')).toContainText('Esta semana tienes medio día libre por tu actividad fuera de horario de la semana pasada');
});
