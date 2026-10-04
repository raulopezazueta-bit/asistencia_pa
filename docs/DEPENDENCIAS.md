# Dependencias de terceros

La app publicada **no usa npm**: el celular solo descarga los archivos de este repositorio.
El código de terceros que corre en el teléfono es `vendor/supabase.js` y, solo en la guía de instalación
(`instalar.html`), `vendor/qrcode.js`.

## Archivos de terceros que llegan al teléfono

| Archivo | Versión | Origen | Licencia |
|---|---|---|---|
| `vendor/supabase.js` | supabase-js 2.117.2 (UMD) | paquete npm `@supabase/supabase-js@2.117.2`, archivo `dist/umd/supabase.js` | MIT |
| `vendor/qrcode.js` | qrcode-generator 1.4.4 | paquete npm `qrcode-generator@1.4.4`, archivo `qrcode.js` (con línea de cabecera) | MIT |
| `fonts/ibm-plex-sans-latin-{400,500,600}-normal.woff2` | 5.3.0 | paquete npm `@fontsource/ibm-plex-sans@5.3.0` | SIL OFL 1.1 (`fonts/OFL.txt`) |
| `fonts/ibm-plex-mono-latin-{400,500}-normal.woff2` | 5.3.0 | paquete npm `@fontsource/ibm-plex-mono@5.3.0` | SIL OFL 1.1 |

**Huellas digitales (SHA-256):** `vendor/HUELLAS.sha256`. La prueba `tests/huellas.spec.js` falla si alguno
de estos archivos cambia sin actualizar su huella. Para verificar a mano: `sha256sum -c vendor/HUELLAS.sha256`.

### Cómo actualizar supabase-js (a mano y a propósito)
1. Revisar las notas de la versión nueva.
2. `npm pack @supabase/supabase-js@X.Y.Z`, extraer `package/dist/umd/supabase.js` a `vendor/supabase.js`
   y poner la línea de cabecera con la versión.
3. Regenerar huellas: `sha256sum vendor/supabase.js fonts/*.woff2 > vendor/HUELLAS.sha256`.
4. Correr todas las pruebas, subir `CACHE_VERSION` y anotar el cambio en este archivo.

## Herramientas de desarrollo (nunca llegan al teléfono)

| Paquete | Versión | Para qué |
|---|---|---|
| `@playwright/test` | 1.56.1 (exacta, con `package-lock.json`) | pruebas automáticas |
| `jsqr` | 1.4.0 (exacta) | leer el código QR de la guía en las pruebas (HU-35) |

`.npmrc` impide que npm ejecute programas de instalación (`ignore-scripts=true`) y fija versiones exactas.
Instalar siempre con `npm ci` (respeta el `package-lock.json` al pie de la letra).
