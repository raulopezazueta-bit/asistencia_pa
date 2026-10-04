// HU-09 · Alta de personas desde el panel (solo administración): contraseña temporal que se cambia al entrar, rol,
// horario semanal con historia, baja que bloquea el acceso sin borrar nada y reactivación. Reloj: lunes 5-oct-2026.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, USUARIOS } from './simulador.js';
import { atender } from '../supabase/functions/alta-persona/logica.js';
import { filasDeBloques, resumenHorario, bloquesDeFilas } from '../js/horario_semanal.js';

const ORG = '11111111-1111-1111-1111-111111111111';

// Base de datos en memoria para probar la lógica de la función sin Supabase
function bdFalsa() {
  const d = {
    cuentas: [{ id: 'u-admin', correo: 'admin@x.test' }, { id: 'u-coord', correo: 'coord@x.test' }, { id: 'u-otra', correo: 'compartida@x.test' }],
    miembros: [
      { id: 'm-admin', organizacion_id: ORG, user_id: 'u-admin', rol: 'admin', activo: true, num_empleado: 'A1' },
      { id: 'm-coord', organizacion_id: ORG, user_id: 'u-coord', rol: 'coordinador', activo: true },
      { id: 'm-otra', organizacion_id: 'otra-org', user_id: 'u-otra', rol: 'asesor', activo: true }
    ],
    bloqueos: {}, bitacora: []
  };
  d.bd = {
    miembroPorUsuario: async (u, o) => d.miembros.find((m) => m.user_id === u && m.organizacion_id === o) || null,
    miembro: async (id) => d.miembros.find((m) => m.id === id) || null,
    miembrosDeOrganizacion: async (o) => d.miembros.filter((m) => m.organizacion_id === o),
    numEmpleadoOcupado: async (o, n) => d.miembros.some((m) => m.organizacion_id === o && m.num_empleado === n),
    otraAltaActiva: async (u, x) => d.miembros.some((m) => m.user_id === u && m.activo && m.id !== x),
    insertarMiembro: async (f) => { const m = { id: `m-${d.miembros.length}`, activo: true, ...f }; d.miembros.push(m); return m; },
    actualizarMiembro: async (id, c) => Object.assign(d.miembros.find((m) => m.id === id), c),
    hoy: async () => '2026-10-05',
    usuarios: async (ids) => d.cuentas.filter((c) => ids.includes(c.id)).map((c) => ({ ...c, bloqueada: !!d.bloqueos[c.id] })),
    usuarioPorCorreo: async (correo) => d.cuentas.find((c) => c.correo === correo) || null,
    crearUsuario: async ({ correo, contrasena, metadata }) => { const c = { id: `u-${d.cuentas.length}`, correo, contrasena, metadata }; d.cuentas.push(c); return { id: c.id }; },
    actualizarUsuario: async (id, { contrasena, metadata }) => Object.assign(d.cuentas.find((c) => c.id === id), { contrasena, metadata }),
    bloquearUsuario: async (id, b) => { d.bloqueos[id] = b; },
    registrar: async (f) => { d.bitacora.push(f); }
  };
  return d;
}

test('lógica de la función: solo administración, validaciones, cuenta existente, baja con bloqueo y bitácora', async () => {
  const d = bdFalsa();
  const llamar = (usuarioId, solicitud) => atender({ usuarioId, solicitud, bd: d.bd });
  const crear = { accion: 'crear', organizacion_id: ORG, correo: 'Nueva@X.test ', nombre_completo: 'Persona Nueva', rol: 'asesor', contrasena: 'Temporal123' };
  expect((await llamar(null, crear)).status).toBe(401);
  expect((await llamar('u-coord', crear)).status).toBe(403);   // coordinación no da de alta
  expect((await llamar('u-admin', { ...crear, contrasena: 'corta' })).cuerpo.error).toContain('al menos 8');
  expect((await llamar('u-admin', { ...crear, rol: 'jefe' })).cuerpo.error).toBe('Elige un rol válido.');
  expect((await llamar('u-admin', { ...crear, num_empleado: 'A1' })).cuerpo.error).toContain('ya lo tiene otra persona');
  const r = await llamar('u-admin', crear);
  expect(r.status).toBe(201);
  expect(r.cuerpo.cuenta_nueva).toBe(true);
  expect(d.cuentas.at(-1)).toMatchObject({ correo: 'nueva@x.test', contrasena: 'Temporal123', metadata: { debe_cambiar_contrasena: true } });
  expect((await llamar('u-admin', crear)).status).toBe(409);   // ya está en la organización
  // Ya tenía cuenta en otra organización: se liga sin cambiar su contraseña
  const compartida = await llamar('u-admin', { ...crear, correo: 'compartida@x.test', contrasena: '' });
  expect(compartida).toMatchObject({ status: 201, cuerpo: { cuenta_nueva: false } });
  // Baja: la de otra organización sigue activa → la cuenta no se bloquea; la nueva sí
  const mCompartida = compartida.cuerpo.miembro.id, mNueva = r.cuerpo.miembro.id;
  expect((await llamar('u-admin', { accion: 'baja', miembro_id: mCompartida })).cuerpo).toMatchObject({ activo: false, cuenta_bloqueada: false });
  expect((await llamar('u-admin', { accion: 'baja', miembro_id: mNueva })).cuerpo).toMatchObject({ activo: false, cuenta_bloqueada: true });
  expect(d.miembros.find((m) => m.id === mNueva)).toMatchObject({ activo: false, fecha_baja: '2026-10-05' });
  expect(d.bloqueos[r.cuerpo.miembro.user_id]).toBe(true);
  expect((await llamar('u-admin', { accion: 'baja', miembro_id: 'm-admin' })).cuerpo.error).toContain('No puedes darte de baja');
  expect((await llamar('u-coord', { accion: 'reactivar', miembro_id: mNueva })).status).toBe(403);
  expect((await llamar('u-admin', { accion: 'reactivar', miembro_id: mNueva })).status).toBe(200);
  expect(d.bloqueos[r.cuerpo.miembro.user_id]).toBe(false);
  expect((await llamar('u-admin', { accion: 'restablecer', miembro_id: mNueva, contrasena: 'OtraTemp456' })).status).toBe(200);
  expect(d.cuentas.find((c) => c.id === r.cuerpo.miembro.user_id)).toMatchObject({ contrasena: 'OtraTemp456', metadata: { debe_cambiar_contrasena: true } });
  // Nadie de otra organización toca a esta
  expect((await llamar('u-otra', { accion: 'baja', miembro_id: mNueva })).status).toBe(403);
  expect(d.bitacora.map((b) => [b.accion, b.actor])).toEqual([['ALTA', 'u-admin'], ['ALTA', 'u-admin'], ['BAJA', 'u-admin'], ['BAJA', 'u-admin'], ['REACTIVACION', 'u-admin'], ['CONTRASENA_RESTABLECIDA', 'u-admin']]);
});

test('editor de horario: filas por día, validaciones y resumen', () => {
  const bloques = [
    { bloque: 'escritorio', dias: [1, 2, 3, 4, 5], inicio: '09:00', fin: '13:00', modalidad: 'teletrabajo' },
    { bloque: 'campo', dias: [1, 3, 6], inicio: '16:00', fin: '20:00', modalidad: 'presencial' }
  ];
  const { filas } = filasDeBloques(bloques);
  expect(filas).toHaveLength(8);
  expect(resumenHorario(bloquesDeFilas(filas))).toBe('escritorio L–V 09:00–13:00 (teletrabajo) · campo lun, mié, sáb 16:00–20:00');
  expect(filasDeBloques([{ ...bloques[0], fin: '08:00' }, bloques[1]]).error).toContain('posterior');
  expect(filasDeBloques([bloques[0], { ...bloques[1], inicio: '12:00' }]).error).toContain('se enciman');
  expect(resumenHorario(bloquesDeFilas([]))).toBe('Sin horario');
});

async function abrirPanel(page, usuario = USUARIOS.admin) {
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00-07:00'));
  const sim = await simularSupabase(page, { sitiosPA: 20 });
  await page.goto('index.html');
  await entrar(page, usuario);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.goto('panel.html');
  await expect(page.locator('#panel')).toBeVisible();
  return sim;
}
const tarjeta = (page, nombre) => page.locator('#personas-lista .incidencia', { hasText: nombre });
async function salirYEntrar(page, correo, clave) {
  await page.goto('index.html');
  await page.locator('[data-pestana="perfil"]').click();
  await page.locator('#perfil-salir').click();
  await page.locator('#acceso-correo').fill(correo);
  await page.locator('#acceso-contrasena').fill(clave);
  await page.locator('#acceso-entrar').click();
}

test('solo administración ve la sección Personas', async ({ page }) => {
  await abrirPanel(page, USUARIOS.coordinador);
  await expect(page.locator('#seccion-personas')).toBeHidden();
  await expect(page.locator('#menu-personas')).toBeHidden();
});

test('alta con contraseña temporal y horario; la persona nueva cambia la contraseña al entrar', async ({ page }) => {
  const sim = await abrirPanel(page);
  await expect(page.locator('#menu-personas')).toBeVisible();
  await expect(tarjeta(page, 'Asesor de Prueba')).toContainText('Horario: escritorio L–V 09:00–13:00 (teletrabajo) · campo L–V 16:00–20:00');
  await expect(tarjeta(page, 'Administración de Prueba (tú)').locator('[data-persona="baja"]')).toHaveCount(0);
  await page.locator('#personas-nueva').click();
  await page.locator('#alta-nombre').fill('Nueva Asesora Ficticia');
  await page.locator('#alta-correo').fill('nueva@prueba.test');
  await page.locator('#alta-num').fill('F-099');
  await page.locator('#alta-contrasena').fill('corta');
  await page.locator('#alta-guardar').click();
  await expect(page.locator('#alta-error')).toHaveText('La contraseña temporal debe tener al menos 8 caracteres.');
  await page.locator('#alta-contrasena').fill('Temporal123');
  // Sin campo el sábado; escritorio de lunes a viernes (horario tipo)
  await page.locator('#alta-horario [data-bloque="campo"] input[aria-label="Campo vie"]').uncheck();
  await page.locator('#alta-guardar').click();
  await expect(page.locator('#alta-resultado')).toBeVisible();
  await expect(page.locator('#alta-resultado-contrasena')).toHaveText('Temporal123');
  const t = tarjeta(page, 'Nueva Asesora Ficticia');
  await expect(t).toContainText('Asesoría');
  await expect(t).toContainText('Contraseña temporal');
  await expect(t).toContainText('Correo: nueva@prueba.test');
  await expect(t).toContainText('Núm. de empleado: F-099');
  await expect(t).toContainText('Horario: escritorio L–V 09:00–13:00 (teletrabajo) · campo lun, mar, mié, jue 16:00–20:00');
  await expect(t).toContainText('Último acceso: nunca');
  const nueva = sim.estado.cuentas.find((c) => c.email === 'nueva@prueba.test');
  expect(sim.estado.horarios.filter((h) => h.miembro_id === nueva.miembros[0].id)).toHaveLength(9);
  expect(sim.estado.bitacora.map((b) => b.accion)).toEqual(['ALTA']);

  // Primer ingreso: debe cambiar la contraseña antes de usar la app
  await salirYEntrar(page, 'nueva@prueba.test', 'Temporal123');
  await expect(page.locator('#pantalla-contrasena')).toBeVisible();
  await expect(page.locator('#contrasena-cancelar')).toBeHidden();
  await page.locator('#contrasena-nueva').fill('MiClave2026');
  await page.locator('#contrasena-repetir').fill('MiClave2027');
  await page.locator('#contrasena-guardar').click();
  await expect(page.locator('#contrasena-error')).toHaveText('Las dos contraseñas no coinciden.');
  await page.locator('#contrasena-nueva').fill('Temporal123');
  await page.locator('#contrasena-repetir').fill('Temporal123');
  await page.locator('#contrasena-guardar').click();
  await expect(page.locator('#contrasena-error')).toHaveText('La contraseña nueva debe ser distinta de la temporal.');
  await page.locator('#contrasena-nueva').fill('MiClave2026');
  await page.locator('#contrasena-repetir').fill('MiClave2026');
  await page.locator('#contrasena-guardar').click();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(page.locator('#titulo-vista')).toHaveText('Hola, Nueva');
  expect(nueva).toMatchObject({ clave: 'MiClave2026', metadata: { debe_cambiar_contrasena: false } });
});

test('editar rol y horario: el horario anterior se cierra ayer y el nuevo rige desde hoy', async ({ page }) => {
  const sim = await abrirPanel(page);
  const t = tarjeta(page, 'Asesor de Prueba');
  await t.locator('[data-persona="editar"]').click();
  await t.locator('[data-campo="rol"]').selectOption('coordinador');
  await t.locator('[data-bloque="campo"] input[aria-label="Campo sáb"]').check();
  await t.locator('[data-bloque="campo"] .horario-inicio').fill('15:00');
  await t.locator('[data-persona="guardar"]').click();
  await expect(page.locator('#panel-aviso')).toContainText('Cambios de Asesor de Prueba guardados');
  await expect(tarjeta(page, 'Asesor de Prueba')).toContainText('Coordinación');
  await expect(tarjeta(page, 'Asesor de Prueba')).toContainText('campo lun, mar, mié, jue, vie, sáb 15:00–20:00');
  const del = sim.estado.horarios.filter((h) => h.miembro_id === 'aaaaaaaa-0000-0000-0000-000000000001');
  expect(del.filter((h) => h.vigente_hasta === '2026-10-04')).toHaveLength(10);   // los 10 anteriores, cerrados ayer
  expect(del.filter((h) => h.vigente_desde === '2026-10-05' && !h.vigente_hasta)).toHaveLength(11);
  expect(sim.estado.cuentas.find((c) => c.id === USUARIOS.asesor.id).miembros[0].rol).toBe('coordinador');
});

test('baja: ya no puede entrar (registros intactos); reactivar y restablecer contraseña', async ({ page }) => {
  const sim = await abrirPanel(page);
  page.once('dialog', (d) => d.accept());
  await tarjeta(page, 'Asesor de Prueba').locator('[data-persona="baja"]').click();
  await expect(page.locator('#panel-aviso')).toHaveText('Asesor de Prueba quedó de baja. Sus registros se conservan.');
  await expect(tarjeta(page, 'Asesor de Prueba')).toContainText('De baja');
  await expect(tarjeta(page, 'Asesor de Prueba')).toContainText('Baja: 2026-10-05');
  await expect(tarjeta(page, 'Asesor de Prueba').locator('[data-persona="editar"]')).toHaveCount(0);
  await salirYEntrar(page, USUARIOS.asesor.email, USUARIOS.asesor.clave);
  await expect(page.locator('#acceso-error')).toHaveText('Tu acceso está dado de baja. Si es un error, habla con coordinación.');

  await page.locator('#acceso-correo').fill(USUARIOS.admin.email);
  await page.locator('#acceso-contrasena').fill(USUARIOS.admin.clave);
  await page.locator('#acceso-entrar').click();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.goto('panel.html');
  page.once('dialog', (d) => d.accept());
  await tarjeta(page, 'Asesor de Prueba').locator('[data-persona="reactivar"]').click();
  await expect(page.locator('#panel-aviso')).toContainText('activa(o) de nuevo');
  page.once('dialog', (d) => d.accept());
  await tarjeta(page, 'Asesor de Prueba').locator('[data-persona="restablecer"]').click();
  const texto = tarjeta(page, 'Asesor de Prueba').locator('.aviso--ok');
  await expect(texto).toContainText('Contraseña temporal nueva:');
  const temporal = /nueva: (\S+)/.exec(await texto.textContent())[1];
  expect(sim.estado.bitacora.map((b) => b.accion)).toEqual(['BAJA', 'REACTIVACION', 'CONTRASENA_RESTABLECIDA']);
  await salirYEntrar(page, USUARIOS.asesor.email, temporal);
  await expect(page.locator('#pantalla-contrasena')).toBeVisible();
});

test('perfil: cambiar la contraseña por gusto (se puede cancelar)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-05T10:00:00-07:00'));
  const sim = await simularSupabase(page, { sitiosPA: 20 });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.locator('[data-pestana="perfil"]').click();
  await page.locator('#perfil-contrasena').click();
  await expect(page.locator('#pantalla-contrasena')).toBeVisible();
  await page.locator('#contrasena-cancelar').click();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.locator('#perfil-contrasena').click();
  await page.locator('#contrasena-nueva').fill('OtraClave99');
  await page.locator('#contrasena-repetir').fill('OtraClave99');
  await page.locator('#contrasena-guardar').click();
  await expect(page.locator('#perfil-contrasena')).toHaveText('Contraseña cambiada ✓');
  expect(sim.estado.cuentas.find((c) => c.id === USUARIOS.asesor.id).clave).toBe('OtraClave99');
});

test('contra la API local (RLS real): administración cambia rol y horario; coordinación no puede', async ({ page }) => {
  const { apiLocalDisponible, conectarApiLocal, CUENTAS, ID } = await import('./api_local.js');
  test.skip(!(await apiLocalDisponible()), 'API local apagada: corre supabase/tests/e2e/levantar_api_local.sh');
  await conectarApiLocal(page);
  await page.goto('index.html');
  await entrar(page, CUENTAS.coordPA);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  // Coordinación de PA: ni rol ni horario
  const intento = await page.evaluate(async (miembro) => {
    const api = await import('./js/api.js');
    const r = {};
    try { await api.cambiarRol(miembro, 'admin'); r.rol = 'cambió'; } catch (e) { r.rol = e.message; }
    try { await api.guardarHorario('11111111-1111-1111-1111-111111111111', miembro, [{ dia_semana: 6, bloque: 'campo', hora_inicio: '09:00', hora_fin: '12:00', modalidad: 'presencial' }], '2026-10-05', '2026-10-04'); r.horario = 'guardó'; }
    catch (e) { r.horario = e.message; }
    return r;
  }, ID.miembroAsesorPA);
  expect(intento.rol).toContain('No tienes permiso');
  expect(intento.horario).toMatch(/row-level security/);

  // Administración de IAP Demo: lista (sin la función de cuentas, que la réplica local no tiene), rol y horario
  await page.locator('[data-pestana="perfil"]').click();
  await page.locator('#perfil-salir').click();
  await entrar(page, CUENTAS.adminDemo);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.goto('panel.html');
  await expect(page.locator('#personas-nota')).toContainText('función alta-persona');
  const t = page.locator('#personas-lista .incidencia', { hasText: 'Asesor Demo' });
  await t.locator('[data-persona="editar"]').click();
  await t.locator('[data-campo="rol"]').selectOption('coordinador');
  await t.locator('[data-bloque="escritorio"] input[aria-label="Escritorio mar"]').check();
  await t.locator('[data-bloque="escritorio"] .horario-inicio').fill('09:00');
  await t.locator('[data-bloque="escritorio"] .horario-fin').fill('13:00');
  await t.locator('[data-persona="guardar"]').click();
  await expect(page.locator('#panel-aviso')).toContainText('Cambios de Asesor Demo guardados');
  const t2 = page.locator('#personas-lista .incidencia', { hasText: 'Asesor Demo' });
  await expect(t2).toContainText('Coordinación');
  await expect(t2).toContainText('escritorio mar 09:00–13:00');
  // Se deja como estaba el rol (otras pruebas usan a esta persona como asesora)
  await t2.locator('[data-persona="editar"]').click();
  await t2.locator('[data-campo="rol"]').selectOption('asesor');
  await t2.locator('[data-persona="guardar"]').click();
  await expect(page.locator('#personas-lista .incidencia', { hasText: 'Asesor Demo' })).toContainText('Asesoría');
});
