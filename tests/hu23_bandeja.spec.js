// HU-23 · Bandeja de revisión: checadas "revisar" con motivos, lugar, justificación y selfie (enlace temporal de 60 s);
// coordinación valida u observa (migración 0004) sin tocar la checada. Reloj: lunes 5-oct-2026. Datos ficticios.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, eventoServidor as ev, incidenciaServidor as inc, USUARIOS } from './simulador.js';
import { armarBandeja } from '../js/bandeja.js';

const DIA = '2026-10-05';
const P1 = 'ffffffff-0000-0000-0000-000000000001';
const FUERA = ev('inicio_bloque', `${DIA}T16:02`, { id: 'eeeeeeee-0000-0000-0000-0000000000a1', bloque: 'campo', sitio_id: P1, distancia_sitio_m: 182.4, precision_m: 12,
  dentro_geocerca: false, estado_revision: 'revisar', motivos_revision: ['fuera_de_geocerca'], justificacion: 'Reunión con el comité en la explanada',
  selfie_path: '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/2026/10/eeeeeeee-0000-0000-0000-0000000000a1.webp' });
const SIN_UBICACION = ev('fin_bloque', `${DIA}T20:01`, { id: 'eeeeeeee-0000-0000-0000-0000000000a2', bloque: 'campo', dentro_geocerca: false,
  estado_revision: 'revisar', motivos_revision: ['sin_ubicacion', 'sin_selfie'], capturado_sin_conexion: true });
const PROPIA = ev('inicio_bloque', `${DIA}T09:00`, { id: 'eeeeeeee-0000-0000-0000-0000000000a3', miembro_id: 'aaaaaaaa-0000-0000-0000-000000000002', bloque: 'campo',
  estado_revision: 'revisar', motivos_revision: ['sin_ubicacion'] });
const OK = ev('inicio_bloque', `${DIA}T09:00`, { bloque: 'escritorio' });

test('armado de la bandeja: revisión o incidencia aprobada la sacan de "por revisar"', () => {
  const e = (id) => ({ id });
  const b = armarBandeja({
    eventos: [e('a'), e('b'), e('c'), e('d')],
    revisiones: [{ evento_id: 'a', decision: 'validada' }],
    incidencias: [{ evento_original_id: 'b', tipo: 'fuera_geocerca', estado: 'aprobada' }, { evento_original_id: 'c', tipo: 'correccion_hora', estado: 'pendiente' },
      { evento_original_id: 'd', tipo: 'otro', estado: 'aprobada' }]
  });
  expect(b.porRevisar.map((x) => [x.evento.id, x.incidenciaPendiente])).toEqual([['c', true], ['d', false]]);
  expect(b.revisadas.map((x) => x.evento.id)).toEqual(['a', 'b']);
});

async function abrirPanel(page, { eventos = [FUERA, SIN_UBICACION, PROPIA, OK], incidencias = [], revisiones = [] } = {}) {
  await page.clock.setFixedTime(new Date(`${DIA}T21:00:00-07:00`));
  const sim = await simularSupabase(page, { sitiosPA: 20, eventos: eventos.map((x) => ({ ...x })), incidencias, revisiones });
  await page.goto('index.html');
  await entrar(page, USUARIOS.coordinador);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.goto('panel.html');
  await expect(page.locator('#panel')).toBeVisible();
  return sim;
}
const tarjetas = (page) => page.locator('#bandeja-lista .incidencia');
const tarjeta = (page, id) => page.locator(`#bandeja-lista [data-evento="${id}"]`);

test('bandeja: motivos, lugar, justificación y selfie con enlace temporal', async ({ page }) => {
  const sim = await abrirPanel(page);
  await expect(page.locator('#contador-revisar')).toHaveText('(3)');
  await expect(tarjetas(page)).toHaveCount(3);
  const t = tarjeta(page, FUERA.id);
  await expect(t).toContainText('Asesor de Prueba');
  await expect(t).toContainText('Fuera de zona');
  await expect(t).toContainText('Checada: Inicio de bloque de campo · lun 5 oct · 16:02');
  await expect(t).toContainText('Lugar: Parque Ficticio 001 · a 182 m · precisión estimada ±12 m');
  await expect(t).toContainText('Justificación: Reunión con el comité en la explanada');
  await t.locator('[data-selfie]').click();
  await expect(t.locator('img.revision__selfie')).toBeVisible();
  expect(await t.locator('img.revision__selfie').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  expect(sim.estado.firmadas).toEqual([FUERA.selfie_path]);
  const s = tarjeta(page, SIN_UBICACION.id);
  await expect(s).toContainText('Sin ubicación');
  await expect(s).toContainText('Sin selfie');
  await expect(s).toContainText('Lugar: Sin ubicación');
  await expect(s).toContainText('sin conexión (hora del teléfono)');
  await expect(s).toContainText('Selfie: no se tomó');
  // La propia no se puede revisar
  await expect(tarjeta(page, PROPIA.id)).toContainText('Es tu checada: la revisa otra persona de coordinación.');
  await expect(tarjeta(page, PROPIA.id).locator('[data-revisar]')).toHaveCount(0);
});

test('bandeja: validar y observar (exige comentario); pasan a "Revisadas" con quién y cuándo', async ({ page }) => {
  const sim = await abrirPanel(page);
  await tarjeta(page, SIN_UBICACION.id).locator('[data-revisar="observada"]').click();
  await expect(tarjeta(page, SIN_UBICACION.id).locator('.aviso')).toHaveText('Para observar, escribe el motivo (al menos 5 caracteres).');
  await tarjeta(page, SIN_UBICACION.id).locator('textarea').fill('Sin ubicación ni selfie al cerrar el campo');
  await tarjeta(page, SIN_UBICACION.id).locator('[data-revisar="observada"]').click();
  await expect(page.locator('#panel-aviso')).toHaveText('Checada de Asesor de Prueba observada.');
  await tarjeta(page, FUERA.id).locator('[data-revisar="validada"]').click();
  await expect(page.locator('#contador-revisar')).toHaveText('(1)');
  expect(sim.estado.revisiones.map((r) => [r.evento_id, r.decision, r.revisado_por])).toEqual([
    [SIN_UBICACION.id, 'observada', 'aaaaaaaa-0000-0000-0000-000000000002'], [FUERA.id, 'validada', 'aaaaaaaa-0000-0000-0000-000000000002']]);
  // Las checadas no cambian
  expect(sim.estado.recibidos).toHaveLength(0);
  await page.locator('#bandeja-revisadas').click();
  await expect(tarjetas(page)).toHaveCount(2);
  await expect(tarjeta(page, SIN_UBICACION.id)).toContainText('Observada');
  await expect(tarjeta(page, SIN_UBICACION.id)).toContainText('Comentario: Sin ubicación ni selfie al cerrar el campo');
  await expect(tarjeta(page, FUERA.id)).toContainText('Validada');
  await expect(tarjeta(page, FUERA.id)).toContainText('Revisó: Coordinación de Prueba');
});

test('bandeja: una incidencia aprobada de "fuera de zona" la aclara; una pendiente se señala', async ({ page }) => {
  await abrirPanel(page, { incidencias: [
    inc('fuera_geocerca', { evento_original_id: FUERA.id, estado: 'aprobada' }),
    inc('correccion_hora', { evento_original_id: SIN_UBICACION.id, tipo_evento_propuesto: 'fin_bloque', bloque_propuesto: 'campo', hora: `${DIA}T20:00` })
  ] });
  await expect(page.locator('#contador-revisar')).toHaveText('(2)');
  await expect(tarjeta(page, SIN_UBICACION.id)).toContainText('la persona pidió una corrección de esta checada');
  await page.locator('#bandeja-revisadas').click();
  await expect(tarjeta(page, FUERA.id)).toContainText('Aclarada por incidencia');
  await expect(tarjeta(page, FUERA.id).locator('[data-revisar]')).toHaveCount(0);
});

test('contra la API local (trigger y RLS reales): coordinación valida una checada sin ubicación', async ({ page }) => {
  const { apiLocalDisponible, conectarApiLocal, CUENTAS } = await import('./api_local.js');
  test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
  await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, CUENTAS.asesorPA);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  // El asesor registra una checada sin ubicación (el servidor la marca "revisar")
  const id = await page.evaluate(async () => {
    const { cliente } = await import('./js/api.js');
    const r = await cliente.from('eventos_jornada').insert({ id: crypto.randomUUID(), miembro_id: 'aaaaaaaa-0000-0000-0000-000000000001', tipo: 'llegada_sitio', hora_dispositivo: new Date().toISOString() }).select('id, estado_revision');
    if (r.error) throw new Error(r.error.message);
    return r.data[0];
  });
  expect(id.estado_revision).toBe('revisar');
  // El asesor no puede revisarla
  const rechazo = await page.evaluate(async (eventoId) => {
    const { cliente } = await import('./js/api.js');
    const { error } = await cliente.from('revisiones').insert({ evento_id: eventoId, decision: 'validada' });
    return error?.message || null;
  }, id.id);
  expect(rechazo).toContain('Solo coordinación');
  await page.locator('[data-pestana="perfil"]').click();
  await page.locator('#perfil-salir').click();
  await entrar(page, CUENTAS.coordPA);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.goto('panel.html');
  const t = page.locator(`#bandeja-lista [data-evento="${id.id}"]`);
  await expect(t).toContainText('Sin ubicación');
  await expect(t).toContainText('Llegada a parque');
  await t.locator('textarea').fill('Confirmado por teléfono con el asesor');
  await t.locator('[data-revisar="validada"]').click();
  await expect(page.locator('#panel-aviso')).toContainText('validada');
  await page.locator('#bandeja-revisadas').click();
  await expect(page.locator(`#bandeja-lista [data-evento="${id.id}"]`)).toContainText('Revisó: Coordinación de Prueba');
});
