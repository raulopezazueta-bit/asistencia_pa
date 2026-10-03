# Backlog técnico — App de Asistencia

Derivado del product backlog (38 historias). Aquí solo está lo que construye la sesión de código, en orden.
Los IDs `HU-xx` coinciden con el backlog maestro. Estado al 2-oct-2026: **HU-06 (modelo de datos) hecho** en
`supabase/migrations/0001_esquema_inicial.sql`, con pruebas en `supabase/tests/`.

Leyenda: ☐ pendiente · ◐ en curso · ☑ terminado (al cerrar, poner la versión `vNN`)

---

## Sprint 1 · Plataforma y checada en línea (adelantado: arranca en cuanto exista el proyecto Supabase)

**Objetivo:** un asesor de prueba inicia sesión, ve su jornada del día y registra inicio y fin de bloque con GPS y geocerca, en línea.

| Estado | ID | Historia | Criterios de aceptación |
|---|---|---|---|
| ☑ v01 | T-01 | Esqueleto PWA | `index.html`, `manifest.json`, `sw.js` (`asis-AAAA-MM-DD-v01`), `css/app.css` con tokens, fuentes IBM Plex locales, íconos. Instalable en Android; Lighthouse PWA sin errores |
| ☐ | HU-08 | Inicio de sesión | Correo + contraseña; sesión persistente; si el usuario no tiene fila activa en `miembros`, mensaje claro y cierre de sesión; selector si pertenece a 2 organizaciones |
| ☐ | HU-07 | Verificar separación | Prueba Playwright o SQL que confirme que un usuario de `iap-demo` no ve datos de `parques-alegres` (ya cubierto en SQL; agregar prueba e2e mínima) |
| ☐ | HU-10 | Sitios en caché | Descarga `v_sitios_app` al iniciar sesión y una vez al día; guarda en IndexedDB; búsqueda por nombre o clave; funciona sin señal |
| ☐ | HU-12 | Botón principal y estado del día | `js/reglas.js` implementa la tabla de estados de `docs/ESPECIFICACION.md` §2 con pruebas unitarias (casos: día normal, olvido de fin, pausa abierta, sin horario) |
| ☐ | HU-17 | Checada con GPS y geocerca | Flujo §3 pasos 1–3 y 5 (sin selfie aún); punto en polígono en cliente; justificación obligatoria fuera de zona en bloque de campo; el evento llega a Supabase y el servidor coincide con el cálculo del cliente en 3 casos de prueba |
| ☐ | HU-09a | Alta manual documentada | `docs/ALTA_PERSONAS.md`: pasos en el panel de Supabase para crear usuario + fila en `miembros` + horario |

**Demo de Sprint Review:** en un celular real, checar entrada y salida dentro de un parque del catálogo y ver los eventos en Supabase con `dentro_geocerca = true`.

## Sprint 2 · Verificación completa y modo sin señal

| Estado | ID | Historia | Criterios de aceptación |
|---|---|---|---|
| ☐ | HU-18 | Selfie | §6; ≤ 60 KB; sube a `selfies/{org}/{miembro}/{yyyy}/{mm}/{id}.webp`; respaldo con input de archivo; cámara se apaga al terminar |
| ☐ | HU-22 | Cola offline | §5 completo; prueba Playwright: checar sin conexión, recargar la app, volver a tener conexión y ver el evento en el servidor con `capturado_sin_conexion = true` y `hora_efectiva = hora_dispositivo` |
| ☐ | HU-19 | Hora doble | Indicador al usuario si el reloj del teléfono difiere > 10 min de la hora del servidor (obtenida al iniciar sesión) |
| ☐ | HU-13 | Pausas | Inicio/fin de comida; cierre automático confirmado al terminar bloque |
| ☐ | HU-20 | Bloque de escritorio en teletrabajo | Modalidad desde `horarios`; sin validación de zona mientras `validar_domicilio = false` |
| ☐ | HU-33 | Inalterabilidad verificada | Prueba e2e: intentar `update`/`delete` con la llave pública falla; la interfaz no ofrece editar ni borrar |
| ☐ | HU-14 | Mis horas | Horas del día y de la semana desde `v_jornada_diaria` + eventos locales no enviados |

## Sprint 3 · Visitas, panel e incidencias

| Estado | ID | Historia | Criterios de aceptación |
|---|---|---|---|
| ☐ | HU-24 | Visitas a parques | Llegada/salida por parque; llegar a otro parque cierra el anterior; pantalla Visitas §7.3 |
| ☐ | HU-27 | Panel de coordinación | `panel.html` §8 (tarjetas + tabla del día) solo para `coordinador`/`admin` |
| ☐ | HU-28/29 | Incidencias | Asesor solicita con motivo (≥ 5 caracteres); coordinación aprueba/rechaza; el evento corregido aparece con `origen = 'incidencia'` |
| ☐ | HU-23 | Bandeja de revisión | Lista de eventos `revisar` con motivos y selfie (URL firmada) |
| ☐ | HU-31 | Reporte para autoridad | PDF por periodo y persona: datos de la organización, persona, cada día con inicio, fin, bloques, pausas, minutos efectivos y marcas de revisión/incidencia |
| ☐ | HU-16 | Mi registro | El asesor consulta y descarga su historial (CSV y PDF) |
| ☐ | HU-15 | Recordatorio de salida | Notificación local si el bloque sigue abierto 30 min después del fin programado |

## Sprint 4 en adelante (referencia)

HU-25 mapa de visitas (Leaflet, solo panel) · HU-30 alertas · HU-32 horas ordinarias/extras para nómina · HU-34 respaldos y conservación ·
HU-35 instalación con QR + guía de 1 página · HU-36 piloto con 5 asesores · HU-11 marca por organización · HU-38 manual de réplica para otras IAP.
