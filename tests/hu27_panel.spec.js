// HU-27 · Panel de coordinación: tarjetas (en jornada, % dentro de zona, incidencias, parques hoy) y tabla del día por persona.
// Reloj: lunes 5-oct-2026, hora de Culiacán. Datos ficticios.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, eventoServidor as ev, incidenciaServidor as inc, HORARIO_ASESOR, USUARIOS } from './simulador.js';
import { tableroDelDia } from '../js/tablero.js';

const DIA = '2026-10-05';
const P1 = 'ffffffff-0000-0000-0000-000000000001';
const A = 'aaaaaaaa-0000-0000-0000-0000000000a1', B = 'aaaaaaaa-0000-0000-0000-0000000000b1', C = 'aaaaaaaa-0000-0000-0000-0000000000c1', D = 'aaaaaaaa-0000-0000-0000-0000000000d1';

test('cálculo del tablero: estados, dónde está, tarjetas y checadas corregidas', () => {
  const horario = (m) => HORARIO_ASESOR.map((h) => ({ ...h, miembro_id: m }));
  const e = (m, tipo, hora, extra = {}) => ev(tipo, hora, { miembro_id: m, ...extra });
  const corregida = e(D, 'fin_bloque', `${DIA}T09:40`, { bloque: 'campo', id: 'eeeeeeee-0000-0000-0000-00000000c0rr' });
  const t = tableroDelDia({
    miembros: [
      { id: A, nombre_completo: 'Ana Ficticia', rol: 'asesor' }, { id: B, nombre_completo: 'Beto Ficticio', rol: 'asesor' },
      { id: C, nombre_completo: 'Carla Sin Horario', rol: 'admin' }, { id: D, nombre_completo: 'Dani Ficticia', rol: 'coordinador' }
    ],
    horarios: [...horario(A), ...horario(B)],
    eventos: [
      e(A, 'inicio_bloque', `${DIA}T09:20`, { bloque: 'escritorio', modalidad: 'teletrabajo', dentro_geocerca: null }),
      e(D, 'inicio_bloque', `${DIA}T08:00`, { bloque: 'campo', sitio_id: P1, dentro_geocerca: true }),
      corregida,
      e(D, 'llegada_sitio', `${DIA}T08:05`, { sitio_id: P1, dentro_geocerca: false }),
      e(A, 'inicio_bloque', '2026-09-30T16:00', { bloque: 'campo', dentro_geocerca: true })   // miércoles: solo cuenta para la semana
    ],
    corregidas: new Set([corregida.id]),
    sitios: [{ id: P1, nombre: 'Parque Ficticio 001', tipo: 'parque' }],
    ahora: new Date(`${DIA}T10:00:00-07:00`), zona: 'America/Mazatlan'
  });
  expect(t.filas.map((f) => [f.nombre, f.estado, f.situacion, f.sitio])).toEqual([
    ['Beto Ficticio', 'sin_checar', 'sin_registro', null],
    ['Ana Ficticia', 'retardo', 'en_jornada', 'Teletrabajo'],
    ['Dani Ficticia', 'en_regla', 'en_jornada', 'Parque Ficticio 001']   // la checada corregida (fin 9:40) no cuenta: sigue en campo
  ]);
  expect(t.filas[1].minutos).toBe(40);
  expect(t.tarjetas).toMatchObject({ enJornada: 2, total: 3, dentroDeZona: 67, checadasConZona: 3, parquesHoy: 1 });
});

async function abrirPanel(page, hora, { eventos = [], incidencias = [] } = {}) {
  await page.clock.setFixedTime(new Date(`${DIA}T${hora}:00-07:00`));
  const sim = await simularSupabase(page, { sitiosPA: 20, eventos: eventos.map((x) => ({ ...x })), incidencias });
  await page.goto('index.html');
  await entrar(page, USUARIOS.coordinador);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.goto('panel.html');
  await expect(page.locator('#panel')).toBeVisible();
  return sim;
}
const fila = (page, nombre) => page.locator('#tabla-hoy-cuerpo tr', { hasText: nombre });

test('panel: asesor en campo dentro de un parque; tarjetas y tabla del día', async ({ page }) => {
  await abrirPanel(page, '17:30', {
    eventos: [
      ev('inicio_bloque', `${DIA}T09:02`, { bloque: 'escritorio', modalidad: 'teletrabajo', dentro_geocerca: null }),
      ev('fin_bloque', `${DIA}T13:00`, { bloque: 'escritorio', modalidad: 'teletrabajo', dentro_geocerca: null }),
      ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo', sitio_id: P1 }),
      ev('llegada_sitio', `${DIA}T16:05`, { sitio_id: P1 }),
      ev('inicio_bloque', `${DIA}T16:20`, { bloque: 'campo', dentro_geocerca: false, miembro_id: 'aaaaaaaa-0000-0000-0000-000000000011', estado_revision: 'revisar', motivos_revision: ['fuera_de_geocerca'] })
    ],
    incidencias: [inc('otro')]
  });
  await expect(page.locator('#hoy-fecha')).toHaveText('lun 5 oct');
  await expect(page.locator('#kpi-en-jornada')).toHaveText('2');
  await expect(page.locator('#kpi-total')).toHaveText(' / 2');
  await expect(page.locator('#kpi-zona')).toHaveText('67\u202f%');
  await expect(page.locator('#kpi-parques')).toHaveText('1');
  await expect(page.locator('#kpi-incidencias')).toHaveText('1');
  const asesor = fila(page, 'Asesor de Prueba');
  await expect(asesor).toContainText('En bloque de campo');
  await expect(asesor).toContainText('09:02');
  await expect(asesor).toContainText('Parque Ficticio 001');
  await expect(asesor).toContainText('5:28 / 8:00');
  await expect(asesor).toContainText('En regla');
  // Sin horario, con checada fuera de zona: aparece y se marca Revisar (va primero)
  await expect(page.locator('#tabla-hoy-cuerpo tr').first()).toContainText('Persona Compartida');
  await expect(fila(page, 'Persona Compartida')).toContainText('Revisar');
  // Coordinación sin horario ni checadas no aparece
  await expect(fila(page, 'Coordinación de Prueba')).toHaveCount(0);
});

test('panel: a las 10:00 sin checadas el asesor aparece "Sin checar"; actualizar vuelve a leer', async ({ page }) => {
  const sim = await abrirPanel(page, '10:00');
  await expect(fila(page, 'Asesor de Prueba')).toContainText('Sin checar');
  await expect(fila(page, 'Asesor de Prueba')).toContainText('Sin registros hoy');
  await expect(page.locator('#kpi-en-jornada')).toHaveText('0');
  await expect(page.locator('#kpi-zona')).toHaveText('—');
  const antes = sim.registro.filter((r) => r.ruta === '/rest/v1/eventos_jornada').length;
  await page.locator('#hoy-actualizar').click();
  await expect.poll(() => sim.registro.filter((r) => r.ruta === '/rest/v1/eventos_jornada').length).toBeGreaterThan(antes);
});

test('contra la API local (RLS real): coordinación de PA ve a su gente y nada de IAP Demo', async ({ page }) => {
  const { apiLocalDisponible, conectarApiLocal, CUENTAS } = await import('./api_local.js');
  test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
  // datos_ficticios.sql: el asesor de PA checó campo el jueves 1-oct 16:00–20:00 (sin horario ese día)
  await page.clock.setFixedTime(new Date('2026-10-01T21:00:00-07:00'));
  await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, CUENTAS.coordPA);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.goto('panel.html');
  const asesor = page.locator('#tabla-hoy-cuerpo tr', { hasText: 'Asesor de Prueba' });
  await expect(asesor).toContainText('16:00');
  await expect(asesor).toContainText('4:00');
  await expect(asesor).toContainText('Fuera de bloque');
  await expect(page.locator('#tabla-hoy-cuerpo')).not.toContainText('Demo');
  await expect(page.locator('#kpi-total')).toHaveText(' / 1');
});

test('panel en el celular (375 px): sin desbordes, menú fijo con pendientes y acceso directo desde Inicio', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${DIA}T17:30:00-07:00`));
  await simularSupabase(page, { sitiosPA: 20, incidencias: [inc('otro')], eventos: [
    ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo', estado_revision: 'revisar', motivos_revision: ['sin_ubicacion'] })
  ] });
  await page.goto('index.html');
  await entrar(page, USUARIOS.coordinador);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.locator('#inicio-panel').click();
  await expect(page).toHaveURL(/panel\.html$/);
  await expect(page.locator('#menu-revisar')).toHaveText('1');
  await expect(page.locator('#menu-incidencias')).toHaveText('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.locator('.panel__menu a', { hasText: 'Incidencias' }).click();
  await expect(page.locator('#incidencias-titulo')).toBeInViewport();
  await expect(page.locator('.panel__menu')).toBeInViewport();   // el menú sigue a la vista al bajar
  await page.locator('.panel__menu a', { hasText: 'Reportes' }).click();
  await expect(page.locator('#reporte-ver')).toBeInViewport();
});

test('una persona asesora no ve el acceso al panel en Inicio', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${DIA}T10:00:00-07:00`));
  await simularSupabase(page, { sitiosPA: 20 });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(page.locator('#inicio-panel')).toBeHidden();
});
