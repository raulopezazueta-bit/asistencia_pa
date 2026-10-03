// Flujo de checada (HU-17, docs/ESPECIFICACION.md §3 pasos 1–3 y 5; la selfie llega con HU-18).
// 1) ubicación (mejor lectura en ≤ 20 s) · 2) sitio y zona (informativo) · 3) justificación si hace falta · 4) confirmar y enviar.
import { CONFIG } from '../config.js';
import * as sitios from './sitios.js';
import * as cola from './cola.js';
import { leerUbicacion, sitioParaPunto } from './geo.js';
import { pasosPara, partesLocales } from './reglas.js';
import * as camara from './camara.js';
import * as reloj from './reloj.js';

const $ = (id) => document.getElementById(id);
const PRECISION_SUFICIENTE_M = 20;   // con esta precisión estimada se puede confirmar sin esperar los 20 s
const MIN_JUSTIFICACION = 5;
const MOTIVOS = {
  fuera_de_geocerca: 'fuera de la zona del sitio',
  sin_ubicacion: 'sin ubicación',
  sin_selfie: 'sin selfie',
  reloj_desfasado: 'la hora del teléfono no coincide con la del servidor',
  hora_futura: 'la hora del teléfono está adelantada',
  sin_conexion_prolongada: 'se envió muchas horas después de capturarse'
};

const ns = 'http://www.w3.org/2000/svg';
function el(nombre, atributos = {}, texto) {
  const n = document.createElementNS(ns, nombre);
  for (const [k, v] of Object.entries(atributos)) n.setAttribute(k, v);
  if (texto) n.textContent = texto;
  return n;
}

// ---------- Mapa esquemático ----------
function dibujarMapa(lectura, hallado) {
  const svg = $('checada-mapa');
  const W = 320, H = 180, margen = 22;
  svg.replaceChildren();   // sin calles ni teselas: solo el sitio, tu punto y la escala (funciona sin señal)
  const s = hallado?.sitio;
  const centro = s ? { lat: s.lat, lon: s.lon } : lectura;
  if (!centro) return;
  const k = 6371008.8 * Math.PI / 180;
  const aXY = (lat, lon) => [(lon - centro.lon) * k * Math.cos(centro.lat * Math.PI / 180), -(lat - centro.lat) * k];
  // Extensión a dibujar (en metros)
  const puntos = [];
  const poligono = s?.perimetro?.coordinates;
  if (poligono) for (const pol of poligono) for (const [lon, lat] of pol[0]) puntos.push(aXY(lat, lon));
  else if (s) { const r = s.radioM; puntos.push([-r, -r], [r, r]); }
  if (lectura) {
    const [x, y] = aXY(lectura.lat, lectura.lon);
    const r = Math.min(lectura.precision || 0, 200);
    puntos.push([x - r, y - r], [x + r, y + r]);
  }
  if (!puntos.length) puntos.push([-50, -50], [50, 50]);
  const xs = puntos.map((p) => p[0]), ys = puntos.map((p) => p[1]);
  const anchoM = Math.max(Math.max(...xs) - Math.min(...xs), 60), altoM = Math.max(Math.max(...ys) - Math.min(...ys), 40);
  const escala = Math.min((W - 2 * margen) / anchoM, (H - 2 * margen) / altoM);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const aSVG = ([x, y]) => [W / 2 + (x - cx) * escala, H / 2 + (y - cy) * escala];

  if (poligono) {
    for (const pol of poligono) {
      const d = pol.map((anillo) => anillo.map(([lon, lat], i) => `${i ? 'L' : 'M'}${aSVG(aXY(lat, lon)).map((v) => v.toFixed(1)).join(' ')}`).join(' ') + ' Z').join(' ');
      svg.append(el('path', { class: 'm-zona', d, 'fill-rule': 'evenodd' }));
    }
  } else if (s) {
    const [x, y] = aSVG([0, 0]);
    svg.append(el('circle', { class: 'm-zona', cx: x, cy: y, r: s.radioM * escala }));
  }
  if (lectura) {
    const [x, y] = aSVG(aXY(lectura.lat, lectura.lon));
    if (lectura.precision) svg.append(el('circle', { class: 'm-precision', cx: x, cy: y, r: Math.max(lectura.precision * escala, 4) }));
    svg.append(el('circle', { class: 'm-punto', cx: x, cy: y, r: 8 }));
  }
  // Escala gráfica
  const largoM = [10, 20, 50, 100, 200, 500].find((m) => m * escala >= 40) || 500;
  svg.append(el('line', { class: 'm-escala', x1: 12, y1: H - 12, x2: 12 + largoM * escala, y2: H - 12 }), el('text', { class: 'm-texto', x: 12, y: H - 18 }, `${largoM} m`));
}

// ---------- Selfie (HU-18; sin reconocimiento facial) ----------
// Controla la tarjeta de selfie. alCambiar() se llama cuando cambia si hay foto lista.
function prepararSelfie({ requerida, alCambiar }) {
  const video = $('selfie-video'), img = $('selfie-foto'), estado = $('selfie-estado');
  const b = { tomar: $('selfie-tomar'), usar: $('selfie-usar'), repetir: $('selfie-repetir'), archivo: $('selfie-archivo-boton') };
  let cam = null, foto = null, lista = false, sinCamara = false, url = null, cerrado = false;
  const mostrar = (...visibles) => { for (const [k, el] of Object.entries(b)) el.hidden = !visibles.includes(k); };
  const textoBase = `${requerida ? 'Obligatoria. ' : 'Opcional. '}Sin reconocimiento facial: la foto solo es evidencia.`;
  const limpiarFoto = () => { if (url) URL.revokeObjectURL(url); url = null; foto = null; lista = false; img.hidden = true; img.removeAttribute('src'); };

  async function encender() {
    limpiarFoto();
    video.hidden = false;
    estado.textContent = textoBase;
    mostrar();
    try {
      const abierta = await camara.abrir(video);
      // Si la pantalla se cerró mientras la cámara encendía, se apaga de inmediato (nunca queda prendida).
      if (cerrado) { abierta.apagar(); return; }
      cam = abierta;
      mostrar('tomar');
    } catch {
      if (cerrado) return;
      sinCamara = true;
      video.hidden = true;
      estado.textContent = 'No se pudo abrir la cámara aquí. Toma la foto con la cámara del teléfono.';
      mostrar('archivo');
    }
    alCambiar();
  }
  function verFoto(f) {
    foto = f;
    url = URL.createObjectURL(f.blob);
    img.src = url;
    img.hidden = false;
    video.hidden = true;
    estado.textContent = `Revisa la foto (${Math.round(f.blob.size / 1024)} KB).`;
    mostrar('usar', 'repetir');
  }
  b.tomar.onclick = async () => {
    b.tomar.disabled = true;
    try { verFoto(await cam.capturar()); } catch { estado.textContent = 'No se pudo tomar la foto. Intenta de nuevo.'; }
    finally { b.tomar.disabled = false; }
  };
  $('selfie-archivo').onchange = async (ev) => {
    const archivo = ev.target.files?.[0];
    ev.target.value = '';
    if (!archivo) return;
    try { limpiarFoto(); verFoto(await camara.desdeArchivo(archivo)); } catch { estado.textContent = 'No se pudo usar esa foto. Intenta de nuevo.'; }
  };
  b.usar.onclick = () => {
    lista = true;
    estado.textContent = `✓ Selfie lista (${Math.round(foto.blob.size / 1024)} KB).`;
    mostrar('repetir');
    alCambiar();
  };
  b.repetir.onclick = () => (sinCamara ? (limpiarFoto(), mostrar('archivo'), $('selfie-archivo').click(), alCambiar()) : encender());

  $('checada-selfie').hidden = false;
  encender();
  return {
    lista: () => lista,
    foto: () => (lista ? foto : null),
    apagar: () => { cerrado = true; cam?.apagar(); cam = null; }
  };
}

// ---------- Flujo ----------
// opciones: { perfil, estadoDia, eventos, horario, accion, bloque, alTerminar }
export async function abrir({ perfil, estadoDia, eventos, horario, accion, bloque, mostrarPantalla, alTerminar }) {
  const config = perfil.organizacion.config || {};
  let relojPantalla = null, gps = null, selfie = null;
  const catalogo = await sitios.todos(perfil.organizacionId);
  let pasos = pasosPara(estadoDia, accion, { bloque });

  // Regla: terminar el bloque estando en pausa registra primero el regreso, con confirmación.
  const confirmar = pasos.find((p) => p.confirmar);
  if (confirmar && !window.confirm(confirmar.confirmar)) return;

  mostrarPantalla('checada');
  $('checada-captura').hidden = false;
  $('checada-resultado').hidden = true;
  $('checada-justificacion').value = '';
  $('checada-selfie').hidden = true;

  // Sin horario: la persona elige el bloque
  const principal = pasos[pasos.length - 1];
  if (principal.tipo === 'inicio_bloque' && !principal.bloque) {
    $('checada-elegir').hidden = false;
    $('checada-mapa-tarjeta').hidden = true;
    principal.bloque = await new Promise((elegir) => {
      for (const b of document.querySelectorAll('#checada-elegir [data-bloque]')) b.onclick = () => elegir(b.dataset.bloque);
      $('checada-cancelar').onclick = () => elegir(null);
    });
    $('checada-elegir').hidden = true;
    $('checada-mapa-tarjeta').hidden = false;
    if (!principal.bloque) return cerrar();
  }
  const esBloque = ['inicio_bloque', 'fin_bloque'].includes(principal.tipo);
  // Bloque al que pertenece la checada: el de la checada o, en pausas, el que está abierto (puede no haber: comida entre bloques)
  const b = principal.bloque || estadoDia.bloqueAbierto || null;
  const inicioDelBloque = b && [...eventos].reverse().find((e) => e.tipo === 'inicio_bloque' && e.bloque === b);
  const modalidad = principal.tipo !== 'inicio_bloque' && inicioDelBloque?.modalidad
    ? inicioDelBloque.modalidad
    : horario.find((h) => h.bloque === b)?.modalidad || 'presencial';
  const validarZona = !(modalidad === 'teletrabajo' && !config.validar_domicilio);
  const TITULOS = {
    inicio_bloque: [`Entrada · ${b}`, 'Confirmar entrada'],
    fin_bloque: [`Salida · ${b}`, 'Confirmar salida'],
    inicio_pausa: ['Inicio de comida/pausa', 'Confirmar pausa'],
    fin_pausa: ['Regreso de la pausa', 'Confirmar regreso']
  };
  const [titulo, textoConfirmar] = TITULOS[principal.tipo] || [principal.tipo, 'Confirmar'];
  $('checada-titulo').textContent = titulo;
  $('checada-confirmar-texto').textContent = textoConfirmar;

  // Reloj del teléfono (la hora oficial la pone el servidor)
  const zona = perfil.organizacion.zonaHoraria;
  const pintarHora = () => { $('checada-hora').textContent = new Intl.DateTimeFormat('es-MX', { timeZone: zona, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()); };
  pintarHora();
  relojPantalla = setInterval(pintarHora, 1000);
  const textoReloj = await reloj.aviso(config);
  $('checada-reloj').hidden = !textoReloj;
  $('checada-reloj').textContent = textoReloj || '';

  let lectura = null, hallado = null, terminoGPS = false, errorGPS = null;
  // Justificación: solo en entrada/salida de campo fuera de zona. En pausas (comer fuera) la zona es informativa.
  const necesitaJustificacion = () => esBloque && b === 'campo' && (!lectura || !hallado?.dentro);
  const justificacionValida = () => $('checada-justificacion').value.trim().length >= MIN_JUSTIFICACION;
  // Selfie: obligatoria en inicio/fin de bloque si la organización lo pide (selfie_obligatoria);
  // en pausas y visitas solo si selfie_en_pausas_y_visitas = true.
  const selfieRequerida = esBloque ? config.selfie_obligatoria !== false : config.selfie_en_pausas_y_visitas === true;
  const actualizarBoton = () => {
    const listoGPS = terminoGPS || (lectura && lectura.precision <= PRECISION_SUFICIENTE_M);
    const listaSelfie = !selfieRequerida || selfie?.lista();
    $('checada-confirmar').disabled = !listoGPS || !listaSelfie || (necesitaJustificacion() && !justificacionValida());
  };
  if (esBloque || selfieRequerida) selfie = prepararSelfie({ requerida: selfieRequerida, alCambiar: () => actualizarBoton() });

  const pintar = (restantes) => {
    hallado = lectura ? sitioParaPunto(catalogo, lectura, lectura.precision) : null;
    dibujarMapa(lectura, hallado);
    $('checada-sitio').textContent = hallado ? hallado.sitio.nombre : (lectura ? 'Ningún sitio a menos de 500 m' : '—');
    $('checada-distancia-etiqueta').textContent = hallado && !hallado.conPoligono ? 'Distancia al centro' : 'Distancia al perímetro';
    $('checada-distancia').textContent = hallado ? `${Math.round(hallado.distancia)} m` : '—';
    $('checada-precision').textContent = lectura ? `±${Math.round(lectura.precision)} m` : '—';
    $('checada-mapa-pie').textContent = hallado
      ? `${hallado.conPoligono ? 'Perímetro' : `Radio de ${hallado.sitio.radioM} m`} · ${hallado.sitio.nombre}`
      : lectura ? 'Tu ubicación' : 'Buscando ubicación…';

    const zonaEl = $('checada-zona');
    zonaEl.hidden = !lectura && !terminoGPS;
    if (!lectura && terminoGPS) {
      zonaEl.className = 'aviso';
      zonaEl.textContent = errorGPS === 'permiso'
        ? 'No diste permiso de ubicación. Se registrará sin ubicación y quedará para revisión.'
        : 'No se pudo obtener tu ubicación. Se registrará sin ubicación y quedará para revisión.';
    } else if (lectura && !validarZona) {
      zonaEl.className = 'aviso aviso--ok';
      zonaEl.textContent = 'Teletrabajo: tu ubicación se guarda, pero no se valida la zona.';
    } else if (hallado?.dentro) {
      zonaEl.className = 'aviso aviso--ok';
      zonaEl.textContent = `Dentro de la zona de ${hallado.sitio.nombre}.`;
    } else if (lectura) {
      zonaEl.className = 'aviso';
      zonaEl.textContent = (hallado
        ? `Fuera de la zona de ${hallado.sitio.nombre} (a ${Math.round(hallado.distancia)} m).`
        : 'No estás en ningún sitio del catálogo.') + (esBloque ? '' : ' En pausas no se pide justificación.');
    }
    $('checada-justificacion-campo').hidden = !(terminoGPS || lectura) || !necesitaJustificacion();
    $('checada-progreso').textContent = terminoGPS
      ? (lectura ? 'Ubicación lista.' : '')
      : lectura && lectura.precision <= PRECISION_SUFICIENTE_M
        ? 'Precisión suficiente: ya puedes confirmar.'
        : `Buscando ubicación…${restantes != null ? ` ${restantes} s` : ''}${lectura ? ' · mejorando la precisión' : ''}`;
    actualizarBoton();
  };
  $('checada-justificacion').oninput = actualizarBoton;
  pintar();

  // 1) Ubicación: solo ahora, nunca en segundo plano
  gps = leerUbicacion({ alLeer: (mejor, restantes) => { lectura = mejor; pintar(restantes); } });
  gps.resultado.then((r) => { lectura = r.mejor; errorGPS = r.error; terminoGPS = true; pintar(); });

  const resultado = await new Promise((resolver) => {
    $('checada-cancelar').onclick = () => resolver(null);
    $('checada-confirmar').onclick = () => resolver('confirmar');
  });
  gps.detener();
  clearInterval(relojPantalla);
  selfie?.apagar();
  if (!resultado) return cerrar();

  // 4) Armar y registrar los eventos (en orden; cada uno con 1 ms de diferencia)
  $('checada-confirmar').disabled = true;
  $('checada-progreso').textContent = 'Registrando…';
  const justificacion = necesitaJustificacion() ? $('checada-justificacion').value.trim() : null;
  const ahora = Date.now();
  const registros = [];
  const foto = selfie?.foto() ?? null;
  for (const [i, paso] of pasos.entries()) {
    const id = crypto.randomUUID();
    // La selfie va con el evento principal (inicio/fin de bloque), no con la salida del parque o el fin de pausa previos.
    const conSelfie = foto && i === pasos.length - 1;
    const { fecha } = partesLocales(ahora, zona);
    const ruta = conSelfie ? `${perfil.organizacionId}/${perfil.miembroId}/${fecha.slice(0, 4)}/${fecha.slice(5, 7)}/${id}.${foto.extension}` : null;
    const evento = {
      id,
      miembro_id: perfil.miembroId,
      tipo: paso.tipo,
      bloque: ['inicio_bloque', 'fin_bloque'].includes(paso.tipo) ? b : null,
      modalidad,
      hora_dispositivo: new Date(ahora + i).toISOString(),
      capturado_sin_conexion: false,
      lat: lectura?.lat ?? null,
      lon: lectura?.lon ?? null,
      precision_m: lectura ? Math.round(lectura.precision * 10) / 10 : null,
      sitio_id: paso.tipo === 'salida_sitio' ? paso.sitio?.id ?? null : hallado?.sitio.id ?? null,
      justificacion,
      selfie_path: ruta,
      version_app: CONFIG.VERSION_APP,
      user_agent: navigator.userAgent.slice(0, 250)
    };
    registros.push({ evento, r: await cola.registrar(evento, conSelfie ? foto.blob : null) });
  }
  mostrarResultado(registros, zona);

  await new Promise((r) => { $('checada-listo').onclick = r; });
  return cerrar();

  function cerrar() {
    clearInterval(relojPantalla);
    gps?.detener?.();
    selfie?.apagar();
    alTerminar();
  }
}

function mostrarResultado(registros, zona) {
  $('checada-captura').hidden = true;
  $('checada-resultado').hidden = false;
  const principal = registros[registros.length - 1];
  const icono = $('checada-resultado-icono');
  const lista = $('checada-resultado-lista');
  lista.replaceChildren();
  const fila = (etiqueta, valor, mono) => {
    const li = document.createElement('li');
    li.className = 'lista__fila';
    const a = document.createElement('span'); a.textContent = etiqueta;
    const v = document.createElement('span'); v.className = `lista__valor${mono ? ' mono' : ''}`; v.textContent = valor;
    li.append(a, v);
    lista.append(li);
  };
  const hora = (iso) => new Intl.DateTimeFormat('es-MX', { timeZone: zona, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso));

  if (registros.some((x) => x.r.estado === 'error')) {
    icono.dataset.tipo = 'error'; icono.textContent = '!';
    $('checada-resultado-titulo').textContent = 'No se pudo registrar';
    $('checada-resultado-detalle').textContent = 'Quedó guardado en el teléfono para revisión. Avisa a coordinación.';
    fila('Detalle', registros.find((x) => x.r.estado === 'error').r.mensaje);
  } else if (registros.some((x) => x.r.estado === 'guardado')) {
    icono.dataset.tipo = 'guardado'; icono.textContent = '⏱';
    $('checada-resultado-titulo').textContent = 'Guardado en el teléfono';
    $('checada-resultado-detalle').textContent = 'Se enviará solo en cuanto haya señal. Cuenta la hora en que checaste.';
    fila('Hora del teléfono', hora(principal.evento.hora_dispositivo), true);
    if (principal.evento.selfie_path) fila('Selfie', 'Guardada en el teléfono; se enviará con la checada');
  } else {
    icono.dataset.tipo = 'ok'; icono.textContent = '✓';
    $('checada-resultado-titulo').textContent = 'Registrado';
    const s = principal.r.servidor;
    $('checada-resultado-detalle').textContent = s ? 'El servidor recibió tu checada.' : 'Esta checada ya estaba registrada.';
    if (s) {
      fila('Hora oficial (servidor)', hora(s.hora_efectiva), true);
      fila('Zona', s.dentro_geocerca === null ? 'No aplica (teletrabajo)' : s.dentro_geocerca ? 'Dentro' : 'Fuera');
      if (s.distancia_sitio_m != null) fila('Distancia según el servidor', `${Math.round(s.distancia_sitio_m)} m`, true);
      fila('Selfie', principal.evento.selfie_path ? 'Enviada' : 'Sin selfie');
      if (s.motivos_revision?.length) fila('Quedó para revisión por', s.motivos_revision.map((m) => MOTIVOS[m] || m).join('; '));
    }
  }
}
