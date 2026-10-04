// Panel › Personas (HU-09, solo administración): alta con contraseña temporal, rol, horario semanal, baja y reactivación.
// Crear cuentas, bloquear y restablecer contraseñas lo hace la función alta-persona (llave secreta solo en Supabase);
// rol y horario se guardan directo (RLS: solo administración de la organización). Nada se borra.
import * as api from './api.js';
import { partesLocales } from './reglas.js';
import { bloquesDeFilas, resumenHorario, filasDeBloques, NOMBRE_DIA } from './horario_semanal.js';

const $ = (id) => document.getElementById(id);
const ROLES = { asesor: 'Asesoría', coordinador: 'Coordinación', admin: 'Administración' };
const DIAS = [[1, 'L'], [2, 'M'], [3, 'Mi'], [4, 'J'], [5, 'V'], [6, 'S'], [7, 'D']];
// Horario tipo para altas nuevas (configurable con organizaciones.config.horario_tipo)
const HORARIO_TIPO = [
  { bloque: 'escritorio', dias: [1, 2, 3, 4, 5], inicio: '09:00', fin: '13:00', modalidad: 'teletrabajo' },
  { bloque: 'campo', dias: [1, 2, 3, 4, 5], inicio: '16:00', fin: '20:00', modalidad: 'presencial' }
];

let ctx = null;   // { perfil, aviso }

// Contraseña temporal legible (sin 0/O, 1/l/I)
export function generarContrasena(largo = 10) {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const n = crypto.getRandomValues(new Uint32Array(largo));
  return Array.from(n, (x) => letras[x % letras.length]).join('');
}

function fechas() {
  const zona = ctx.perfil.organizacion.zonaHoraria;
  const hoy = partesLocales(new Date(), zona).fecha;
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return { hoy, ayer: d.toISOString().slice(0, 10) };
}

function editorHorario(bloques) {
  const caja = document.createElement('fieldset');
  caja.className = 'horario-editor';
  const leyenda = document.createElement('legend');
  leyenda.className = 'campo__etiqueta';
  leyenda.textContent = 'Horario semanal';
  caja.append(leyenda);
  for (const b of bloques) {
    const fila = document.createElement('div');
    fila.className = 'horario-editor__bloque';
    fila.dataset.bloque = b.bloque;
    const t = document.createElement('p');
    t.className = 'lista__titulo';
    t.textContent = b.bloque === 'campo' ? 'Campo' : 'Escritorio';
    const dias = document.createElement('div');
    dias.className = 'horario-editor__dias';
    for (const [n, letra] of DIAS) {
      const l = document.createElement('label');
      l.className = 'dia-chip';
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.value = n;
      i.checked = b.dias.includes(n);
      i.setAttribute('aria-label', `${t.textContent} ${NOMBRE_DIA[n]}`);
      l.append(i, letra);
      dias.append(l);
    }
    const horas = document.createElement('div');
    horas.className = 'campo__fila horario-editor__horas';
    const hora = (clase, valor, etiqueta) => {
      const l = document.createElement('label');
      l.className = 'campo';
      const s = document.createElement('span');
      s.className = 'campo__etiqueta';
      s.textContent = etiqueta;
      const i = document.createElement('input');
      i.type = 'time';
      i.className = `campo__entrada mono ${clase}`;
      i.value = valor;
      l.append(s, i);
      return l;
    };
    const mod = document.createElement('label');
    mod.className = 'campo';
    mod.innerHTML = '<span class="campo__etiqueta">Modalidad</span>';
    const sel = document.createElement('select');
    sel.className = 'campo__entrada horario-modalidad';
    for (const [v, txt] of [['presencial', 'Presencial'], ['teletrabajo', 'Teletrabajo']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = txt; o.selected = b.modalidad === v;
      sel.append(o);
    }
    mod.append(sel);
    horas.append(hora('horario-inicio', b.inicio, 'Inicio'), hora('horario-fin', b.fin, 'Fin'), mod);
    fila.append(t, dias, horas);
    caja.append(fila);
  }
  caja.leer = () => [...caja.querySelectorAll('.horario-editor__bloque')].map((f) => ({
    bloque: f.dataset.bloque,
    dias: [...f.querySelectorAll('input[type="checkbox"]:checked')].map((i) => Number(i.value)),
    inicio: f.querySelector('.horario-inicio').value, fin: f.querySelector('.horario-fin').value,
    modalidad: f.querySelector('.horario-modalidad').value
  }));
  return caja;
}

function errorEn(nodo, texto) {
  nodo.textContent = texto || '';
  nodo.hidden = !texto;
}

const mensaje = (e) => (api.esErrorDeRed(e) ? 'Sin señal: no se pudo guardar. Intenta de nuevo.' : e.message || 'No se pudo guardar.');

// ---------- Alta ----------
function prepararAlta() {
  const tipo = ctx.perfil.organizacion.config?.horario_tipo || HORARIO_TIPO;
  let editor = editorHorario(tipo.map((b) => ({ ...b })));
  $('alta-horario').replaceChildren(editor);
  $('alta-contrasena').value = generarContrasena();
  $('alta-generar').addEventListener('click', () => { $('alta-contrasena').value = generarContrasena(); });
  $('personas-nueva').addEventListener('click', () => {
    $('form-alta').hidden = false;
    $('alta-resultado').hidden = true;
    $('personas-nueva').hidden = true;
    $('alta-nombre').focus();
  });
  $('alta-cancelar').addEventListener('click', () => { $('form-alta').hidden = true; $('personas-nueva').hidden = false; errorEn($('alta-error'), ''); });
  $('form-alta').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const datos = {
      accion: 'crear', organizacion_id: ctx.perfil.organizacionId, nombre_completo: $('alta-nombre').value.trim(),
      correo: $('alta-correo').value.trim().toLowerCase(), num_empleado: $('alta-num').value.trim(), rol: $('alta-rol').value,
      contrasena: $('alta-contrasena').value.trim()
    };
    if (datos.nombre_completo.length < 3) return errorEn($('alta-error'), 'Escribe el nombre completo.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) return errorEn($('alta-error'), 'Escribe un correo válido.');
    if (datos.contrasena.length < 8) return errorEn($('alta-error'), 'La contraseña temporal debe tener al menos 8 caracteres.');
    const horario = filasDeBloques(editor.leer());
    if (horario.error) return errorEn($('alta-error'), horario.error);
    errorEn($('alta-error'), '');
    const boton = $('alta-guardar');
    boton.disabled = true;
    try {
      const r = await api.altaPersona(datos);
      const { hoy, ayer } = fechas();
      let avisoHorario = '';
      try { await api.guardarHorario(ctx.perfil.organizacionId, r.miembro.id, horario.filas, hoy, ayer); }
      catch (e) { avisoHorario = ` El horario no se guardó (${mensaje(e)}); captúralo con "Editar".`; }
      $('alta-resultado-texto').textContent = r.cuenta_nueva
        ? `${datos.nombre_completo} ya puede entrar con ${datos.correo} y esta contraseña temporal. Entrégala en persona; la app le pedirá cambiarla al entrar.${avisoHorario}`
        : `${datos.nombre_completo} ya tenía cuenta (en otra organización): entra con ${datos.correo} y su contraseña de siempre.${avisoHorario}`;
      $('alta-resultado-contrasena').textContent = r.cuenta_nueva ? datos.contrasena : '';
      $('alta-resultado-contrasena').hidden = !r.cuenta_nueva;
      $('alta-resultado').hidden = false;
      $('form-alta').hidden = true;
      $('personas-nueva').hidden = false;
      $('form-alta').reset();
      editor = editorHorario(tipo.map((b) => ({ ...b })));
      $('alta-horario').replaceChildren(editor);
      $('alta-contrasena').value = generarContrasena();
      await pintarPersonas();
    } catch (e) {
      errorEn($('alta-error'), mensaje(e));
    } finally {
      boton.disabled = false;
    }
  });
}

// ---------- Lista ----------
function linea(etiqueta, valor, clase) {
  const p = document.createElement('p');
  p.className = 'incidencia__linea';
  const e = document.createElement('span');
  e.className = 'incidencia__etiqueta';
  e.textContent = `${etiqueta}: `;
  const v = document.createElement('span');
  if (clase) v.className = clase;
  v.textContent = valor;
  p.append(e, v);
  return p;
}

function boton(texto, clase, accion) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `boton ${clase}`;
  b.dataset.persona = accion;
  b.textContent = texto;
  return b;
}

function tarjeta(m, cuenta, filasHorario) {
  const zona = ctx.perfil.organizacion.zonaHoraria;
  const yo = m.id === ctx.perfil.miembroId;
  const art = document.createElement('article');
  art.className = 'tarjeta incidencia';
  art.dataset.miembro = m.id;
  const cab = document.createElement('div');
  cab.className = 'incidencia__cabecera';
  const nombre = document.createElement('p');
  nombre.className = 'lista__titulo';
  nombre.textContent = yo ? `${m.nombre_completo} (tú)` : m.nombre_completo;
  const chips = document.createElement('div');
  chips.className = 'revision__motivos';
  const chip = (t, c) => { const s = document.createElement('span'); s.className = `chip ${c}`.trim(); s.textContent = t; chips.append(s); };
  chip(ROLES[m.rol] || m.rol, '');
  if (!m.activo) chip('De baja', 'chip--critico');
  else if (cuenta?.debe_cambiar) chip('Contraseña temporal', 'chip--aviso');
  cab.append(nombre, chips);
  art.append(cab);
  const bloques = bloquesDeFilas(filasHorario);
  art.append(linea('Correo', cuenta?.correo || '—'));
  if (m.num_empleado) art.append(linea('Núm. de empleado', m.num_empleado, 'mono'));
  art.append(linea('Horario', resumenHorario(bloques)));
  const acceso = cuenta?.ultimo_acceso
    ? new Intl.DateTimeFormat('es-MX', { timeZone: zona, dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(cuenta.ultimo_acceso))
    : 'nunca';
  art.append(linea('Último acceso', acceso));
  if (!m.activo && m.fecha_baja) art.append(linea('Baja', m.fecha_baja, 'mono'));

  const error = document.createElement('p');
  error.className = 'aviso aviso--critico';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const resultado = document.createElement('p');
  resultado.className = 'aviso aviso--ok';
  resultado.hidden = true;
  const botones = document.createElement('div');
  botones.className = 'incidencia__botones personas__botones';

  // Editar: rol + horario
  const edicion = document.createElement('div');
  edicion.className = 'personas__edicion';
  edicion.hidden = true;
  const rolCampo = document.createElement('label');
  rolCampo.className = 'campo';
  rolCampo.innerHTML = '<span class="campo__etiqueta">Rol</span>';
  const rol = document.createElement('select');
  rol.className = 'campo__entrada';
  rol.dataset.campo = 'rol';
  for (const [v, t] of Object.entries(ROLES)) { const o = document.createElement('option'); o.value = v; o.textContent = t; o.selected = m.rol === v; rol.append(o); }
  rol.disabled = yo;   // nadie se quita a sí mismo el rol de administración
  rolCampo.append(rol);
  const editor = editorHorario(bloques.map((b) => (b.dias.length ? b : { ...b, inicio: '', fin: '' })));
  const guardar = boton('Guardar cambios', 'boton--lleno', 'guardar');
  edicion.append(rolCampo, editor, guardar);
  guardar.addEventListener('click', async () => {
    errorEn(error, '');
    const h = filasDeBloques(editor.leer());
    if (h.error) return errorEn(error, h.error);
    guardar.disabled = true;
    try {
      if (rol.value !== m.rol) await api.cambiarRol(m.id, rol.value);
      const { hoy, ayer } = fechas();
      if (resumenHorario(editor.leer()) !== resumenHorario(bloques)) await api.guardarHorario(ctx.perfil.organizacionId, m.id, h.filas, hoy, ayer);
      ctx.aviso(`Cambios de ${m.nombre_completo} guardados. El horario nuevo rige desde hoy; el anterior queda en el historial.`, 'ok');
      await pintarPersonas();
    } catch (e) {
      errorEn(error, mensaje(e));
      guardar.disabled = false;
    }
  });

  if (m.activo) {
    const editar = boton('Editar', '', 'editar');
    editar.addEventListener('click', () => { edicion.hidden = !edicion.hidden; editar.textContent = edicion.hidden ? 'Editar' : 'Cerrar edición'; });
    botones.append(editar);
    if (!yo && m.user_id) {
      const restablecer = boton('Restablecer contraseña', '', 'restablecer');
      restablecer.addEventListener('click', async () => {
        if (!window.confirm(`¿Dar a ${m.nombre_completo} una contraseña temporal nueva? La actual dejará de servir.`)) return;
        const contrasena = generarContrasena();
        restablecer.disabled = true;
        try {
          await api.altaPersona({ accion: 'restablecer', miembro_id: m.id, contrasena });
          resultado.textContent = `Contraseña temporal nueva: ${contrasena} · Entrégala en persona; la app pedirá cambiarla.`;
          resultado.hidden = false;
        } catch (e) { errorEn(error, mensaje(e)); }
        restablecer.disabled = false;
      });
      botones.append(restablecer);
    }
    if (!yo) {
      const baja = boton('Dar de baja', 'boton--tierra', 'baja');
      baja.addEventListener('click', async () => {
        if (!window.confirm(`¿Dar de baja a ${m.nombre_completo}? Ya no podrá entrar a la app. Sus registros se conservan y se puede reactivar.`)) return;
        baja.disabled = true;
        try {
          await api.altaPersona({ accion: 'baja', miembro_id: m.id });
          ctx.aviso(`${m.nombre_completo} quedó de baja. Sus registros se conservan.`, 'ok');
          await pintarPersonas();
        } catch (e) { errorEn(error, mensaje(e)); baja.disabled = false; }
      });
      botones.append(baja);
    }
  } else {
    const reactivar = boton('Reactivar', 'boton--lleno', 'reactivar');
    reactivar.addEventListener('click', async () => {
      if (!window.confirm(`¿Reactivar a ${m.nombre_completo}? Podrá volver a entrar con su contraseña.`)) return;
      reactivar.disabled = true;
      try {
        await api.altaPersona({ accion: 'reactivar', miembro_id: m.id });
        ctx.aviso(`${m.nombre_completo} está activa(o) de nuevo.`, 'ok');
        await pintarPersonas();
      } catch (e) { errorEn(error, mensaje(e)); reactivar.disabled = false; }
    });
    botones.append(reactivar);
  }
  art.append(error, resultado, botones, edicion);
  return art;
}

export async function pintarPersonas() {
  const p = ctx.perfil;
  let errorCuentas = '';
  try {
    const [personas, horarios, cuentas] = await Promise.all([
      api.personasDeOrganizacion(p.organizacionId), api.horariosDeOrganizacion(p.organizacionId),
      api.altaPersona({ accion: 'listar', organizacion_id: p.organizacionId }).then((r) => r.personas).catch((e) => { errorCuentas = e.message; return null; })
    ]);
    const { hoy } = fechas();
    const vigentes = horarios.filter((h) => (!h.vigente_desde || h.vigente_desde <= hoy) && (!h.vigente_hasta || h.vigente_hasta >= hoy));
    $('personas-lista').replaceChildren(...personas.map((m) => tarjeta(m, cuentas?.find((c) => c.miembro_id === m.id), vigentes.filter((h) => h.miembro_id === m.id))));
    $('personas-nota').textContent = cuentas ? `${personas.filter((m) => m.activo).length} activas · ${personas.filter((m) => !m.activo).length} de baja`
      : `No se pudo consultar el servicio de cuentas (correos y accesos): ${errorCuentas || 'revisa la función alta-persona en Supabase'}`;
  } catch (e) {
    ctx.aviso(api.esErrorDeRed(e) ? 'Sin señal: el panel necesita conexión.' : `No se pudo leer la lista de personas: ${e.message}`, 'critico');
  }
}

export async function preparar(perfil, aviso) {
  ctx = { perfil, aviso };
  $('seccion-personas').hidden = false;
  $('menu-personas').hidden = false;
  $('personas-guia').href = `instalar.html?${new URLSearchParams({ org: perfil.organizacion.nombre })}`;
  prepararAlta();
  await pintarPersonas();
}
