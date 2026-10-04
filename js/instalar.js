// Guía de instalación de una página con código QR (HU-35). Sin sesión ni datos de personas: se puede imprimir y pegar.
// El QR apunta a la dirección donde está publicada la app (la misma carpeta de esta página), nunca escrita a mano.
// ?org=Nombre muestra el nombre de la organización en el encabezado.

// Matriz del QR (qrcode-generator, vendor/qrcode.js) → SVG con un solo trazo, nítido al imprimir
export function svgQR(texto, { margen = 4 } = {}) {
  const qr = window.qrcode(0, 'M');   // versión automática, corrección de errores media
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  let trazo = '';
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if (qr.isDark(f, c)) trazo += `M${c + margen} ${f + margen}h1v1h-1z`;
  const lado = n + margen * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges">`
    + `<rect width="${lado}" height="${lado}" fill="#fff"/><path d="${trazo}" fill="#191D1B"/></svg>`;
}

export function direccionApp(href = location.href) {
  return new URL('./', href).href;
}

function iniciar() {
  const url = direccionApp();
  document.getElementById('guia-url').textContent = url;
  document.getElementById('guia-codigo').innerHTML = svgQR(url);
  const org = new URLSearchParams(location.search).get('org');
  if (org) document.getElementById('guia-org').textContent = `${org} · Registro electrónico de jornada`;
  document.getElementById('guia-imprimir').addEventListener('click', () => window.print());
}

// vendor/qrcode.js se carga con defer, antes que este módulo
if (typeof document !== 'undefined' && document.getElementById('guia-codigo')) iniciar();
