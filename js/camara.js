// Selfie de evidencia (HU-18, docs/ESPECIFICACION.md §6).
// Solo se toma y se guarda la foto: SIN reconocimiento facial ni análisis biométrico de ningún tipo.
// Cámara frontal en vivo → canvas a 480 px → WebP 0.6 (JPEG si el navegador no hace WebP) → ≤ 60 KB.

export const ANCHO_PX = 480;
export const OBJETIVO_BYTES = 60 * 1024;
export const LIMITE_BUCKET_BYTES = 150000;   // file_size_limit del bucket "selfies"

// Abre la cámara frontal y la muestra en <video>. Devuelve { capturar(), apagar() }.
export async function abrir(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('Sin cámara'), { name: 'NotSupportedError' });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');   // iOS: sin pantalla completa
  video.muted = true;
  await video.play().catch(() => {});
  const apagar = () => {
    for (const pista of stream.getTracks()) pista.stop();
    video.srcObject = null;
  };
  return {
    apagar,
    async capturar() {
      if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
      const foto = await comprimir(video, video.videoWidth, video.videoHeight);
      apagar();   // la cámara se apaga en cuanto se captura
      return foto;
    }
  };
}

// Respaldo: foto tomada con <input type="file" capture="user"> (cuando la cámara en vivo no funciona).
export async function desdeArchivo(archivo) {
  const img = await cargarImagen(archivo);
  try {
    return await comprimir(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
  } finally {
    if (img.src?.startsWith('blob:')) URL.revokeObjectURL(img.src);
  }
}

function cargarImagen(archivo) {
  return new Promise((ok, falla) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => falla(new Error('No se pudo leer la imagen'));
    img.src = URL.createObjectURL(archivo);
  });
}

function aBlob(canvas, tipo, calidad) {
  return new Promise((ok) => canvas.toBlob((b) => ok(b), tipo, calidad));
}

// Dibuja a 480 px de ancho y exporta. WebP si el navegador lo genera de verdad (algunos iOS devuelven PNG);
// si no, JPEG. Baja la calidad de 0.6 a 0.4 hasta quedar en ≤ 60 KB.
export async function comprimir(fuente, ancho, alto) {
  if (!ancho || !alto) throw new Error('Imagen vacía');
  const escala = Math.min(1, ANCHO_PX / ancho);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(ancho * escala);
  canvas.height = Math.round(alto * escala);
  canvas.getContext('2d').drawImage(fuente, 0, 0, canvas.width, canvas.height);

  const prueba = await aBlob(canvas, 'image/webp', 0.6);
  const tipo = prueba?.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  let blob = tipo === 'image/webp' ? prueba : await aBlob(canvas, tipo, 0.6);
  for (const calidad of [0.5, 0.4]) {
    if (blob.size <= OBJETIVO_BYTES) break;
    blob = await aBlob(canvas, tipo, calidad);
  }
  if (blob.size > LIMITE_BUCKET_BYTES) throw new Error('La foto sigue siendo demasiado grande');
  return { blob, tipo, extension: tipo === 'image/webp' ? 'webp' : 'jpg', ancho: canvas.width, alto: canvas.height };
}
