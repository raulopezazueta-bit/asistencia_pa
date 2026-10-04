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
