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

// Catálogo FICTICIO de sitios (nunca el seed real): cuadrícula alrededor del centro de Culiacán.
// Algunos nombres llevan acentos para probar la búsqueda.
const COLONIAS = ['Colonia Ficticia Norte', 'Colonia Ficticia Sur', 'Fraccionamiento Los Álamos Ficticio', 'Barrio Ejemplo'];
export function sitiosFicticios(organizacion, cantidad, prefijo = 'F') {
  const filas = [];
  for (let i = 1; i <= cantidad; i++) {
    const lat = 24.76 + Math.floor((i - 1) / 30) * 0.003;
    const lon = -107.43 + ((i - 1) % 30) * 0.003;
    const d = 0.0004;   // ~45 m por lado desde el centro
    const especial = i === 7 ? 'Jardín Ñandú Ficticio' : i === 12 ? 'Parque Álamo Ficticio' : null;
    filas.push({
      id: `ffffffff-0000-0000-${prefijo === 'F' ? '0000' : '0001'}-${String(i).padStart(12, '0')}`,
      organizacion_id: ORGS[organizacion].id,
      clave_externa: `${prefijo}-${String(i).padStart(4, '0')}`,
      id_oficial: `${prefijo}X-${String(100000 + i)}`,
      nombre: especial || `Parque Ficticio ${String(i).padStart(3, '0')}`,
      colonia: COLONIAS[i % COLONIAS.length],
      tipo: 'parque', miembro_id: null,
      lat, lon,
      radio_m: 80, tolerancia_m: 30,
      perimetro_geojson: i % 10 === 0 ? null : { type: 'MultiPolygon', coordinates: [[[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]]] }
    });
  }
  return filas;
}

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(usuario, segundos = 3600) {
  const exp = Math.floor(Date.now() / 1000) + segundos;
  return b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({ sub: usuario.id, email: usuario.email, role: 'authenticated', exp }) + '.firma';
}
function usuarioAuth(u) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-10-01T00:00:00Z',
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };
}
// Tokens de 30 días: algunas pruebas fijan el reloj de la página en otra fecha (page.clock).
const VIGENCIA = 30 * 24 * 3600;
function sesion(u) {
  return { access_token: token(u, VIGENCIA), token_type: 'bearer', expires_in: VIGENCIA, expires_at: Math.floor(Date.now() / 1000) + VIGENCIA,
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
// Horario ficticio del asesor de prueba: todos los días, jornada partida (escritorio en casa + campo).
export const HORARIO_ASESOR = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => [
  { dia_semana: d, bloque: 'escritorio', hora_inicio: '09:00:00', hora_fin: '13:00:00', modalidad: 'teletrabajo', vigente_desde: '2026-01-01', vigente_hasta: null },
  { dia_semana: d, bloque: 'campo', hora_inicio: '16:00:00', hora_fin: '20:00:00', modalidad: 'presencial', vigente_desde: '2026-01-01', vigente_hasta: null }
]);

// Evento del servidor para el asesor de prueba (como lo devolvería PostgREST tras el trigger).
// hora: 'AAAA-MM-DDTHH:MM' en hora de Culiacán.
export function eventoServidor(tipo, hora, extra = {}) {
  return { id: extra.id || `eeeeeeee-0000-0000-0000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`,
    miembro_id: 'aaaaaaaa-0000-0000-0000-000000000001', tipo, bloque: null, modalidad: 'presencial',
    hora_efectiva: new Date(`${hora}:00-07:00`).toISOString(), sitio_id: null, dentro_geocerca: true,
    estado_revision: 'ok', motivos_revision: [], origen: 'app', ...extra };
}

export async function simularSupabase(page, { sitiosPA = 782, sitiosDemo = 3, eventos = [] } = {}) {
  const registro = [];
  const estado = { sinRed: false };
  // Domicilio ficticio del asesor de prueba: RLS solo se lo muestra a él (y a coordinación).
  const domicilio = { ...sitiosFicticios('pa', 1, 'D')[0], id: 'dddddddd-dddd-0000-0000-000000000001', clave_externa: null,
    id_oficial: null, nombre: 'Domicilio ficticio', tipo: 'domicilio', miembro_id: 'aaaaaaaa-0000-0000-0000-000000000001', perimetro_geojson: null };
  const catalogo = [...sitiosFicticios('pa', sitiosPA), domicilio, ...sitiosFicticios('demo', sitiosDemo, 'G')];
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

    if (url.pathname === '/rest/v1/horarios' && req.method() === 'GET') {
      const u = usuarioDeToken(req);
      if (!u) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });
      const filas = u === USUARIOS.asesor && url.searchParams.get('miembro_id') === 'eq.aaaaaaaa-0000-0000-0000-000000000001' ? HORARIO_ASESOR : [];
      return json(route, 200, filas);
    }

    if (url.pathname === '/rest/v1/eventos_jornada' && req.method() === 'GET') {
      const u = usuarioDeToken(req);
      if (!u) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });
      const mios = u.miembros.map((m) => m.id);
      const desde = url.searchParams.getAll('hora_efectiva').find((x) => x.startsWith('gte.'))?.slice(4);
      const hasta = url.searchParams.getAll('hora_efectiva').find((x) => x.startsWith('lt.'))?.slice(3);
      let filas = eventos.filter((e) => mios.includes(e.miembro_id) && `eq.${e.miembro_id}` === url.searchParams.get('miembro_id'));
      if (desde) filas = filas.filter((e) => new Date(e.hora_efectiva) >= new Date(desde));
      if (hasta) filas = filas.filter((e) => new Date(e.hora_efectiva) < new Date(hasta));
      filas.sort((a, b) => new Date(a.hora_efectiva) - new Date(b.hora_efectiva));
      return json(route, 200, filas);
    }

    if (url.pathname === '/rest/v1/v_sitios_app' && req.method() === 'GET') {
      const u = usuarioDeToken(req);
      if (!u) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });
      const misOrgs = u.miembros.filter((m) => m.activo).map((m) => ORGS[m.org].id);
      const misMiembros = u.miembros.map((m) => m.id);
      const esCoord = u.miembros.some((m) => m.activo && m.rol !== 'asesor');
      let filas = catalogo.filter((f) => misOrgs.includes(f.organizacion_id) &&
        (f.tipo !== 'domicilio' || misMiembros.includes(f.miembro_id) || esCoord));
      const filtroOrg = url.searchParams.get('organizacion_id');
      if (filtroOrg) filas = filas.filter((f) => `eq.${f.organizacion_id}` === filtroOrg);
      if (url.searchParams.get('order')?.startsWith('id')) filas = [...filas].sort((a, b) => a.id.localeCompare(b.id));
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Math.min(Number(url.searchParams.get('limit') || 1000), 1000);   // tope de Supabase
      return json(route, 200, filas.slice(offset, offset + limit));
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
