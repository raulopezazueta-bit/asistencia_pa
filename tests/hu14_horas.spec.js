// HU-14 · Mis horas: horas del día y de la semana desde v_jornada_diaria + checadas aún en el teléfono.
// Reloj: miércoles 7-oct-2026 18:00 (Culiacán); semana del lunes 5 al domingo 11.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, senal, tomarSelfie, eventoServidor as ev, USUARIOS } from './simulador.js';
import { apiLocalDisponible, conectarApiLocal, CUENTAS } from './api_local.js';
import { diasDeLaSemana } from '../js/reglas.js';

const SEMANA = [
  // lunes 5: jornada completa con comida entre bloques (no resta) → 8:00
  ev('inicio_bloque', '2026-10-05T09:00', { bloque: 'escritorio', modalidad: 'teletrabajo' }), ev('fin_bloque', '2026-10-05T13:00', { bloque: 'escritorio' }),
  ev('inicio_pausa', '2026-10-05T13:00'), ev('fin_pausa', '2026-10-05T14:00'),
  ev('inicio_bloque', '2026-10-05T16:00', { bloque: 'campo' }), ev('fin_bloque', '2026-10-05T20:00', { bloque: 'campo' }),
  // martes 6: escritorio completo; campo quedó sin cerrar → 4:00 y "Sin cerrar"
  ev('inicio_bloque', '2026-10-06T09:00', { bloque: 'escritorio', modalidad: 'teletrabajo' }), ev('fin_bloque', '2026-10-06T13:00', { bloque: 'escritorio' }),
  ev('inicio_bloque', '2026-10-06T16:00', { bloque: 'campo', id: 'eeeeeeee-0000-0000-0000-00000000c006' }),
  // miércoles 7 (hoy): escritorio completo y campo en curso desde las 16:00 → 4:00 + 2:00
  ev('inicio_bloque', '2026-10-07T09:00', { bloque: 'escritorio', modalidad: 'teletrabajo' }), ev('fin_bloque', '2026-10-07T13:00', { bloque: 'escritorio' }),
  ev('inicio_bloque', '2026-10-07T16:00', { bloque: 'campo' })
];

async function abrir(page, context, opciones = {}) {
  await page.clock.setFixedTime(new Date('2026-10-07T18:00:00-07:00'));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 24.7601, longitude: -107.4301, accuracy: 8 });
  const sim = await simularSupabase(page, { sitiosPA: 20, eventos: SEMANA.map((e) => ({ ...e })), ...opciones });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  return sim;
}
const dia = (page, fecha) => page.locator(`#semana-dias [data-fecha="${fecha}"]`);

test('días de la semana: de lunes a domingo en la zona de la organización', () => {
  expect(diasDeLaSemana(new Date('2026-10-07T18:00:00-07:00'), 'America/Mazatlan')).toEqual(
    ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  // domingo 23:30 en Culiacán (lunes en UTC): sigue siendo la misma semana
  expect(diasDeLaSemana(new Date('2026-10-12T06:30:00Z'), 'America/Mazatlan')[6]).toBe('2026-10-11');
});

test('semana: horas por día, total, día sin cerrar y días futuros', async ({ page, context }) => {
  await abrir(page, context);
  await expect(page.locator('#semana-resumen')).toHaveText('Esta semana: 18:00 h de 56:00 h');
  await page.locator('[data-pestana="historial"]').click();
  await expect(page.locator('#semana-total')).toHaveText('18:00');
  await expect(page.locator('#semana-rango')).toHaveText('5 oct – 11 oct');
  await expect(dia(page, '2026-10-05').locator('.dia__horas')).toHaveText('8:00');
  await expect(dia(page, '2026-10-06').locator('.dia__horas')).toHaveText('4:00');
  await expect(dia(page, '2026-10-06')).toContainText('Sin cerrar');
  await expect(dia(page, '2026-10-07')).toContainText('Hoy');
  await expect(dia(page, '2026-10-07').locator('.dia__horas')).toHaveText('6:00');     // campo en curso cuenta hasta ahora
  await expect(dia(page, '2026-10-08').locator('.dia__horas')).toHaveText('—');
  await expect(page.locator('#semana-nota')).toContainText('"Sin cerrar"');
});

test('checadas aún en el teléfono suman y se marcan "por enviar" (también en días pasados)', async ({ page, context }) => {
  const sim = await abrir(page, context);
  // Una salida del martes que quedó guardada en el teléfono sin enviar
  await page.evaluate(async () => {
    const a = await import('./js/almacen.js');
    const evento = { id: 'f1f1f1f1-0000-0000-0000-000000000001', miembro_id: 'aaaaaaaa-0000-0000-0000-000000000001', tipo: 'fin_bloque',
      bloque: 'campo', modalidad: 'presencial', hora_dispositivo: '2026-10-07T03:00:00.000Z', capturado_sin_conexion: true };   // martes 20:00 local
    await a.guardar('eventos_locales', { id: evento.id, miembroId: evento.miembro_id, evento, enviado: false, creadoEn: evento.hora_dispositivo });
  });
  // Y la salida de hoy, sin señal
  await senal(context, sim, false);
  await page.locator('#boton-principal').click();
  await tomarSelfie(page);
  await page.locator('#checada-confirmar').click();
  await expect(page.locator('#checada-resultado:visible #checada-resultado-titulo')).toHaveText('Guardado en el teléfono');
  await page.locator('#checada-listo').click();

  await page.locator('[data-pestana="historial"]').click();
  await expect(dia(page, '2026-10-06').locator('.dia__horas')).toHaveText('8:00');      // 4:00 + campo 16–20 cerrado en el teléfono
  await expect(dia(page, '2026-10-06')).toContainText('Por enviar');
  await expect(dia(page, '2026-10-06')).not.toContainText('Sin cerrar');
  await expect(dia(page, '2026-10-07')).toContainText('Por enviar');
  await expect(dia(page, '2026-10-07').locator('.dia__horas')).toHaveText('6:00');
  await expect(page.locator('#semana-total')).toHaveText('22:00');
  await expect(page.locator('#semana-nota')).toContainText('"Por enviar"');
  await expect(page.locator('#semana-nota')).toContainText('Sin señal');
});

test('sin señal al abrir: se usa la última semana guardada', async ({ page, context }) => {
  const sim = await abrir(page, context);
  await page.locator('[data-pestana="historial"]').click();
  await expect(page.locator('#semana-total')).toHaveText('18:00');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await senal(context, sim, false);
  await page.reload();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(page.locator('#semana-total')).toHaveText('18:00');
  await expect(dia(page, '2026-10-05').locator('.dia__horas')).toHaveText('8:00');
});

test('contra la API local: los días pasados salen de la vista oficial v_jornada_diaria', async ({ page }) => {
  test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
  // En datos_ficticios.sql el asesor de PA tiene campo el jueves 1-oct de 16:00 a 20:00. Hoy: viernes 2-oct.
  await page.clock.setFixedTime(new Date('2026-10-02T10:00:00-07:00'));
  await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, CUENTAS.asesorPA);
  await page.locator('[data-pestana="historial"]').click();
  await expect(dia(page, '2026-10-01').locator('.dia__horas')).toHaveText('4:00');
  await expect(page.locator('#semana-total')).toHaveText('4:00');
  await expect(page.locator('#semana-rango')).toHaveText('28 sep – 4 oct');
});
