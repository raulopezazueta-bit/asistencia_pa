// HU-33 · Inalterabilidad verificada: con la llave pública nadie puede editar ni borrar registros
// (eventos, bitácora, incidencias, miembros, sitios), y la interfaz no ofrece editar ni borrar.
// Contra la API local (PostgREST + migraciones reales): `npm run prueba:completa`.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { simularSupabase, entrar, USUARIOS } from './simulador.js';
import { apiLocalDisponible, conectarApiLocal, CUENTAS, API_LOCAL } from './api_local.js';

const EVENTO_PA = 'cccccccc-0000-0000-0000-000000000001';   // del asesor de PA (datos_ficticios.sql)

// Ejecuta en la página, con el cliente de Supabase de la app y la sesión de `cuenta`, todos los intentos de alteración.
async function intentarAlterar(page, cuenta) {
  await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, cuenta);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  return page.evaluate(async (ID) => {
    const { cliente } = await import('./js/api.js');
    const antes = (await cliente.from('eventos_jornada').select('*').eq('id', ID)).data[0] ?? null;
    const r = {};
    const fallo = (x) => ({ error: x.error ? `${x.error.code} ${x.error.message}` : null, filas: x.data?.length ?? null });
    r.update = fallo(await cliente.from('eventos_jornada').update({ lat: 0, lon: 0 }).eq('id', ID).select());
    r.delete = fallo(await cliente.from('eventos_jornada').delete().eq('id', ID).select());
    // Trampa: upsert que intenta SOBRESCRIBIR (on conflict do update) un evento existente
    r.upsertSobrescribe = fallo(await cliente.from('eventos_jornada')
      .upsert({ id: ID, miembro_id: antes?.miembro_id ?? 'aaaaaaaa-0000-0000-0000-000000000001', tipo: 'inicio_bloque', bloque: 'campo', hora_dispositivo: '2020-01-01T00:00:00Z' }, { onConflict: 'id' })
      .select());
    r.insertDuplicado = fallo(await cliente.from('eventos_jornada')
      .insert({ id: ID, miembro_id: antes?.miembro_id ?? 'aaaaaaaa-0000-0000-0000-000000000001', tipo: 'inicio_bloque', bloque: 'campo', hora_dispositivo: '2020-01-01T00:00:00Z' }));
    r.bitacoraInsert = fallo(await cliente.from('bitacora').insert({ tabla: 'x', registro_id: 'x', accion: 'x' }).select());
    r.bitacoraUpdate = fallo(await cliente.from('bitacora').update({ accion: 'alterada' }).gte('id', 0).select());
    r.bitacoraDelete = fallo(await cliente.from('bitacora').delete().gte('id', 0).select());
    r.incidenciaDelete = fallo(await cliente.from('incidencias').delete().not('id', 'is', null).select());
    r.miembroDelete = fallo(await cliente.from('miembros').delete().not('id', 'is', null).select());
    r.sitioDelete = fallo(await cliente.from('sitios').delete().not('id', 'is', null).select());
    const despues = (await cliente.from('eventos_jornada').select('*').eq('id', ID)).data[0] ?? null;
    return { r, antes, despues };
  }, EVENTO_PA);
}

function todoRechazado({ r }) {
  // Cada intento falla con error, o (si RLS lo filtra) no toca ni una fila. Nunca "éxito con filas".
  for (const [intento, x] of Object.entries(r)) {
    expect(x.error !== null || x.filas === 0, `${intento}: ${JSON.stringify(x)}`).toBe(true);
  }
  // Los de eventos deben fallar con error explícito, no silenciosamente
  for (const k of ['update', 'delete', 'upsertSobrescribe', 'insertDuplicado']) expect(r[k].error, k).not.toBeNull();
}

test.describe('contra la API local', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
  });

  test('asesoría: no puede editar ni borrar su propio evento (ni sobrescribirlo con upsert)', async ({ page }) => {
    const res = await intentarAlterar(page, CUENTAS.asesorPA);
    todoRechazado(res);
    expect(res.r.update.error).toMatch(/42501/);                 // permiso negado
    expect(res.r.insertDuplicado.error).toMatch(/23505/);        // llave duplicada
    expect(res.antes).not.toBeNull();
    expect(res.despues).toEqual(res.antes);                      // intacto, campo por campo
  });

  test('coordinación: tampoco puede editar ni borrar eventos de su equipo', async ({ page }) => {
    const res = await intentarAlterar(page, CUENTAS.coordPA);
    todoRechazado(res);
    expect(res.despues).toEqual(res.antes);
  });

  test('administración (otra organización): tampoco, y no ve el evento', async ({ page }) => {
    const res = await intentarAlterar(page, CUENTAS.adminDemo);
    todoRechazado(res);
    expect(res.antes).toBeNull();
  });

  test('sin sesión (solo la llave pública): no puede leer, insertar, editar ni borrar eventos', async () => {
    const pedir = (metodo, ruta, cuerpo) => fetch(`${API_LOCAL}${ruta}`, { method: metodo,
      headers: { 'content-type': 'application/json', prefer: 'return=representation' }, body: cuerpo && JSON.stringify(cuerpo) });
    const leer = await pedir('GET', `/eventos_jornada?id=eq.${EVENTO_PA}`);
    const editar = await pedir('PATCH', `/eventos_jornada?id=eq.${EVENTO_PA}`, { lat: 0 });
    const borrar = await pedir('DELETE', `/eventos_jornada?id=eq.${EVENTO_PA}`);
    const insertar = await pedir('POST', '/eventos_jornada', { id: crypto.randomUUID(), miembro_id: 'aaaaaaaa-0000-0000-0000-000000000001', tipo: 'inicio_bloque', bloque: 'campo', hora_dispositivo: new Date().toISOString() });
    for (const [nombre, resp] of Object.entries({ leer, editar, borrar, insertar })) {
      expect([401, 403], `${nombre}: ${resp.status}`).toContain(resp.status);
    }
  });
});

test('la interfaz no ofrece editar ni borrar en ninguna pantalla', async ({ page, context }) => {
  await page.clock.setFixedTime(new Date('2026-10-05T16:00:00-07:00'));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 24.7601, longitude: -107.4301, accuracy: 8 });
  await simularSupabase(page, { sitiosPA: 20 });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  const prohibido = /editar|borrar|eliminar|modificar|corregir hora|cambiar hora/i;
  const controles = async () => page.evaluate(() =>
    [...document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')]
      .filter((el) => el.offsetParent !== null).map((el) => el.textContent.trim() || el.value || el.getAttribute('aria-label') || ''));
  const vistos = [];
  for (const pestana of ['inicio', 'visitas', 'historial', 'perfil']) {
    await page.locator(`[data-pestana="${pestana}"]`).click();
    vistos.push(...(await controles()));
  }
  await page.locator('[data-pestana="inicio"]').click();
  await page.locator('#boton-principal').click();                 // pantalla de checada
  await expect(page.locator('#checada-titulo')).toBeVisible();
  vistos.push(...(await controles()));
  expect(vistos.length).toBeGreaterThan(8);
  expect(vistos.filter((t) => prohibido.test(t))).toEqual([]);
});

test('el código de la app nunca pide editar ni borrar en el servidor', () => {
  const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
  const api = leer('js/api.js');
  // Única puerta a Supabase: sin delete/remove, y todo upsert es "sin sobrescribir".
  expect(api).not.toMatch(/\.delete\(|\.remove\(/);
  const ediciones = api.match(/\.from\('[a-z_]+'\)\s*\.update\(\{[^}]*\}/g) || [];
  expect(api.match(/\.update\(/g) || []).toHaveLength(ediciones.length);
  // Ediciones permitidas: resolver una incidencia; el rol de una persona y cerrar la vigencia de un horario (HU-09, solo
  // administración por RLS). Nunca eventos, bitácora, revisiones ni selfies.
  expect(ediciones).toEqual([
    ".from('incidencias')\n    .update({ estado, comentario_resolucion: comentario || null }",
    ".from('miembros')\n    .update({ rol }",
    ".from('horarios')\n    .update({ vigente_hasta: ayer }"
  ]);
  const upserts = api.match(/\.upsert\([^;]*?\)/gs) || [];
  expect(upserts.length).toBeGreaterThan(0);
  for (const u of upserts) expect(u).toContain('ignoreDuplicates: true');
  expect(api).toMatch(/upload\([^)]*upsert: false/);              // las selfies nunca se reemplazan
  // Ningún otro módulo habla con Supabase directamente
  for (const m of ['app', 'cola', 'checada', 'jornada', 'sitios', 'sesion', 'camara', 'geo', 'reglas', 'reloj', 'almacen', 'horas', 'incidencias', 'correccion', 'panel', 'tablero', 'bandeja', 'reporte', 'reporte_datos', 'reporte_pagina', 'recordatorio', 'personas', 'horario_semanal', 'instalar', 'nomina']) {
    expect(leer(`js/${m}.js`), m).not.toMatch(/supabase\.|cliente\.from|\.storage\./);
  }
  // El envío en segundo plano del service worker solo usa POST con "ignore-duplicates"
  const sw = leer('sw.js');
  expect(sw).not.toMatch(/method:\s*'(PATCH|PUT|DELETE)'/);
  expect(sw).toContain("prefer: 'resolution=ignore-duplicates");
  expect(sw).toContain("'x-upsert': 'false'");
});
