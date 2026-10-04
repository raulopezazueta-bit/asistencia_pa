// HU-07 · Separación entre organizaciones, de punta a punta: la app real → PostgREST → RLS de la migración 0001.
// Requiere la API local: `bash supabase/tests/e2e/levantar_api_local.sh` (o `npm run prueba:separacion`).
import { test, expect } from '@playwright/test';
import { entrar } from './simulador.js';
import { apiLocalDisponible, conectarApiLocal, CUENTAS, ID } from './api_local.js';

test.beforeAll(async () => {
  test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
});

async function entrarCon(page, cuenta, organizacionEsperada) {
  await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, cuenta);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(page.locator('#org-nombre')).toHaveText(organizacionEsperada);
}

// Lee cada tabla y vista con el mismo cliente de Supabase que usa la app (ya con la sesión iniciada).
function leerTodo(page) {
  return page.evaluate(async () => {
    const { cliente } = await import('./js/api.js');
    const out = {};
    const tablas = ['miembros', 'sitios', 'v_sitios_app', 'horarios', 'eventos_jornada', 'incidencias', 'bitacora', 'v_jornada_diaria'];
    const { data: orgs, error: e0 } = await cliente.from('organizaciones').select('id');
    out.organizaciones = e0 ? { error: e0.message } : orgs.map((r) => r.id);
    for (const t of tablas) {
      const { data, error } = await cliente.from(t).select('organizacion_id');
      out[t] = error ? { error: error.message } : data.map((r) => r.organizacion_id);
    }
    return out;
  });
}

test('asesor de iap-demo: la app solo le muestra su organización', async ({ page }) => {
  await entrarCon(page, CUENTAS.asesorDemo, 'IAP Demo');
  await expect(page.locator('#pantalla-organizacion')).toBeHidden();
});

test('asesor de iap-demo no ve ninguna fila de parques-alegres en ninguna tabla ni vista', async ({ page }) => {
  await entrarCon(page, CUENTAS.asesorDemo, 'IAP Demo');
  const vistos = await leerTodo(page);
  for (const [tabla, orgs] of Object.entries(vistos)) {
    expect(Array.isArray(orgs), `${tabla}: ${JSON.stringify(orgs)}`).toBe(true);
    expect(orgs.filter((o) => o === ID.orgPA), `${tabla} expone datos de parques-alegres`).toEqual([]);
  }
  // Para que la prueba no pase "en vacío": sí ve lo suyo.
  for (const t of ['organizaciones', 'miembros', 'sitios', 'v_sitios_app', 'horarios', 'eventos_jornada', 'incidencias', 'v_jornada_diaria']) {
    expect(vistos[t].length, `${t} debería tener datos de iap-demo`).toBeGreaterThan(0);
  }
});

test('pedir directamente datos de parques-alegres por su id devuelve vacío', async ({ page }) => {
  await entrarCon(page, CUENTAS.asesorDemo, 'IAP Demo');
  const r = await page.evaluate(async (ID) => {
    const { cliente } = await import('./js/api.js');
    const q = async (t, col, v) => (await cliente.from(t).select('*').eq(col, v)).data;
    return {
      org: await q('organizaciones', 'id', ID.orgPA),
      miembro: await q('miembros', 'id', ID.miembroAsesorPA),
      sitio: await q('sitios', 'id', ID.sitioPA),
      evento: await q('eventos_jornada', 'id', ID.eventoPA),
      incidencia: await q('incidencias', 'id', ID.incidenciaPA)
    };
  }, ID);
  expect(r).toEqual({ org: [], miembro: [], sitio: [], evento: [], incidencia: [] });
});

test('administración de iap-demo tampoco ve parques-alegres (ni en la bitácora)', async ({ page }) => {
  await entrarCon(page, CUENTAS.adminDemo, 'IAP Demo');
  const vistos = await leerTodo(page);
  for (const [tabla, orgs] of Object.entries(vistos)) {
    expect(Array.isArray(orgs), `${tabla}: ${JSON.stringify(orgs)}`).toBe(true);
    expect(orgs.filter((o) => o === ID.orgPA), `${tabla} expone datos de parques-alegres`).toEqual([]);
  }
  expect(vistos.bitacora.length).toBeGreaterThan(0);
});

test('iap-demo no puede escribir en parques-alegres', async ({ page }) => {
  await entrarCon(page, CUENTAS.asesorDemo, 'IAP Demo');
  const r = await page.evaluate(async (ID) => {
    const { cliente } = await import('./js/api.js');
    const ahora = new Date().toISOString();
    // 1) Evento a nombre de un asesor de PA → rechazado
    const e1 = await cliente.from('eventos_jornada').insert({ id: crypto.randomUUID(), miembro_id: ID.miembroAsesorPA, tipo: 'inicio_bloque', bloque: 'campo', hora_dispositivo: ahora });
    // 2) Evento propio pero diciendo que es de PA → el servidor lo deja en iap-demo
    const idPropio = crypto.randomUUID();
    const e2 = await cliente.from('eventos_jornada').upsert(
      { id: idPropio, miembro_id: ID.miembroAsesorDemo, organizacion_id: ID.orgPA, tipo: 'inicio_bloque', bloque: 'campo', hora_dispositivo: ahora },
      { onConflict: 'id', ignoreDuplicates: true });
    const guardado = (await cliente.from('eventos_jornada').select('organizacion_id').eq('id', idPropio)).data;
    // 3) Incidencia a nombre de PA → rechazada
    const e3 = await cliente.from('incidencias').insert({ miembro_id: ID.miembroAsesorPA, tipo: 'otro', motivo: 'Intento cruzado' });
    // 4) Sitio en PA → rechazado
    const e4 = await cliente.from('sitios').insert({ organizacion_id: ID.orgPA, nombre: 'Intruso', centro: 'SRID=4326;POINT(-107.4 24.8)' });
    return { e1: !!e1.error, e2: e2.error?.message ?? null, guardado, e3: !!e3.error, e4: !!e4.error };
  }, ID);
  expect(r.e1, 'insertar evento a nombre de PA debe fallar').toBe(true);
  expect(r.e2).toBeNull();
  expect(r.guardado).toEqual([{ organizacion_id: ID.orgDemo }]);
  expect(r.e3, 'insertar incidencia a nombre de PA debe fallar').toBe(true);
  expect(r.e4, 'crear sitio en PA debe fallar').toBe(true);
});

test('en sentido inverso: coordinación de parques-alegres no ve iap-demo', async ({ page }) => {
  await entrarCon(page, CUENTAS.coordPA, 'Parques Alegres IAP');
  const vistos = await leerTodo(page);
  for (const [tabla, orgs] of Object.entries(vistos)) {
    expect(Array.isArray(orgs), `${tabla}: ${JSON.stringify(orgs)}`).toBe(true);
    expect(orgs.filter((o) => o === ID.orgDemo), `${tabla} expone datos de iap-demo`).toEqual([]);
  }
  expect(vistos.miembros.length).toBe(2);   // coordinación ve a toda su organización
});
