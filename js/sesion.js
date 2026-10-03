// Sesión y organización activa (HU-08).
// Decide qué pantalla toca: acceso, sin alta, selector de organización o la app.
import * as api from './api.js';
import { leerMeta, guardarMeta, borrarMeta } from './almacen.js';
import * as sitios from './sitios.js';

export const MENSAJE_SIN_ALTA =
  'Tu cuenta existe, pero no tiene un alta activa en ninguna organización. ' +
  'Pide a coordinación que revise tu alta. Cerramos la sesión por seguridad.';

// Devuelve uno de:
//   { estado: 'sin_sesion' }
//   { estado: 'sin_alta' }                          (ya se cerró la sesión)
//   { estado: 'elegir', membresias }
//   { estado: 'lista', perfil, membresias, sinConexion }
export async function resolver() {
  const sesion = await api.sesionActual();
  if (!sesion) return { estado: 'sin_sesion' };
  const userId = sesion.usuario.id;

  let membresias;
  let sinConexion = sesion.sinConexion;
  try {
    membresias = await api.misMembresias(userId);
    await guardarMeta('membresias', { userId, correo: sesion.usuario.email, membresias, actualizadas: new Date().toISOString() });
  } catch (error) {
    if (!api.esErrorDeRed(error)) {
      // El servidor rechazó la sesión (vencida o revocada): hay que volver a entrar.
      if (error?.status === 401 || /jwt|token/i.test(error?.message || '')) {
        await salir();
        return { estado: 'sin_sesion' };
      }
      throw error;
    }
    // Sin señal: se usa la última lista conocida de este mismo usuario.
    const guardadas = await leerMeta('membresias');
    if (!guardadas || guardadas.userId !== userId) throw error;
    membresias = guardadas.membresias;
    sinConexion = true;
  }

  if (membresias.length === 0) {
    await salir();
    return { estado: 'sin_alta' };
  }

  const elegida = await leerMeta('organizacion_elegida');
  let perfil = membresias.find((m) => m.organizacionId === elegida);
  if (!perfil && membresias.length === 1) perfil = membresias[0];
  if (!perfil) return { estado: 'elegir', membresias };

  await guardarMeta('organizacion_elegida', perfil.organizacionId);
  return { estado: 'lista', perfil, membresias, sinConexion, correo: sesion.usuario.email };
}

export async function elegirOrganizacion(organizacionId) {
  await guardarMeta('organizacion_elegida', organizacionId);
}

export async function olvidarOrganizacion() {
  await borrarMeta('organizacion_elegida');
}

export async function entrar(correo, contrasena) {
  await api.iniciarSesion(correo, contrasena);
  return resolver();
}

export async function salir() {
  await api.cerrarSesion();
  await borrarMeta('membresias');
  await borrarMeta('organizacion_elegida');
  await borrarMeta('horarios');
  await borrarMeta('eventos_hoy');
  await borrarMeta('miembros_sw');
  await borrarMeta('sesion_sw');
  await borrarMeta('reloj');
  await sitios.olvidar();
}

// Traduce errores de inicio de sesión a mensajes claros.
export function mensajeDeError(error) {
  if (api.esErrorDeRed(error)) return 'Sin conexión. Para iniciar sesión necesitas señal; después la app funciona sin ella.';
  const m = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  if (m.includes('invalid') && m.includes('credential')) return 'Correo o contraseña incorrectos.';
  if (m.includes('not confirmed')) return 'Tu correo aún no está confirmado. Pide a coordinación que lo confirme.';
  if (m.includes('rate') || error?.status === 429) return 'Demasiados intentos. Espera unos minutos y vuelve a intentar.';
  return 'No se pudo iniciar sesión. Intenta de nuevo en un momento.';
}
