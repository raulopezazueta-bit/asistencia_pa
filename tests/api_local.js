// Conecta la app (que apunta a *.supabase.co) con la API local de supabase/tests/e2e/levantar_api_local.sh:
//   /rest/v1/*  → PostgREST local (RLS real de la migración 0001)
//   /auth/v1/*  → inicio de sesión mínimo que firma JWT con el secreto local
import { createHmac } from 'node:crypto';
import { URL_SUPABASE } from './simulador.js';

export const API_LOCAL = 'http://localhost:3001';
const SECRETO = 'secreto-local-de-pruebas-hu07-no-es-de-supabase-000';
const CLAVE = 'Prueba123';

// Mismos usuarios ficticios que supabase/tests/e2e/datos_ficticios.sql
export const CUENTAS = {
  asesorPA: { id: '00000000-0000-0000-0000-00000000000a', email: 'asesor@prueba.test', clave: CLAVE },
  coordPA: { id: '00000000-0000-0000-0000-00000000000b', email: 'coordinacion@prueba.test', clave: CLAVE },
  asesorDemo: { id: '00000000-0000-0000-0000-00000000000c', email: 'demo@prueba.test', clave: CLAVE },
  adminDemo: { id: '00000000-0000-0000-0000-00000000000d', email: 'admin.demo@prueba.test', clave: CLAVE }
};

export const ID = {
  orgPA: '11111111-1111-1111-1111-111111111111',
  orgDemo: '22222222-2222-2222-2222-222222222222',
  miembroAsesorPA: 'aaaaaaaa-0000-0000-0000-000000000001',
  miembroAsesorDemo: 'aaaaaaaa-0000-0000-0000-000000000003',
  sitioPA: 'bbbbbbbb-0000-0000-0000-000000000001',
  eventoPA: 'cccccccc-0000-0000-0000-000000000001',
  incidenciaPA: 'dddddddd-0000-0000-0000-000000000001'
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function firmar(cuenta) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: cuenta.id, email: cuenta.email, role: 'authenticated', aud: 'authenticated', exp })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

export async function apiLocalDisponible() {
  try { return (await fetch(`${API_LOCAL}/`)).ok; } catch { return false; }
}

// Devuelve { estado }: con estado.sinRed = true responde como si no hubiera señal (ver senal() en simulador.js).
export async function conectarApiLocal(page) {
  const estado = { sinRed: false };
  await page.context().route(`${URL_SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (estado.sinRed) return route.abort('internetdisconnected');

    if (url.pathname === '/auth/v1/token') {
      const datos = req.postDataJSON() || {};
      const cuenta = Object.values(CUENTAS).find((c) => c.email === datos.email && c.clave === datos.password);
      if (!cuenta) return route.fulfill({ status: 400, headers: CORS, contentType: 'application/json', body: JSON.stringify({ code: 'invalid_credentials', msg: 'Invalid login credentials' }) });
      const sesion = { access_token: firmar(cuenta), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: `refresco-${cuenta.id}`, user: { id: cuenta.id, aud: 'authenticated', role: 'authenticated', email: cuenta.email } };
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(sesion) });
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });

    // Storage es un servicio aparte que la réplica local no incluye; sus políticas se prueban en supabase/tests (SQL).
    if (url.pathname.startsWith('/storage/v1/object/')) {
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ Key: url.pathname }) });
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const destino = `${API_LOCAL}${url.pathname.slice('/rest/v1'.length)}${url.search}`;
      const encabezados = { ...req.headers() };
      delete encabezados.apikey; delete encabezados.origin; delete encabezados.referer;
      // Se lee la respuesta completa antes de entregarla, y si el navegador ya canceló la petición
      // (normal al arrancar la app), se ignora: antes eso tumbaba la prueba ("Fetch response has been disposed").
      try {
        const resp = await route.fetch({ url: destino, headers: encabezados });
        const cuerpo = await resp.body();
        return await route.fulfill({ status: resp.status(), headers: { ...resp.headers(), ...CORS }, body: cuerpo });
      } catch (error) {
        if (/disposed|already handled|closed|cancel/i.test(String(error?.message))) return;
        throw error;
      }
    }
    return route.fulfill({ status: 404, headers: CORS, body: 'no simulado' });
  });
  return { estado };
}
