// Carga los datos del reporte (HU-31) para la página de impresión y el CSV del panel.
import * as api from './api.js';
import { rangoDelDia } from './reglas.js';
import { armarReporte } from './reporte.js';

export async function cargarReporte(perfil, desde, hasta, miembro = '') {
  const zona = perfil.organizacion.zonaHoraria;
  const inicio = rangoDelDia(new Date(`${desde}T12:00:00Z`), zona).desde;
  const fin = rangoDelDia(new Date(`${hasta}T12:00:00Z`), zona).hasta;
  const [miembros, horarios, dias, eventos, corregidas, revisiones] = await Promise.all([
    api.miembrosDeOrganizacion(perfil.organizacionId), api.horariosDeOrganizacion(perfil.organizacionId),
    api.jornadaDeOrganizacion(perfil.organizacionId, desde, hasta),
    api.eventosDeOrganizacion(perfil.organizacionId, inicio.toISOString(), fin.toISOString()),
    api.corregidasDeOrganizacion(perfil.organizacionId), api.revisionesDeOrganizacion(perfil.organizacionId, inicio.toISOString())
  ]);
  const elegidos = miembro ? miembros.filter((m) => m.id === miembro) : miembros;
  return armarReporte({ miembros: elegidos, dias, eventos: eventos.filter((e) => !corregidas.has(e.id)), revisiones, horarios, zona })
    // Con "todas las personas" se omite a quien no tiene registros ni es asesor (p. ej. administración)
    .filter((x) => miembro || x.dias.length || x.miembro.rol === 'asesor');
}

// Mi registro (HU-16): lo mismo, solo de la persona que consulta (cualquier rol; RLS limita a sus propios datos).
export async function cargarMiRegistro(perfil, desde, hasta) {
  const zona = perfil.organizacion.zonaHoraria;
  const inicio = rangoDelDia(new Date(`${desde}T12:00:00Z`), zona).desde;
  const fin = rangoDelDia(new Date(`${hasta}T12:00:00Z`), zona).hasta;
  const [horarios, dias, eventos, solicitudes] = await Promise.all([
    api.misHorarios(perfil.miembroId), api.miJornadaDetalle(perfil.miembroId, desde, hasta),
    api.misEventos(perfil.miembroId, inicio.toISOString(), fin.toISOString()), api.misIncidencias(perfil.miembroId)
  ]);
  const corregidas = new Set(solicitudes.filter((i) => i.estado === 'aprobada' && i.tipo === 'correccion_hora').map((i) => i.evento_original_id));
  const vigentes = eventos.filter((e) => !corregidas.has(e.id)).map((e) => ({ ...e, miembro_id: perfil.miembroId }));
  const revisiones = await api.revisionesDeMisChecadas(vigentes.filter((e) => e.estado_revision === 'revisar').map((e) => e.id));
  const miembro = { id: perfil.miembroId, nombre_completo: perfil.nombre, num_empleado: perfil.numEmpleado, rol: perfil.rol };
  const [persona] = armarReporte({ miembros: [miembro], dias, eventos: vigentes, revisiones,
    horarios: horarios.map((h) => ({ ...h, miembro_id: perfil.miembroId })), zona });
  const observadas = vigentes.filter((e) => revisiones.some((r) => r.evento_id === e.id && r.decision === 'observada'))
    .map((e) => ({ evento: e, revision: revisiones.find((r) => r.evento_id === e.id) }));
  return { persona, observadas };
}
