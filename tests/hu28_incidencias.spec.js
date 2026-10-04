// HU-28/29 · Incidencias: el asesor solicita una corrección (sin borrar nada) y coordinación la aprueba o rechaza
// en panel.html. Al aprobar se agrega una checada con origen 'incidencia'; si era corrección de hora, la original deja de contar.
// Reloj: lunes 5-oct-2026, hora de Culiacán.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, senal, eventoServidor as ev, incidenciaServidor as inc, USUARIOS } from './simulador.js';

const DIA = '2026-10-05';
const ISO = (hhmm) => new Date(`${DIA}T${hhmm}:00-07:00`).toISOString();
const FIN_TARDE = ev('fin_bloque', `${DIA}T15:00`, { id: 'eeeeeeee-0000-0000-0000-0000000000f2', bloque: 'escritorio', modalidad: 'teletrabajo' });
const MANANA = [ev('inicio_bloque', `${DIA}T09:00`, { bloque: 'escritorio', modalidad: 'teletrabajo' }), FIN_TARDE];
const DIA_COMPLETO = [...MANANA, ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo' }), ev('fin_bloque', `${DIA}T20:00`, { bloque: 'campo' })];

async function abrirA(page, hora, { eventos = DIA_COMPLETO, incidencias = [], usuario = USUARIOS.asesor } = {}) {
  await page.clock.setFixedTime(new Date(`${DIA}T${hora}:00-07:00`));
  const sim = await simularSupabase(page, { sitiosPA: 20, eventos: eventos.map((e) => ({ ...e })), incidencias });
  await page.goto('index.html');
  await entrar(page, usuario);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  return sim;
}
const tipo = (page, valor) => page.locator(`input[name="correccion-tipo"][value="${valor}"]`);

test('olvidé checar: desde la jornada cerrada, con validaciones; queda "Pendiente" en Historial', async ({ page }) => {
  const sim = await abrirA(page, '21:00', { eventos: [...MANANA, ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo' })] });
  await page.locator('[data-pestana="perfil"]').click();
  await page.locator('#perfil-solicitar').click();
  await expect(page.locator('#pantalla-correccion')).toBeVisible();
  await page.locator('#correccion-enviar').click();
  await expect(page.locator('#correccion-error')).toHaveText('Elige qué pasó.');
  await tipo(page, 'omision').check();
  await expect(page.locator('#correccion-fecha')).toHaveValue(DIA);
  await expect(page.locator('#correccion-hora-etiqueta')).toHaveText('Hora en que debió quedar');
  await expect(page.locator('#correccion-original-campo')).toBeHidden();
  await page.locator('#correccion-enviar').click();
  await expect(page.locator('#correccion-error')).toHaveText('Elige la checada que faltó.');
  await page.locator('#correccion-checada').selectOption('fin_bloque:campo');
  await page.locator('#correccion-hora').fill('21:30');
  await page.locator('#correccion-motivo').fill('Se me descargó el teléfono');
  await page.locator('#correccion-enviar').click();
  await expect(page.locator('#correccion-error')).toHaveText('La hora no puede ser posterior a este momento.');
  await page.locator('#correccion-hora').fill('20:00');
  await page.locator('#correccion-motivo').fill('pila');
  await page.locator('#correccion-enviar').click();
  await expect(page.locator('#correccion-error')).toHaveText('Escribe el motivo (al menos 5 caracteres).');
  await page.locator('#correccion-motivo').fill('Se me descargó el teléfono');
  await page.locator('#correccion-enviar').click();
  await expect(page.locator('#correccion-resultado')).toBeVisible();
  expect(sim.estado.incidencias).toHaveLength(1);
  expect(sim.estado.incidencias[0]).toMatchObject({ tipo: 'omision', tipo_evento_propuesto: 'fin_bloque', bloque_propuesto: 'campo',
    hora_propuesta: ISO('20:00'), evento_original_id: null, motivo: 'Se me descargó el teléfono', estado: 'pendiente', miembro_id: 'aaaaaaaa-0000-0000-0000-000000000001' });
  await page.locator('#correccion-listo').click();
  await page.locator('[data-pestana="historial"]').click();
  const fila = page.locator('#solicitudes-lista .lista__fila').first();
  await expect(fila).toContainText('Olvidé checar · Fin de bloque de campo');
  await expect(fila).toContainText('lun 5 oct · 20:00 · Se me descargó el teléfono');
  await expect(fila).toContainText('Pendiente');
});

test('la hora quedó mal: elige la checada del día, se propone su hora y se envía la corrección', async ({ page }) => {
  const sim = await abrirA(page, '20:05');
  await expect(page.locator('#acciones-secundarias button', { hasText: 'Solicitar corrección' })).toBeEnabled();
  await page.locator('#acciones-secundarias button', { hasText: 'Solicitar corrección' }).click();
  await tipo(page, 'correccion_hora').check();
  const opciones = page.locator('#correccion-originales .opcion');
  await expect(opciones).toHaveCount(4);
  await expect(opciones.nth(1)).toContainText('Fin de bloque de escritorio');
  await expect(opciones.nth(1)).toContainText('15:00');
  await page.locator('#correccion-enviar').click();
  await expect(page.locator('#correccion-error')).toHaveText('Elige la checada que quieres corregir.');
  await opciones.nth(1).click();
  await expect(page.locator('#correccion-hora')).toHaveValue('15:00');
  await page.locator('#correccion-hora').fill('13:00');
  await page.locator('#correccion-motivo').fill('Terminé a las 13:00 y checé tarde');
  await page.locator('#correccion-enviar').click();
  await expect(page.locator('#correccion-resultado')).toBeVisible();
  expect(sim.estado.incidencias[0]).toMatchObject({ tipo: 'correccion_hora', evento_original_id: FIN_TARDE.id,
    tipo_evento_propuesto: 'fin_bloque', bloque_propuesto: 'escritorio', hora_propuesta: ISO('13:00') });
});

test('sin señal: no se envía y lo escrito se queda en la pantalla; al volver la señal se envía una sola vez', async ({ page, context }) => {
  const sim = await abrirA(page, '20:05');
  await page.locator('[data-pestana="historial"]').click();
  await expect(page.locator('#solicitudes-nota')).toHaveText('No has solicitado correcciones.');
  await page.locator('#historial-solicitar').click();
  await tipo(page, 'otro').check();
  await expect(page.locator('#correccion-fecha-campo')).toBeHidden();
  await page.locator('#correccion-motivo').fill('Aclaración ficticia de prueba');
  await senal(context, sim, false);
  await page.locator('#correccion-enviar').click();
  await expect(page.locator('#correccion-error')).toContainText('Sin señal: no se pudo enviar');
  await expect(page.locator('#correccion-motivo')).toHaveValue('Aclaración ficticia de prueba');
  await senal(context, sim, true);
  await page.locator('#correccion-enviar').click();
  await expect(page.locator('#correccion-resultado')).toBeVisible();
  expect(sim.estado.incidencias).toHaveLength(1);
  expect(sim.estado.incidencias[0]).toMatchObject({ tipo: 'otro', hora_propuesta: null, tipo_evento_propuesto: null });
});

test('corrección aprobada: la hora corregida reemplaza a la original en las horas del día; se ve el comentario', async ({ page }) => {
  const aprobada = inc('correccion_hora', { evento_original_id: FIN_TARDE.id, tipo_evento_propuesto: 'fin_bloque', bloque_propuesto: 'escritorio',
    hora: `${DIA}T13:00`, estado: 'aprobada', comentario_resolucion: 'Confirmado con la bitácora del comité', resuelta_en: ISO('20:30') });
  const corregido = ev('fin_bloque', `${DIA}T13:00`, { bloque: 'escritorio', modalidad: 'teletrabajo', origen: 'incidencia', incidencia_id: aprobada.id });
  await abrirA(page, '14:00', { eventos: [...MANANA, corregido], incidencias: [aprobada] });
  await expect(page.locator('#horas-hoy')).toHaveText('4:00');   // 9:00–13:00 (sin la corrección serían 6:00)
  await expect(page.locator('#lista-bloques .lista__fila').first()).toContainText('09:00 – 13:00');
  await page.locator('[data-pestana="historial"]').click();
  const fila = page.locator('#solicitudes-lista .lista__fila').first();
  await expect(fila).toContainText('Aprobada');
  await expect(fila).toContainText('Coordinación: Confirmado con la bitácora del comité');
  await expect(page.locator(`#semana-dias [data-fecha="${DIA}"]`)).toContainText('4:00');
});

test('panel: coordinación rechaza (exige comentario) y aprueba; al aprobar se agrega la checada corregida', async ({ page }) => {
  const omision = inc('omision', { tipo_evento_propuesto: 'fin_bloque', bloque_propuesto: 'campo', hora: `${DIA}T20:00`, motivo: 'Se me descargó el teléfono', creada_en: '2026-10-05T03:00:00.000Z' });
  const fuera = inc('fuera_geocerca', { evento_original_id: FIN_TARDE.id, motivo: 'Estaba en la explanada del parque', creada_en: '2026-10-05T04:00:00.000Z' });
  const propia = inc('otro', { miembro_id: 'aaaaaaaa-0000-0000-0000-000000000002', motivo: 'Solicitud de la propia coordinación', creada_en: '2026-10-05T05:00:00.000Z' });
  const sim = await abrirA(page, '21:00', { usuario: USUARIOS.coordinador, eventos: [...MANANA, ev('inicio_bloque', `${DIA}T16:00`, { bloque: 'campo' })], incidencias: [omision, fuera, propia] });
  await page.locator('[data-pestana="perfil"]').click();
  await page.locator('#perfil-panel').click();
  await expect(page).toHaveURL(/panel\.html$/);
  await expect(page.locator('#panel-org')).toHaveText('Parques Alegres IAP');
  await expect(page.locator('#contador-pendientes')).toHaveText('(3)');
  const tarjetas = page.locator('#incidencias-lista .incidencia');
  await expect(tarjetas).toHaveCount(3);
  const tOmision = tarjetas.nth(0);
  await expect(tOmision).toContainText('Asesor de Prueba');
  await expect(tOmision).toContainText('Olvidé checar');
  await expect(tOmision).toContainText('Agregar: Fin de bloque de campo · lun 5 oct · 20:00');
  const tFuera = tarjetas.nth(1);
  await expect(tFuera).toContainText('Checada original: Fin de bloque de escritorio · lun 5 oct · 15:00');
  // La propia no se puede resolver
  await expect(tarjetas.nth(2)).toContainText('Es tu solicitud: la resuelve otra persona de coordinación.');
  await expect(tarjetas.nth(2).locator('[data-resolver]')).toHaveCount(0);

  // Rechazar sin comentario: no deja
  await tFuera.locator('[data-resolver="rechazada"]').click();
  await expect(tFuera.locator('.aviso')).toHaveText('Para rechazar, escribe el motivo (al menos 5 caracteres).');
  await tFuera.locator('textarea').fill('La ubicación está a 600 m del parque');
  page.once('dialog', (d) => d.accept());
  await tFuera.locator('[data-resolver="rechazada"]').click();
  await expect(page.locator('#panel-aviso')).toHaveText('Incidencia de Asesor de Prueba rechazada.');
  await expect(page.locator('#contador-pendientes')).toHaveText('(2)');

  // Aprobar: se cancela el primer diálogo y no pasa nada; al aceptar se agrega la checada
  page.once('dialog', (d) => d.dismiss());
  await tarjetas.nth(0).locator('[data-resolver="aprobada"]').click();
  expect(sim.estado.incidencias.find((i) => i.id === omision.id).estado).toBe('pendiente');
  let pregunta = '';
  page.once('dialog', async (d) => { pregunta = d.message(); await d.accept(); });
  await tarjetas.nth(0).locator('[data-resolver="aprobada"]').click();
  await expect(page.locator('#panel-aviso')).toHaveText('Incidencia de Asesor de Prueba aprobada: se agregó la checada corregida.');
  expect(pregunta).toContain('Se agregará la checada corregida');
  await expect(page.locator('#contador-pendientes')).toHaveText('(1)');
  expect(sim.estado.incidencias.find((i) => i.id === omision.id)).toMatchObject({ estado: 'aprobada', resuelta_por: 'aaaaaaaa-0000-0000-0000-000000000002' });

  // Resueltas
  await page.locator('#filtro-resueltas').click();
  await expect(tarjetas).toHaveCount(2);
  await expect(page.locator('#incidencias-lista')).toContainText('Comentario: La ubicación está a 600 m del parque');
  await expect(page.locator('#incidencias-lista')).toContainText('Resolvió: Coordinación de Prueba');
});

test('panel: una persona asesora no tiene acceso; en la app no ve el enlace al panel', async ({ page }) => {
  await abrirA(page, '10:00');
  await page.locator('[data-pestana="perfil"]').click();
  await expect(page.locator('#perfil-panel')).toBeHidden();
  await page.goto('panel.html');
  await expect(page.locator('#panel-sin-acceso')).toBeVisible();
  await expect(page.locator('#panel-sin-acceso-texto')).toHaveText('Esta página es solo para coordinación.');
  await expect(page.locator('#panel')).toBeHidden();
});

test('contra la API local (PostgREST + triggers reales): solicitar, aprobar en el panel y la vista oficial cambia', async ({ page, context }) => {
  const { apiLocalDisponible, conectarApiLocal, CUENTAS } = await import('./api_local.js');
  test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
  // IAP Demo (para no alterar las horas de Parques Alegres que leen otras pruebas): campo del jueves 1-oct.
  await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, CUENTAS.asesorDemo);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.locator('[data-pestana="historial"]').click();
  await page.locator('#historial-solicitar').click();
  await tipo(page, 'correccion_hora').check();
  await page.locator('#correccion-fecha').fill('2026-10-01');
  await page.locator('#correccion-fecha').dispatchEvent('change');
  // El fin vigente (el original o el de una corrección aprobada en una corrida anterior) se adelanta 5 minutos
  const fin = page.locator('#correccion-originales .opcion', { hasText: 'Fin de bloque de campo' }).last();
  await fin.click();
  const actual = await page.locator('#correccion-hora').inputValue();
  const [h, m] = actual.split(':').map(Number);
  const nueva = `${String(Math.floor((h * 60 + m - 5) / 60)).padStart(2, '0')}:${String((h * 60 + m - 5) % 60).padStart(2, '0')}`;
  await page.locator('#correccion-hora').fill(nueva);
  await page.locator('#correccion-motivo').fill('Prueba e2e: terminé 5 minutos antes');
  await page.locator('#correccion-enviar').click();
  await expect(page.locator('#correccion-resultado')).toBeVisible();
  await page.locator('#correccion-listo').click();
  await expect(page.locator('#solicitudes-lista .lista__fila').first()).toContainText('Pendiente');
  const minutos = () => page.evaluate(async () => {
    const { cliente } = await import('./js/api.js');
    return (await cliente.from('v_jornada_diaria').select('minutos_efectivos').eq('fecha', '2026-10-01')).data[0].minutos_efectivos;
  });
  const antes = await minutos();

  // Admin de IAP Demo aprueba desde el panel
  await page.locator('[data-pestana="perfil"]').click();
  await page.locator('#perfil-salir').click();
  await entrar(page, CUENTAS.adminDemo);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.goto('panel.html');
  const tarjeta = page.locator('#incidencias-lista .incidencia', { hasText: 'Prueba e2e: terminé 5 minutos antes' }).first();
  await expect(tarjeta).toContainText('Asesor Demo');
  await expect(tarjeta).toContainText(`Corregir a: Fin de bloque de campo · jue 1 oct · ${nueva}`);
  page.once('dialog', (d) => d.accept());
  await tarjeta.locator('[data-resolver="aprobada"]').click();
  await expect(page.locator('#panel-aviso')).toContainText('aprobada: se agregó la checada corregida');

  // De vuelta como asesor: la vista oficial ya usa la hora corregida
  await page.goto('index.html');
  await page.locator('[data-pestana="perfil"]').click();
  await page.locator('#perfil-salir').click();
  await entrar(page, CUENTAS.asesorDemo);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  expect(await minutos()).toBe(antes - 5);
  await page.locator('[data-pestana="historial"]').click();
  await expect(page.locator('#solicitudes-lista .lista__fila').first()).toContainText('Aprobada');
});
