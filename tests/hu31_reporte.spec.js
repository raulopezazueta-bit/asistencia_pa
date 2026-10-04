// HU-31 · Reporte para la autoridad (página para imprimir o guardar en PDF) y CSV para nómina, desde el panel.
// Datos ficticios. Semana del lunes 5-oct-2026 (hora de Culiacán).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { simularSupabase, entrar, eventoServidor as ev, HORARIO_ASESOR, USUARIOS } from './simulador.js';
import { armarReporte, csvNomina } from '../js/reporte.js';

const ISO = (f, h) => new Date(`${f}T${h}:00-07:00`).toISOString();
const ASESOR = { id: 'aaaaaaaa-0000-0000-0000-000000000001', nombre_completo: 'Asesor de Prueba', num_empleado: 'F-001', rol: 'asesor' };

test('armado del reporte: bloques, pausas, horas oficiales, marcas y CSV', () => {
  const lunes = '2026-10-05', sabado = '2026-10-10';
  const e = (tipo, f, h, extra = {}) => ev(tipo, `${f}T${h}`, extra);
  const revisar = e('fin_bloque', lunes, '20:00', { bloque: 'campo', estado_revision: 'revisar', motivos_revision: ['fuera_de_geocerca'] });
  const personas = armarReporte({
    miembros: [ASESOR],
    dias: [
      { miembro_id: ASESOR.id, fecha: lunes, inicio_jornada: ISO(lunes, '09:02'), fin_jornada: ISO(lunes, '20:00'), minutos_pausa: 20, minutos_efectivos: 458,
        jornada_abierta: false, bloque_inconsistente: false, bloques: { escritorio: { inicio: ISO(lunes, '09:02'), fin: ISO(lunes, '13:00') }, campo: { inicio: ISO(lunes, '16:00'), fin: ISO(lunes, '20:00') } } },
      { miembro_id: ASESOR.id, fecha: sabado, inicio_jornada: ISO(sabado, '10:00'), fin_jornada: null, minutos_pausa: 0, minutos_efectivos: 0,
        jornada_abierta: true, bloque_inconsistente: false, bloques: { campo: { inicio: ISO(sabado, '10:00'), fin: null } } }
    ],
    eventos: [
      e('inicio_bloque', lunes, '09:02', { bloque: 'escritorio', modalidad: 'teletrabajo' }),
      e('fin_bloque', lunes, '13:00', { bloque: 'escritorio', modalidad: 'teletrabajo', origen: 'incidencia' }),
      e('inicio_bloque', lunes, '16:00', { bloque: 'campo' }),
      e('inicio_pausa', lunes, '18:00'), e('fin_pausa', lunes, '18:20'), revisar,
      e('inicio_bloque', sabado, '10:00', { bloque: 'campo' })
    ],
    revisiones: [{ evento_id: revisar.id, decision: 'observada', comentario: 'A 200 m del parque' }],
    horarios: HORARIO_ASESOR.map((h) => ({ ...h, miembro_id: ASESOR.id })),
    zona: 'America/Mazatlan'
  });
  const [p] = personas;
  expect(p.totalMinutos).toBe(458);
  expect(p.dias.map((d) => d.fecha)).toEqual([lunes, sabado]);
  const [l, s] = p.dias;
  expect(l).toMatchObject({ entrada: '09:02', salida: '20:00', minutos: 458, minutosPausa: 20, incidencia: true, revision: true, fueraDeHorario: false });
  expect(l.bloques).toEqual([{ bloque: 'escritorio', inicio: '09:02', fin: '13:00', modalidad: 'teletrabajo' }, { bloque: 'campo', inicio: '16:00', fin: '20:00', modalidad: 'presencial' }]);
  expect(l.pausas).toEqual([{ inicio: '18:00', fin: '18:20' }]);
  expect(l.marcas).toEqual(['Incidencia aprobada: fin de bloque de escritorio 13:00', 'Fin de bloque 20:00 (Fuera de zona) · observada: A 200 m del parque']);
  expect(s.marcas).toEqual(['Bloque sin cerrar (no suma horas)', 'Fuera de horario']);
  const csv = csvNomina(personas, 'Parques Alegres IAP');
  expect(csv.startsWith('﻿organizacion,num_empleado,nombre,fecha,entrada,salida,minutos_efectivos,horas_efectivas,horas_decimal,')).toBe(true);
  const filas = csv.trim().split('\r\n');
  expect(filas).toHaveLength(3);
  expect(filas[1]).toBe('Parques Alegres IAP,F-001,Asesor de Prueba,2026-10-05,09:02,20:00,458,7:38,7.63,20,no,si,si,no');
  expect(filas[2]).toBe('Parques Alegres IAP,F-001,Asesor de Prueba,2026-10-10,10:00,,0,0:00,0.00,0,si,no,no,si');
});

const DIA = '2026-10-05';
const EVENTOS = [
  ev('inicio_bloque', `${DIA}T09:02`, { bloque: 'escritorio', modalidad: 'teletrabajo' }),
  ev('fin_bloque', `${DIA}T13:00`, { bloque: 'escritorio', modalidad: 'teletrabajo' }),
  ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo' }),
  ev('fin_bloque', `${DIA}T20:00`, { bloque: 'campo', estado_revision: 'revisar', motivos_revision: ['sin_ubicacion'] })
];
async function abrirPanel(page, usuario = USUARIOS.coordinador) {
  await page.clock.setFixedTime(new Date(`${DIA}T21:00:00-07:00`));
  const sim = await simularSupabase(page, { sitiosPA: 20, eventos: EVENTOS.map((x) => ({ ...x })) });
  await page.goto('index.html');
  await entrar(page, usuario);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  return sim;
}

test('panel: el reporte para la autoridad se abre con el periodo y la persona; se puede imprimir', async ({ page, context }) => {
  await abrirPanel(page);
  await page.goto('panel.html');
  await expect(page.locator('#reporte-desde')).toHaveValue('2026-10-01');
  await expect(page.locator('#reporte-hasta')).toHaveValue(DIA);
  await expect(page.locator('#reporte-persona option')).toHaveCount(5);   // Todas + 4 personas activas de PA (incluye administración)
  await page.locator('#reporte-desde').fill('2026-10-06');
  await page.locator('#reporte-ver').click();
  await expect(page.locator('#reporte-error')).toHaveText('La fecha "Desde" debe ser anterior o igual a "Hasta".');
  await page.locator('#reporte-desde').fill('2026-10-01');
  await page.locator('#reporte-persona').selectOption({ label: 'Asesor de Prueba' });
  const [rep] = await Promise.all([context.waitForEvent('page'), page.locator('#reporte-ver').click()]);
  await rep.clock.setFixedTime(new Date(`${DIA}T21:00:00-07:00`));
  await expect(rep).toHaveURL(/reporte\.html\?desde=2026-10-01&hasta=2026-10-05&miembro=aaaaaaaa-0000-0000-0000-000000000001$/);
  await expect(rep.locator('#reporte')).toBeVisible();
  await expect(rep.locator('#reporte-org')).toHaveText('Parques Alegres IAP');
  await expect(rep.locator('#reporte-periodo')).toHaveText('jue 1 oct 2026 – lun 5 oct 2026');
  await expect(rep.locator('#reporte-emitio')).toHaveText('Coordinación de Prueba (Coordinación)');
  await expect(rep.locator('.reporte__persona')).toHaveCount(1);
  const fila = rep.locator(`.reporte__persona tr[data-fecha="${DIA}"]`);
  await expect(fila).toContainText('lun 5 oct 2026');
  await expect(fila).toContainText('Escritorio (teletrabajo) 09:02–13:00; Campo 16:00–20:00');
  await expect(fila).toContainText('7:58');
  await expect(fila).toContainText('Fin de bloque 20:00 (Sin ubicación) · por revisar');
  await expect(rep.locator('.reporte__persona tfoot')).toContainText('7:58');
  await expect(rep.locator('.reporte__firmas')).toContainText('Firma de la persona trabajadora');
  await rep.evaluate(() => { window.__impreso = false; window.print = () => { window.__impreso = true; }; });
  await rep.locator('#reporte-imprimir').click();
  expect(await rep.evaluate(() => window.__impreso)).toBe(true);
});

test('panel: el CSV para nómina se descarga con una fila por persona y día', async ({ page }) => {
  await abrirPanel(page);
  await page.goto('panel.html');
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.locator('#reporte-csv').click()]);
  expect(descarga.suggestedFilename()).toBe('jornada_parques-alegres_2026-10-01_2026-10-05.csv');
  const texto = readFileSync(await descarga.path(), 'utf8');
  const filas = texto.replace(/^﻿/, '').trim().split('\r\n');
  expect(filas[0].split(',')).toContain('horas_decimal');
  expect(filas.slice(1)).toEqual(['Parques Alegres IAP,,Asesor de Prueba,2026-10-05,09:02,20:00,478,7:58,7.97,0,no,si,no,no']);
});

test('una persona asesora no puede abrir el reporte de la organización', async ({ page }) => {
  await abrirPanel(page, USUARIOS.asesor);
  await page.goto('reporte.html?desde=2026-10-01&hasta=2026-10-05');
  await expect(page.locator('#reporte-estado')).toHaveText('El reporte de la organización es solo para coordinación.');
  await expect(page.locator('#reporte')).toBeHidden();
});

test('contra la API local (vista oficial y RLS reales): reporte de PA sin datos de IAP Demo', async ({ page }) => {
  const { apiLocalDisponible, conectarApiLocal, CUENTAS } = await import('./api_local.js');
  test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
  await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, CUENTAS.coordPA);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.goto('reporte.html?desde=2026-09-28&hasta=2026-10-01');
  await expect(page.locator('#reporte')).toBeVisible();
  const fila = page.locator('.reporte__persona tr[data-fecha="2026-10-01"]');
  await expect(fila).toContainText('Campo 16:00–20:00');
  await expect(fila).toContainText('4:00');
  await expect(fila).toContainText('Fuera de horario');   // el asesor de PA solo tiene horario los lunes
  await expect(page.locator('#reporte-personas')).not.toContainText('Demo');
});
