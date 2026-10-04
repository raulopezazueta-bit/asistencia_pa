// Lógica de la función alta-persona (HU-09). JavaScript puro, sin dependencias: la usan index.ts (Supabase Edge
// Functions) y las pruebas locales. Todo acceso a datos pasa por `bd` (ver index.ts), que trabaja con la llave secreta
// del servidor; por eso aquí se verifica que quien llama sea ADMINISTRACIÓN de la organización afectada.
//
// Acciones (POST JSON { accion, ... }):
//   listar      { organizacion_id }                                  → correo, último acceso y bloqueo de cada persona
//   crear       { organizacion_id, correo, nombre_completo, num_empleado?, rol, contrasena }
//   baja        { miembro_id }        (no se borra nada: activo = false y, sin otra alta activa, la cuenta ya no entra)
//   reactivar   { miembro_id }
//   restablecer { miembro_id, contrasena }                            → contraseña temporal nueva
// Las contraseñas que pone administración son temporales: la app pide cambiarlas al entrar (debe_cambiar_contrasena).
// Cada acción queda en la bitácora con quién la hizo (actor), además de lo que registran los triggers.

export const ROLES = ['asesor', 'coordinador', 'admin'];
export const MIN_CONTRASENA = 8;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const responder = (status, cuerpo) => ({ status, cuerpo });
const error = (status, mensaje) => responder(status, { error: mensaje });

function contrasenaValida(c) {
  return typeof c === 'string' && c.length >= MIN_CONTRASENA;
}

export async function atender({ usuarioId, solicitud, bd }) {
  if (!usuarioId) return error(401, 'Sesión no válida. Vuelve a iniciar sesión.');
  const s = solicitud || {};

  // ¿Quien llama es administración activa de esa organización? Devuelve su fila de miembros.
  const admin = async (organizacionId) => {
    const m = await bd.miembroPorUsuario(usuarioId, organizacionId);
    return m && m.activo && m.rol === 'admin' ? m : null;
  };
  const sobreMiembro = async () => {
    const m = s.miembro_id ? await bd.miembro(s.miembro_id) : null;
    if (!m) return { fallo: error(404, 'No se encontró a esa persona.') };
    const yo = await admin(m.organizacion_id);
    if (!yo) return { fallo: error(403, 'Solo administración de la organización puede hacer esto.') };
    return { m, yo };
  };

  switch (s.accion) {
    case 'listar': {
      if (!(await admin(s.organizacion_id))) return error(403, 'Solo administración de la organización puede ver las cuentas.');
      const miembros = await bd.miembrosDeOrganizacion(s.organizacion_id);
      const cuentas = await bd.usuarios(miembros.map((m) => m.user_id).filter(Boolean));
      return responder(200, { personas: miembros.map((m) => {
        const c = cuentas.find((u) => u.id === m.user_id);
        return { miembro_id: m.id, correo: c?.correo ?? null, ultimo_acceso: c?.ultimo_acceso ?? null, bloqueada: !!c?.bloqueada, debe_cambiar: !!c?.debe_cambiar };
      }) });
    }

    case 'crear': {
      if (!(await admin(s.organizacion_id))) return error(403, 'Solo administración de la organización puede dar de alta personas.');
      const correo = String(s.correo || '').trim().toLowerCase();
      const nombre = String(s.nombre_completo || '').trim();
      const numEmpleado = String(s.num_empleado || '').trim() || null;
      if (!CORREO.test(correo)) return error(400, 'Escribe un correo válido.');
      if (nombre.length < 3) return error(400, 'Escribe el nombre completo.');
      if (!ROLES.includes(s.rol)) return error(400, 'Elige un rol válido.');
      let cuenta = await bd.usuarioPorCorreo(correo);
      if (cuenta && (await bd.miembroPorUsuario(cuenta.id, s.organizacion_id))) {
        return error(409, 'Esa persona ya está dada de alta en esta organización. Si estaba de baja, usa "Reactivar".');
      }
      if (numEmpleado && (await bd.numEmpleadoOcupado(s.organizacion_id, numEmpleado))) {
        return error(409, `El número de empleado ${numEmpleado} ya lo tiene otra persona.`);
      }
      const cuentaNueva = !cuenta;
      if (cuentaNueva) {
        if (!contrasenaValida(s.contrasena)) return error(400, `La contraseña temporal debe tener al menos ${MIN_CONTRASENA} caracteres.`);
        cuenta = await bd.crearUsuario({ correo, contrasena: s.contrasena, metadata: { debe_cambiar_contrasena: true } });
      }
      const miembro = await bd.insertarMiembro({ organizacion_id: s.organizacion_id, user_id: cuenta.id, nombre_completo: nombre, num_empleado: numEmpleado, rol: s.rol });
      await bd.registrar({ organizacion_id: s.organizacion_id, accion: 'ALTA', registro_id: miembro.id, actor: usuarioId, datos: { correo, rol: s.rol, cuenta_nueva: cuentaNueva } });
      return responder(201, { miembro, cuenta_nueva: cuentaNueva });
    }

    case 'baja': {
      const { m, yo, fallo } = await sobreMiembro();
      if (fallo) return fallo;
      if (m.id === yo.id) return error(400, 'No puedes darte de baja a ti misma(o). Pide a otra persona de administración.');
      if (!m.activo) return error(409, 'Esa persona ya está de baja.');
      await bd.actualizarMiembro(m.id, { activo: false, fecha_baja: await bd.hoy(m.organizacion_id) });
      // Sin otra alta activa (en otra organización), la cuenta queda bloqueada: ya no puede entrar
      const otra = m.user_id ? await bd.otraAltaActiva(m.user_id, m.id) : false;
      if (m.user_id && !otra) await bd.bloquearUsuario(m.user_id, true);
      await bd.registrar({ organizacion_id: m.organizacion_id, accion: 'BAJA', registro_id: m.id, actor: usuarioId, datos: { cuenta_bloqueada: !!m.user_id && !otra } });
      return responder(200, { miembro_id: m.id, activo: false, cuenta_bloqueada: !!m.user_id && !otra });
    }

    case 'reactivar': {
      const { m, fallo } = await sobreMiembro();
      if (fallo) return fallo;
      if (m.activo) return error(409, 'Esa persona ya está activa.');
      await bd.actualizarMiembro(m.id, { activo: true, fecha_baja: null });
      if (m.user_id) await bd.bloquearUsuario(m.user_id, false);
      await bd.registrar({ organizacion_id: m.organizacion_id, accion: 'REACTIVACION', registro_id: m.id, actor: usuarioId, datos: {} });
      return responder(200, { miembro_id: m.id, activo: true });
    }

    case 'restablecer': {
      const { m, yo, fallo } = await sobreMiembro();
      if (fallo) return fallo;
      if (m.id === yo.id) return error(400, 'Para cambiar tu propia contraseña usa Perfil › Cambiar contraseña.');
      if (!m.user_id) return error(409, 'Esa persona no tiene cuenta de acceso.');
      if (!contrasenaValida(s.contrasena)) return error(400, `La contraseña temporal debe tener al menos ${MIN_CONTRASENA} caracteres.`);
      await bd.actualizarUsuario(m.user_id, { contrasena: s.contrasena, metadata: { debe_cambiar_contrasena: true } });
      await bd.registrar({ organizacion_id: m.organizacion_id, accion: 'CONTRASENA_RESTABLECIDA', registro_id: m.id, actor: usuarioId, datos: {} });
      return responder(200, { miembro_id: m.id });
    }

    default:
      return error(400, 'Acción no reconocida.');
  }
}
