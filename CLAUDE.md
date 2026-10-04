# CLAUDE.md — App de Asistencia (registro electrónico de jornada)

Contexto técnico para Claude Code. Léelo completo antes de tocar código.
Este repositorio es **público** (GitHub Pages): aquí solo va código y documentación técnica.
El contexto de negocio, el seed de datos y cualquier documento interno viven en Google Drive.

## Qué es

PWA para que los **asesores de Parques Alegres IAP** (Culiacán, Sinaloa; ~15 asesores, menos de 30 usuarios)
registren su jornada laboral desde su **celular personal** y cumplan el **art. 132, fracción XXXIV de la LFT**
(registro electrónico de inicio y fin de jornada, obligatorio desde el **1 de enero de 2027**).

- Jornada partida típica: **9:00–13:00 escritorio** (casi siempre en casa, a veces oficina) y
  **16:00–20:00 campo** recorriendo varios parques. Comida variable.
- Verificación al checar: **GPS + geocerca del sitio + selfie** (sin reconocimiento facial).
- Debe funcionar **sin señal** (parques sin datos móviles) y sincronizar después.
- Diseñada para **varias organizaciones**: después se replicará a otras IAP de Fundación GC1.
- Desarrolla Ecosistémica (Ing. Jesús Raúl López Zazueta) como proveedor externo, con Scrum (sprints de 2 semanas).

Usuarios y roles: `asesor` (checa), `coordinador` (panel, aprueba incidencias), `admin` (configura organización, sitios, personas).

## Stack (decidido, no cambiar sin acuerdo)

| Capa | Decisión |
|---|---|
| Front | HTML + CSS + **JavaScript puro con ES modules**. Sin frameworks, sin build, sin npm en producción |
| Back | **Supabase**: Postgres 15+ con PostGIS, Auth, Storage, RLS. Plan gratuito en desarrollo y piloto; Pro antes del 1-ene-2027 |
| Cliente Supabase | `vendor/supabase.js` (supabase-js v2, versión fijada, descargada a mano del CDN y cacheada por el service worker) |
| Offline | Service worker (cache-first para el shell) + **IndexedDB** para la cola de eventos y selfies pendientes |
| Hosting | GitHub Pages |
| Pruebas | Playwright (Chromium) a **375×812**; pruebas SQL con `supabase/tests/correr_pruebas.sh` |

Zona horaria de negocio: `America/Mazatlan`. Idioma de la interfaz: español de México.

## Estructura objetivo

```
index.html            app del asesor (checada, jornada del día, visitas, historial)
panel.html            panel de coordinación (Sprint 3)
manifest.json  sw.js  config.js (URL y llave pública de Supabase; ver config.example.js)
css/app.css           tokens de marca + componentes
js/app.js             arranque, ruteo por pestañas, estado de la jornada
js/api.js             todo acceso a Supabase (única puerta)
js/cola.js            cola offline en IndexedDB + sincronización
js/geo.js             lectura de GPS, punto-en-polígono, distancia
js/camara.js          selfie: getUserMedia frontal → WebP/JPEG ≤ 60 KB
js/reglas.js          máquina de estados de la jornada y textos del botón principal
vendor/supabase.js
supabase/migrations/  SQL versionado (0001_…, 0002_…)
supabase/tests/       pruebas SQL locales (stub de Supabase)
tests/                Playwright
docs/                 especificación, backlog técnico, maqueta
```

## Modelo de datos (resumen; la verdad está en `supabase/migrations/0001_esquema_inicial.sql`)

- `organizaciones` (config jsonb con reglas: tolerancias, radio, desfase, selfie, `validar_domicilio`)
- `miembros` (liga `auth.users` ↔ organización, rol, alta/baja lógica)
- `sitios` (parque | oficina | domicilio | otro; `centro` punto, `perimetro` multipolígono, `radio_m`)
- `horarios` (día ISO, bloque escritorio/campo, modalidad presencial/teletrabajo)
- `eventos_jornada` **solo-inserción**: `inicio_bloque`, `fin_bloque`, `inicio_pausa`, `fin_pausa`, `llegada_sitio`, `salida_sitio`
- `incidencias` (corrección sin borrar; al aprobarse genera un evento con `origen='incidencia'`)
- `bitacora` (auditoría automática)
- Vistas: `v_jornada_diaria` (minutos efectivos; la comida entre bloques no resta), `v_sitios_app` (GeoJSON para validar sin conexión)
- Storage: bucket privado `selfies`, ruta `{organizacion_id}/{miembro_id}/{yyyy}/{mm}/{evento_id}.webp`

El trigger `preparar_evento` fija en el servidor: organización (la del miembro), `hora_servidor`, `hora_efectiva`,
`desfase_seg`, sitio más cercano, distancia, `dentro_geocerca`, `estado_revision` y `motivos_revision`
(`fuera_de_geocerca`, `sin_ubicacion`, `sin_selfie`, `reloj_desfasado`, `hora_futura`, `sin_conexion_prolongada`).
**El cliente no calcula nada de esto para guardarlo**; solo lo calcula para mostrarlo.

## Reglas no negociables

1. **Nunca** `update` ni `delete` sobre `eventos_jornada`, `bitacora`, selfies. Las correcciones son incidencias.
2. El `id` de cada evento lo genera el teléfono (`crypto.randomUUID()`) y se inserta con
   `upsert(..., { onConflict: 'id', ignoreDuplicates: true })` para que reintentar sea seguro.
3. Si el primer intento de envío falla, el evento se guarda con `capturado_sin_conexion: true`
   y su `hora_dispositivo`; si se envía al momento, va con `false`.
4. GPS **solo en el momento de checar** (getCurrentPosition con `enableHighAccuracy`, timeout 20 s, se queda con la mejor
   lectura en ese lapso). Prohibido el rastreo continuo o en segundo plano.
5. Selfie solo como evidencia: **sin reconocimiento facial**, sin análisis biométrico.
6. Todo cambio de esquema = nueva migración numerada + prueba en `supabase/tests/`. Nunca editar una migración ya aplicada.
7. Nada de llaves `service_role`, datos reales de personas, el seed de parques ni documentos internos en este repo.
   La llave `anon` sí puede estar en `config.js` (es pública por diseño; la seguridad está en RLS).
8. Sin datos reales de asesores (selfies, ubicaciones) hasta que Parques Alegres firme el aviso de privacidad y el convenio.
   Para probar se usan usuarios ficticios.
9. Lo que depende de decisiones de Parques Alegres (tolerancias, radios, domicilio, horarios, extras) es **configurable**
   en `organizaciones.config` u `horarios`; no se escribe en el código.
10. Terminología: "precisión estimada" (no "precisión efectiva"). No usar la frase "regla de oro" en ningún texto.

## Interfaz

- Un botón principal grande cuyo texto depende del estado (ver `docs/ESPECIFICACION.md`, sección Estados).
- Checar en menos de 30 segundos. Áreas táctiles ≥ 44 px, texto ≥ 13 px, contraste AA.
- Maqueta de referencia: `docs/maqueta.png`.
- Tokens de marca Ecosistémica (tema por defecto; cada organización podrá cambiar `color_primario`):

```css
--verde:#14503A;   /* primario, botones */      --follaje:#3F6B57; /* texto secundario */
--grafito:#191D1B; /* texto */                  --hueso:#F4F2EC;   /* fondo */
--salvia:#7E9A76;  /* gráficos, no texto */     --arena:#C2A167;   /* acento, no texto */
--agua:#2A7377;    --tierra:#9A5836;            /* series de datos / acción secundaria */
/* Estados (excepción a la paleta): ok #43A047 · aviso #F4B400 · crítico #E53935 */
```

  Tipografía: IBM Plex Sans (400/500/600) y IBM Plex Mono para horas, coordenadas, IDs.
  Empaquetar las fuentes en `/fonts` (licencia SIL OFL) para que funcionen offline.

## Versionado y publicación

- `CACHE_VERSION` en `sw.js` con formato `asis-AAAA-MM-DD-vNN`; súbelo en cada versión y documenta el cambio en el
  comentario de cabecera de `sw.js` (una línea por versión, en español).
- Un commit por versión con mensaje en español. Rama `main` publica a GitHub Pages.

## Definition of Done (por historia)

- Funciona en Chromium móvil a 375×812 y no rompe en Safari iOS (revisar APIs: WebP, getUserMedia, Background Sync).
- Funciona **con y sin conexión** (Playwright `context.setOffline(true)`), con GPS simulado (`context.setGeolocation`) y cámara falsa
  (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`).
- Si tocó SQL: `supabase/tests/correr_pruebas.sh` pasa.
- No permite borrar ni editar registros; respeta la separación entre organizaciones.
- Textos revisados en español, sin anglicismos innecesarios.

## Forma de trabajo

- Scrum: el backlog técnico está en `docs/BACKLOG_TECNICO.md`. Trabaja **una historia a la vez**, en orden, y al terminar cada una
  reporta qué cambió, cómo se probó y qué queda pendiente.
- Antes de cambios grandes, propone el plan en 3–6 líneas y espera confirmación.
- Raúl no programa: explica decisiones técnicas en lenguaje sencillo y sin jerga.
- Si una historia depende de una decisión de Parques Alegres, hazla configurable y anótalo como pendiente; no la bloquees.
