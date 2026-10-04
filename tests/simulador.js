// Simulador de Supabase para Playwright (page.route): Auth + PostgREST con datos ficticios.
// Se usa porque la sesión de desarrollo no tiene salida a *.supabase.co; la prueba real es desde el celular.
// Imita las reglas RLS relevantes: cada usuario solo ve sus filas de `miembros`.

import { readFileSync } from 'node:fs';
import { sitioParaPunto, evaluarSitio } from '../js/geo.js';
import { partesLocales, rangoDelDia, resumenDelDia } from '../js/reglas.js';

const FOTO_PRUEBA = readFileSync(new URL('./recursos/foto_prueba.jpg', import.meta.url));
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

const MIEMBROS = Object.values(USUARIOS).flatMap((u) => u.miembros);

// Incidencia ya guardada en el servidor (para precargar el simulador). hora: 'AAAA-MM-DDTHH:MM' en hora de Culiacán.
export function incidenciaServidor(tipo, extra = {}) {
  const { hora, ...resto } = extra;
  return { id: `dddddddd-0000-0000-0000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`,
    organizacion_id: ORGS.pa.id, miembro_id: 'aaaaaaaa-0000-0000-0000-000000000001', tipo, evento_original_id: null,
    tipo_evento_propuesto: null, bloque_propuesto: null, hora_propuesta: hora ? new Date(`${hora}:00-07:00`).toISOString() : null,
    motivo: 'Motivo ficticio de prueba', estado: 'pendiente', resuelta_por: null, resuelta_en: null, comentario_resolucion: null,
    creada_en: '2026-10-05T18:00:00.000Z', ...resto };
}

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
// iat (instante de emisión según el servidor) solo se incluye si la prueba fija la hora del servidor.
function token(usuario, segundos = 3600, horaServidor = null) {
  const exp = Math.floor(Date.now() / 1000) + segundos;
  const iat = horaServidor ? { iat: Math.floor(horaServidor.getTime() / 1000) } : {};
  return b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({ sub: usuario.id, email: usuario.email, role: 'authenticated', exp, ...iat }) + '.firma';
}
function usuarioAuth(u) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-10-01T00:00:00Z',
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };
}
// Tokens de 30 días: algunas pruebas fijan el reloj de la página en otra fecha (page.clock).
const VIGENCIA = 30 * 24 * 3600;
function sesion(u, horaServidor = null) {
  return { access_token: token(u, VIGENCIA, horaServidor), token_type: 'bearer', expires_in: VIGENCIA, expires_at: Math.floor(Date.now() / 1000) + VIGENCIA,
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
// Horario ficticio del asesor de prueba: lunes a viernes, jornada partida (escritorio en casa + campo).
export const HORARIO_ASESOR = [1, 2, 3, 4, 5].flatMap((d) => [
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

// rechazarEventos: el servidor rechaza los eventos (validación) → deben quedar "para soporte".
// Las rutas se instalan en el contexto: así también se atienden los envíos del service worker (Background Sync).
// horaServidor: Date que el "servidor" sella en el token (HU-19, diferencia de reloj).
// horarioAsesor: reemplaza el horario del asesor de prueba (filas como las de la tabla horarios).
// incidencias: filas iniciales de la tabla incidencias (ver incidenciaServidor). revisiones: filas iniciales de revisiones.
export async function simularSupabase(page, { sitiosPA = 782, sitiosDemo = 3, eventos = [], configPA = {}, rechazarEventos = false, horaServidor = null, horarioAsesor = HORARIO_ASESOR, incidencias = [], revisiones = [] } = {}) {
  const registro = [];
  const estado = { sinRed: false, recibidos: [], selfies: [], incidencias, revisiones, firmadas: [] };
  // Domicilio ficticio del asesor de prueba: RLS solo se lo muestra a él (y a coordinación).
  const domicilio = { ...sitiosFicticios('pa', 1, 'D')[0], id: 'dddddddd-dddd-0000-0000-000000000001', clave_externa: null,
    id_oficial: null, nombre: 'Domicilio ficticio', tipo: 'domicilio', miembro_id: 'aaaaaaaa-0000-0000-0000-000000000001', perimetro_geojson: null };
  const catalogo = [...sitiosFicticios('pa', sitiosPA), domicilio, ...sitiosFicticios('demo', sitiosDemo, 'G')];
  await page.context().route(`${URL_SUPABASE}/**`, async (route) => {
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
        return json(route, 200, sesion(u, horaServidor));
      }
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const u = Object.values(USUARIOS).find((x) => `refresco-${x.id}` === datos.refresh_token);
        if (!u) return json(route, 400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        return json(route, 200, sesion(u, horaServidor));
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
      const filtroOrg = url.searchParams.get('organizacion_id');
      if (filtroOrg && !filtroUser) {   // panel: coordinación ve a todas las personas de su organización (RLS mie_ver)
        const org = Object.keys(ORGS).find((k) => `eq.${ORGS[k].id}` === filtroOrg);
        const coord = u.miembros.some((m) => m.activo && m.rol !== 'asesor' && m.org === org);
        const filas = coord ? MIEMBROS.filter((m) => m.org === org && m.activo).map((m) => ({ id: m.id, nombre_completo: m.nombre_completo, num_empleado: null, rol: m.rol })) : [];
        return json(route, 200, filas.sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo)));
      }
      let filas = u.miembros.map((m) => ({
        id: m.id, organizacion_id: ORGS[m.org].id, user_id: u.id, nombre_completo: m.nombre_completo, num_empleado: null,
        rol: m.rol, activo: m.activo,
        organizaciones: { ...ORGS[m.org], config: { ...ORGS[m.org].config, ...(m.org === 'pa' ? configPA : {}) } }
      }));
      if (filtroUser) filas = filas.filter((f) => `eq.${f.user_id}` === filtroUser);
      if (filtroActivo) filas = filas.filter((f) => `eq.${f.activo}` === filtroActivo);
      return json(route, 200, filas);
    }

    if (url.pathname === '/rest/v1/horarios' && req.method() === 'GET') {
      const u = usuarioDeToken(req);
      if (!u) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });
      const ASESOR = 'aaaaaaaa-0000-0000-0000-000000000001';
      if (url.searchParams.get('organizacion_id') === `eq.${ORGS.pa.id}`) {   // panel: horarios de la organización
        const coord = u.miembros.some((m) => m.activo && m.rol !== 'asesor' && m.org === 'pa');
        return json(route, 200, coord ? horarioAsesor.map((h) => ({ miembro_id: ASESOR, ...h })) : []);
      }
      const filas = u === USUARIOS.asesor && url.searchParams.get('miembro_id') === `eq.${ASESOR}` ? horarioAsesor : [];
      return json(route, 200, filas);
    }

    // Storage: subida de selfies al bucket privado (imita la política selfies_subir y el límite de 150 KB).
    if (url.pathname.startsWith('/storage/v1/object/selfies/') && req.method() === 'POST') {
      const u = usuarioDeToken(req);
      if (!u) return json(route, 400, { statusCode: '403', error: 'Unauthorized', message: 'invalid JWT' });
      const ruta = decodeURIComponent(url.pathname.slice('/storage/v1/object/selfies/'.length));
      const [org, miembro] = ruta.split('/');
      const propio = u.miembros.some((m) => m.activo && m.id === miembro && ORGS[m.org].id === org);
      let cuerpo = req.postDataBuffer() || Buffer.alloc(0);
      let tipo = req.headers()['content-type'] || '';
      // storage-js envía los Blob como multipart/form-data: se extrae el archivo y su tipo real.
      const limite = /boundary=(.+)$/.exec(tipo)?.[1];
      if (limite) {
        const sep = Buffer.from(`--${limite}`);
        let i = cuerpo.indexOf(sep);
        while (i !== -1) {
          const sig = cuerpo.indexOf(sep, i + sep.length);
          if (sig === -1) break;
          const parte = cuerpo.subarray(i + sep.length + 2, sig - 2);
          const finEnc = parte.indexOf('\r\n\r\n');
          const enc = parte.subarray(0, finEnc).toString();
          if (/filename=/.test(enc)) {
            tipo = /content-type:\s*([^\r\n]+)/i.exec(enc)?.[1] || '';
            cuerpo = parte.subarray(finEnc + 4);
            break;
          }
          i = sig;
        }
      }
      if (!propio) return json(route, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      if (cuerpo.length > 150000) return json(route, 400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      if (estado.selfies.some((x) => x.ruta === ruta)) return json(route, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      estado.selfies.push({ ruta, bytes: cuerpo.length, tipo, upsert: req.headers()['x-upsert'] });
      return json(route, 200, { Key: `selfies/${ruta}`, Id: ruta });
    }

    // Inserción de eventos (upsert con ignoreDuplicates). Imita al trigger preparar_evento de forma simplificada;
    // la comparación exacta con PostGIS se prueba contra la API local (tests/hu17_servidor.spec.js).
    if (url.pathname === '/rest/v1/eventos_jornada' && req.method() === 'POST') {
      const u = usuarioDeToken(req);
      if (!u) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });
      if (rechazarEventos) return json(route, 400, { code: '23514', message: 'new row violates check constraint' });
      const cuerpo = req.postDataJSON();
      const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      const respuesta = [];
      for (const f of filas) {
        estado.recibidos.push({ ...f, _prefer: req.headers()['prefer'] || '', _query: url.search });
        const miembro = u.miembros.find((m) => m.id === f.miembro_id && m.activo);
        if (!miembro) return json(route, 403, { code: '42501', message: 'new row violates row-level security policy for table "eventos_jornada"' });
        if (eventos.some((e) => e.id === f.id)) continue;   // ON CONFLICT DO NOTHING
        const deCatalogo = (x) => ({ ...x, radioM: x.radio_m, toleranciaM: x.tolerancia_m, perimetro: x.perimetro_geojson });
        const orgId = ORGS[miembro.org].id;
        // Igual que preparar_evento (migraciones 0001 + 0002)
        const cfg = { ...ORGS[miembro.org].config, ...(miembro.org === 'pa' ? configPA : {}) };
        const esPausa = ['inicio_pausa', 'fin_pausa'].includes(f.tipo);
        const contraDomicilio = f.modalidad === 'teletrabajo' && cfg.validar_domicilio === true;
        const candidatos = catalogo.filter((x) => x.organizacion_id === orgId
          && (!contraDomicilio || (x.tipo === 'domicilio' && x.miembro_id === miembro.id))).map(deCatalogo);
        if (contraDomicilio && f.sitio_id && !candidatos.some((x) => x.id === f.sitio_id)) f.sitio_id = null;
        const punto = f.lat != null ? { lat: f.lat, lon: f.lon } : null;
        let sitio = null, distancia = null, dentro = null;
        const motivos = [];
        if (punto) {
          const elegido = f.sitio_id ? candidatos.find((x) => x.id === f.sitio_id) : sitioParaPunto(candidatos, punto, f.precision_m)?.sitio;
          if (elegido) { const r = evaluarSitio(elegido, punto, f.precision_m); sitio = elegido.id; distancia = r.distancia; dentro = r.dentro; }
        }
        if ((f.modalidad === 'teletrabajo' && !cfg.validar_domicilio) || esPausa) dentro = null;
        else if (!punto) { dentro = false; motivos.push('sin_ubicacion'); }
        else if (!sitio || !dentro) { dentro = false; motivos.push('fuera_de_geocerca'); }
        if (['inicio_bloque', 'fin_bloque'].includes(f.tipo) && !f.selfie_path) motivos.push('sin_selfie');
        const fila = { ...f, organizacion_id: orgId, hora_servidor: f.hora_dispositivo,
          hora_efectiva: f.hora_dispositivo, sitio_id: sitio, distancia_sitio_m: distancia, dentro_geocerca: dentro,
          estado_revision: motivos.length ? 'revisar' : 'ok', motivos_revision: motivos, origen: 'app' };
        eventos.push(fila);
        respuesta.push(fila);
      }
      return json(route, 201, respuesta);
    }

    if (url.pathname === '/rest/v1/eventos_jornada' && req.method() === 'GET') {
      const u = usuarioDeToken(req);
      if (!u) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });
      const mios = u.miembros.map((m) => m.id);
      const desde = url.searchParams.getAll('hora_efectiva').find((x) => x.startsWith('gte.'))?.slice(4);
      const hasta = url.searchParams.getAll('hora_efectiva').find((x) => x.startsWith('lt.'))?.slice(3);
      const orgsCoord = u.miembros.filter((m) => m.activo && m.rol !== 'asesor').map((m) => ORGS[m.org].id);
      const filtroOrg = url.searchParams.get('organizacion_id');
      let filas = filtroOrg
        ? eventos.filter((e) => orgsCoord.includes(e.organizacion_id || ORGS.pa.id) && `eq.${e.organizacion_id || ORGS.pa.id}` === filtroOrg)
        : eventos.filter((e) => mios.includes(e.miembro_id) && `eq.${e.miembro_id}` === url.searchParams.get('miembro_id'));
      if (desde) filas = filas.filter((e) => new Date(e.hora_efectiva) >= new Date(desde));
      if (hasta) filas = filas.filter((e) => new Date(e.hora_efectiva) < new Date(hasta));
      const revision = url.searchParams.get('estado_revision');
      if (revision) filas = filas.filter((e) => `eq.${e.estado_revision}` === revision);
      const desc = /hora_efectiva\.desc/.test(url.searchParams.get('order') || '');
      filas.sort((a, b) => (desc ? -1 : 1) * (new Date(a.hora_efectiva) - new Date(b.hora_efectiva)));
      if (/persona:/.test(url.searchParams.get('select') || '')) {
        filas = filas.map((e) => ({ ...e, persona: { nombre_completo: MIEMBROS.find((m) => m.id === e.miembro_id)?.nombre_completo } }));
      }
      return json(route, 200, filas);
    }

    // Vista v_jornada_diaria (aproximación con las reglas del cliente: solo bloques cerrados suman).
    // La vista real se prueba contra la API local (tests/hu14_horas.spec.js).
    if (url.pathname === '/rest/v1/v_jornada_diaria' && req.method() === 'GET') {
      const u = usuarioDeToken(req);
      if (!u) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });
      const miembro = url.searchParams.get('miembro_id')?.slice(3);
      if (!u.miembros.some((m) => m.id === miembro)) return json(route, 200, []);
      const zona = 'America/Mazatlan';
      const porFecha = new Map();
      const corregidas = new Set(incidencias.filter((i) => i.estado === 'aprobada' && i.tipo === 'correccion_hora').map((i) => i.evento_original_id));
      for (const e of eventos.filter((x) => x.miembro_id === miembro && !corregidas.has(x.id))) {
        const f = partesLocales(e.hora_efectiva, zona).fecha;
        if (!porFecha.has(f)) porFecha.set(f, []);
        porFecha.get(f).push({ id: e.id, tipo: e.tipo, bloque: e.bloque, hora: e.hora_efectiva, estadoRevision: e.estado_revision });
      }
      const gte = url.searchParams.getAll('fecha').find((x) => x.startsWith('gte.'))?.slice(4);
      const lte = url.searchParams.getAll('fecha').find((x) => x.startsWith('lte.'))?.slice(4);
      const filas = [...porFecha.entries()]
        .filter(([f, evs]) => (!gte || f >= gte) && (!lte || f <= lte) && evs.some((e) => e.bloque))
        .map(([fecha, evs]) => {
          const r = resumenDelDia({ eventos: evs, ahora: rangoDelDia(new Date(`${fecha}T12:00:00Z`), zona).desde, zona });
          return { fecha, minutos_efectivos: r.minutosEfectivos, minutos_pausa: 0, bloque_inconsistente: false,
            jornada_abierta: r.filas.some((x) => x.tipo === 'bloque' && x.estado === 'abierto'), con_revision: evs.some((e) => e.estadoRevision === 'revisar') };
        })
        .sort((a, b) => a.fecha.localeCompare(b.fecha));
      return json(route, 200, filas);
    }

    // Incidencias (HU-28/29): imita RLS (cada quien las suyas; coordinación las de su organización)
    // y los triggers controlar_incidencia, validar_incidencia y aplicar_incidencia_aprobada (migraciones 0001 y 0003).
    if (url.pathname === '/rest/v1/incidencias') {
      const u = usuarioDeToken(req);
      if (!u) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });
      const mios = u.miembros.filter((m) => m.activo).map((m) => m.id);
      const orgsCoord = u.miembros.filter((m) => m.activo && m.rol !== 'asesor').map((m) => ORGS[m.org].id);
      const visibles = () => incidencias.filter((i) => mios.includes(i.miembro_id) || orgsCoord.includes(i.organizacion_id));
      const errorBD = (message) => json(route, 400, { code: 'P0001', message });
      if (req.method() === 'GET') {
        let filas = visibles();
        if (url.searchParams.get('evento_original_id') === 'not.is.null') filas = filas.filter((i) => i.evento_original_id);
        for (const campo of ['miembro_id', 'organizacion_id', 'estado', 'tipo']) {
          const f = url.searchParams.get(campo);
          if (f?.startsWith('eq.')) filas = filas.filter((i) => i[campo] === f.slice(3));
          if (f?.startsWith('neq.')) filas = filas.filter((i) => i[campo] !== f.slice(4));
        }
        const desde = url.searchParams.get('creada_en');
        if (desde?.startsWith('gte.')) filas = filas.filter((i) => i.creada_en >= desde.slice(4));
        const asc = /creada_en\.asc/.test(url.searchParams.get('order') || '');
        filas = [...filas].sort((a, b) => (asc ? 1 : -1) * a.creada_en.localeCompare(b.creada_en));
        const nombre = (id) => (id ? { nombre_completo: MIEMBROS.find((m) => m.id === id)?.nombre_completo } : null);
        const conVinculos = /persona:/.test(url.searchParams.get('select') || '');
        return json(route, 200, filas.map((i) => conVinculos ? { ...i, persona: nombre(i.miembro_id), resolutor: nombre(i.resuelta_por),
          original: i.evento_original_id ? (({ tipo, bloque, hora_efectiva, motivos_revision }) => ({ tipo, bloque, hora_efectiva, motivos_revision }))(eventos.find((e) => e.id === i.evento_original_id) || {}) : null } : i));
      }
      if (req.method() === 'POST') {
        const cuerpo = req.postDataJSON();
        for (const f of Array.isArray(cuerpo) ? cuerpo : [cuerpo]) {
          const miembro = u.miembros.find((m) => m.id === f.miembro_id && m.activo);
          if (!miembro) return json(route, 403, { code: '42501', message: 'new row violates row-level security policy for table "incidencias"' });
          if (incidencias.some((i) => i.id === f.id)) continue;   // ON CONFLICT DO NOTHING
          if (String(f.motivo || '').trim().length < 5) return json(route, 400, { code: '23514', message: 'new row for relation "incidencias" violates check constraint "incidencias_motivo_check"' });
          if (['omision', 'correccion_hora'].includes(f.tipo) && (!f.tipo_evento_propuesto || !f.hora_propuesta)) return errorBD('Indica qué checada y a qué hora');
          if (['correccion_hora', 'fuera_geocerca'].includes(f.tipo) && !f.evento_original_id) return errorBD('Indica la checada que quieres corregir');
          incidencias.push({ evento_original_id: null, tipo_evento_propuesto: null, bloque_propuesto: null, hora_propuesta: null, ...f,
            organizacion_id: ORGS[miembro.org].id, estado: 'pendiente', resuelta_por: null, resuelta_en: null, comentario_resolucion: null,
            creada_en: new Date().toISOString() });
        }
        return json(route, 201, undefined);
      }
      if (req.method() === 'PATCH') {
        const datos = req.postDataJSON();
        const id = url.searchParams.get('id')?.slice(3);
        const soloPendiente = url.searchParams.get('estado') === 'eq.pendiente';
        const inc = visibles().find((i) => i.id === id && orgsCoord.includes(i.organizacion_id) && (!soloPendiente || i.estado === 'pendiente'));
        if (!inc) return json(route, 200, []);
        if (inc.estado !== 'pendiente') return errorBD('La incidencia ya fue resuelta');
        const resolutor = u.miembros.find((m) => m.activo && m.rol !== 'asesor' && ORGS[m.org].id === inc.organizacion_id);
        if (resolutor.id === inc.miembro_id) return errorBD('Nadie aprueba sus propias incidencias');
        if (datos.estado === 'rechazada' && String(datos.comentario_resolucion || '').trim().length < 5) return errorBD('Para rechazar, escribe el motivo (al menos 5 caracteres)');
        Object.assign(inc, { estado: datos.estado, comentario_resolucion: datos.comentario_resolucion, resuelta_por: resolutor.id, resuelta_en: new Date().toISOString() });
        if (inc.estado === 'aprobada' && inc.tipo_evento_propuesto && inc.hora_propuesta) {
          eventos.push({ id: `ffffffff-1111-0000-0000-${String(eventos.length).padStart(12, '0')}`, miembro_id: inc.miembro_id, organizacion_id: inc.organizacion_id,
            tipo: inc.tipo_evento_propuesto, bloque: inc.bloque_propuesto, modalidad: null, hora_efectiva: new Date(inc.hora_propuesta).toISOString(),
            sitio_id: null, dentro_geocerca: null, estado_revision: 'ok', motivos_revision: [], origen: 'incidencia', incidencia_id: inc.id });
        }
        return json(route, 200, [{ id: inc.id, estado: inc.estado }]);
      }
    }

    // Revisiones (HU-23): imita RLS y el trigger preparar_revision (migración 0004)
    if (url.pathname === '/rest/v1/revisiones') {
      const u = usuarioDeToken(req);
      if (!u) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });
      const orgsCoord = u.miembros.filter((m) => m.activo && m.rol !== 'asesor').map((m) => ORGS[m.org].id);
      if (req.method() === 'GET') {
        const org = url.searchParams.get('organizacion_id')?.slice(3);
        const filas = revisiones.filter((r) => orgsCoord.includes(r.organizacion_id) && (!org || r.organizacion_id === org))
          .map((r) => ({ ...r, revisor: { nombre_completo: MIEMBROS.find((m) => m.id === r.revisado_por)?.nombre_completo } }));
        return json(route, 200, filas);
      }
      if (req.method() === 'POST') {
        const f = req.postDataJSON();
        const e = eventos.find((x) => x.id === f.evento_id);
        const org = e?.organizacion_id || ORGS.pa.id;
        const yo = u.miembros.find((m) => m.activo && m.rol !== 'asesor' && ORGS[m.org].id === org);
        const errorBD = (message) => json(route, 400, { code: 'P0001', message });
        if (!e) return errorBD('Checada inexistente');
        if (e.estado_revision !== 'revisar') return errorBD('Solo se revisan checadas marcadas para revisión');
        if (!yo) return errorBD('Solo coordinación puede revisar checadas');
        if (yo.id === e.miembro_id) return errorBD('Nadie revisa sus propias checadas');
        if (f.decision === 'observada' && String(f.comentario || '').trim().length < 5) return errorBD('Para observar, escribe el motivo (al menos 5 caracteres)');
        if (revisiones.some((r) => r.evento_id === f.evento_id)) return json(route, 409, { code: '23505', message: 'duplicate key value violates unique constraint "revisiones_evento_id_key"' });
        revisiones.push({ evento_id: f.evento_id, decision: f.decision, comentario: f.comentario, organizacion_id: org, revisado_por: yo.id, revisado_en: new Date().toISOString() });
        return json(route, 201, undefined);
      }
    }

    // Enlace temporal de selfie (createSignedUrl) y la imagen que entrega
    if (url.pathname.startsWith('/storage/v1/object/sign/selfies/')) {
      const u = usuarioDeToken(req);
      if (req.method() === 'POST') {
        if (!u) return json(route, 400, { statusCode: '403', message: 'invalid JWT' });
        estado.firmadas.push(decodeURIComponent(url.pathname.slice('/storage/v1/object/sign/selfies/'.length)));
        return json(route, 200, { signedURL: `${url.pathname.slice('/storage/v1'.length)}?token=prueba` });
      }
      return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'image/jpeg' }, body: FOTO_PRUEBA });
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

// Toma la selfie con la cámara falsa de Chromium y la acepta.
export async function tomarSelfie(page) {
  await page.locator('#selfie-tomar').click();
  await page.locator('#selfie-usar').click();
  await page.locator('#selfie-estado', { hasText: 'Selfie lista' }).waitFor();
}

// Inicia sesión desde la pantalla de acceso.
export async function entrar(page, usuario) {
  await page.locator('#acceso-correo').fill(usuario.email);
  await page.locator('#acceso-contrasena').fill(usuario.clave);
  await page.locator('#acceso-entrar').click();
}
