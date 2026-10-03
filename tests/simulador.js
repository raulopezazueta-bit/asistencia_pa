// Simulador de Supabase para Playwright (page.route): Auth + PostgREST con datos ficticios.
// Se usa porque la sesión de desarrollo no tiene salida a *.supabase.co; la prueba real es desde el celular.
// Imita las reglas RLS relevantes: cada usuario solo ve sus filas de `miembros`.

export const URL_SUPABASE = 'https://kkaaaaifzyjnafvmfdqe.supabase.co';

export const ORGS = {
  pa: { id: '11111111-1111-1111-1111-111111111111', slug: 'parques-alegres', nombre: 'Parques Alegres IAP', zona_horaria: 'America/Mazatlan', activa: true, config: { tolerancia_geocerca_m: 30, radio_por_defecto_m: 80, validar_domicilio: false, selfie_obligatoria: true } },
  demo: { id: '22222222-2222-2222-2222-222222222222', slug: 'iap-demo', nombre: 'IAP Demo', zona_horaria: 'America/Mazatlan', activa: true, config: { tolerancia_geocerca_m: 30, radio_por_defecto_m: 80, validar_domicilio: false, selfie_obligatoria: true } }
};

// Usuarios ficticios (nunca datos reales)
export const USUARIOS = {
  asesor: { id: '00000000-0000-0000-0000-00000000000a', email: 'asesor@prueba.test', clave: 'Prueba123',
    miembros: [{ id: 'aaaaaaaa-0000-0000-0000-000000000001', org: 'pa', nombre_completo: 'Asesor de Prueba', rol: 'asesor', activo: true }] },
  coordinador: { id: '00000000-0000-0000-0000-00000000000b', email: 'coordinacion@prueba.test', clave: 'Prueba123',
    miembros: [{ id: 'aaaaaaaa-0000-0000-0000-000000000002', org: 'pa', nombre_completo: 'Coordinación de Prueba', rol: 'coordinador', activo: true }] },
  sinAlta: { id: '00000000-0000-0000-0000-00000000000e', email: 'sinalta@prueba.test', clave: 'Prueba123', miembros: [] },
  baja: { id: '00000000-0000-0000-0000-00000000000f', email: 'baja@prueba.test', clave: 'Prueba123',
    miembros: [{ id: 'aaaaaaaa-0000-0000-0000-000000000009', org: 'pa', nombre_completo: 'Persona Dada de Baja', rol: 'asesor', activo: false }] },
  dosOrgs: { id: '00000000-0000-0000-0000-000000000010', email: 'dos@prueba.test', clave: 'Prueba123',
    miembros: [
      { id: 'aaaaaaaa-0000-0000-0000-000000000011', org: 'pa', nombre_completo: 'Persona Compartida', rol: 'asesor', activo: true },
      { id: 'aaaaaaaa-0000-0000-0000-000000000012', org: 'demo', nombre_completo: 'Persona Compartida', rol: 'coordinador', activo: true }
    ] },
  demo: { id: '00000000-0000-0000-0000-00000000000c', email: 'demo@prueba.test', clave: 'Prueba123',
    miembros: [{ id: 'aaaaaaaa-0000-0000-0000-000000000003', org: 'demo', nombre_completo: 'Asesor Demo', rol: 'asesor', activo: true }] }
};

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(usuario, segundos = 3600) {
  const exp = Math.floor(Date.now() / 1000) + segundos;
  return b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({ sub: usuario.id, email: usuario.email, role: 'authenticated', exp }) + '.firma';
}
function usuarioAuth(u) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-10-01T00:00:00Z',
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };
}
function sesion(u) {
  return { access_token: token(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `refresco-${u.id}`, user: usuarioAuth(u) };
}
function usuarioDeToken(req) {
  const auth = req.headers()['authorization'] || '';
  const partes = auth.replace(/^Bearer /i, '').split('.');
  if (partes.length !== 3) return null;
  try {
    const sub = JSON.parse(Buffer.from(partes[1], 'base64url').toString()).sub;
    return Object.values(USUARIOS).find((u) => u.id === sub) || null;
  } catch { return null; }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range, x-supabase-api-version'
};
const json = (route, status, cuerpo, extra = {}) =>
  route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra }, body: cuerpo === undefined ? '' : JSON.stringify(cuerpo) });

// Instala el simulador. Devuelve { registro, estado }: `registro` guarda las peticiones y
// `estado.sinRed = true` hace que el simulador responda como si no hubiera señal
// (context.setOffline no detiene a page.route, por eso se corta aquí también).
export async function simularSupabase(page) {
  const registro = [];
  const estado = { sinRed: false };
  await page.route(`${URL_SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    registro.push({ metodo: req.method(), ruta: url.pathname, query: url.search });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (estado.sinRed) return route.abort('internetdisconnected');

    // ----- Auth -----
    if (url.pathname === '/auth/v1/token') {
      const datos = req.postDataJSON() || {};
      if (url.searchParams.get('grant_type') === 'password') {
        const u = Object.values(USUARIOS).find((x) => x.email === String(datos.email).toLowerCase() && x.clave === datos.password);
        if (!u) return json(route, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return json(route, 200, sesion(u));
      }
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const u = Object.values(USUARIOS).find((x) => `refresco-${x.id}` === datos.refresh_token);
        if (!u) return json(route, 400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        return json(route, 200, sesion(u));
      }
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname === '/auth/v1/user') {
      const u = usuarioDeToken(req);
      return u ? json(route, 200, usuarioAuth(u)) : json(route, 401, { code: 'bad_jwt', msg: 'invalid JWT' });
    }

    // ----- PostgREST -----
    if (url.pathname === '/rest/v1/miembros' && req.method() === 'GET') {
      const u = usuarioDeToken(req);
      if (!u) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });
      const filtroUser = url.searchParams.get('user_id');
      const filtroActivo = url.searchParams.get('activo');
      let filas = u.miembros.map((m) => ({
        id: m.id, organizacion_id: ORGS[m.org].id, user_id: u.id, nombre_completo: m.nombre_completo, num_empleado: null,
        rol: m.rol, activo: m.activo, organizaciones: { ...ORGS[m.org] }
      }));
      if (filtroUser) filas = filas.filter((f) => `eq.${f.user_id}` === filtroUser);
      if (filtroActivo) filas = filas.filter((f) => `eq.${f.activo}` === filtroActivo);
      return json(route, 200, filas);
    }

    return json(route, 404, { message: `Ruta no simulada: ${req.method()} ${url.pathname}` });
  });
  return { registro, estado };
}

// Corta o devuelve la señal: navegador sin red + simulador sin respuesta.
export async function senal(context, sim, hay) {
  sim.estado.sinRed = !hay;
  await context.setOffline(!hay);
}

// Inicia sesión desde la pantalla de acceso.
export async function entrar(page, usuario) {
  await page.locator('#acceso-correo').fill(usuario.email);
  await page.locator('#acceso-contrasena').fill(usuario.clave);
  await page.locator('#acceso-entrar').click();
}
