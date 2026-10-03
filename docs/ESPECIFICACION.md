# Especificación funcional — App de Asistencia v0.1

Fecha: 2 de octubre de 2026 · Organización piloto: Parques Alegres IAP · Arranque obligatorio: 1 de enero de 2027

## 1. Base legal que guía el diseño

| Requisito | Origen | Cómo lo cumple la app |
|---|---|---|
| Registrar electrónicamente inicio y fin de jornada de cada trabajador | LFT art. 132 fr. XXXIV (reforma DOF 1-may-2026, exigible 1-ene-2027) | Eventos `inicio_bloque` / `fin_bloque` por bloque, con hora del servidor |
| Valor probatorio del registro | Requiere convenio entre trabajador y patrón | Convenio firmado fuera de la app (pendiente PA); la app guarda versión de app y bitácora |
| Conservación de controles de asistencia | LFT art. 804 | Nada se borra; baja lógica de personas; conservar ≥ 1 año después de la baja |
| Entregar información a la autoridad | Inspección laboral | Reporte por periodo y persona (PDF y Excel) desde `v_jornada_diaria` |
| Datos personales (ubicación, imagen) | Ley de protección de datos personales | Aviso de privacidad (pendiente PA); GPS solo al checar; selfie sin biometría |
| Teletrabajo (bloque en casa, 50 % de la jornada) | LFT art. 330-A y siguientes | Modalidad `teletrabajo` por horario; validar domicilio es configurable hasta que el abogado decida |

Los lineamientos técnicos de la STPS no se habían publicado al 2-oct-2026. Todo umbral queda en `organizaciones.config`.

## 2. Estados de la jornada (máquina de estados del cliente)

Se calcula en `js/reglas.js` a partir de los eventos del día (locales + enviados), en orden de `hora`.

| Estado | Se llega con | Botón principal | Acciones secundarias |
|---|---|---|---|
| `sin_jornada` | inicio del día | **Iniciar bloque de {escritorio o campo}** (el que toque según horario y hora) | — |
| `en_bloque` | `inicio_bloque` | **Terminar bloque de {bloque}** | Iniciar comida/pausa · Registrar llegada a parque (solo campo) |
| `en_pausa` | `inicio_pausa` | **Regresar de la pausa** | — |
| `en_sitio` (subestado de campo) | `llegada_sitio` | se mantiene el del bloque | **Salir de {parque}** · Llegar a otro parque (cierra el anterior) |
| `entre_bloques` | `fin_bloque` con otro bloque pendiente hoy | **Iniciar bloque de {siguiente}** | Iniciar comida |
| `jornada_cerrada` | `fin_bloque` del último bloque programado | — (resumen del día) | Solicitar corrección |

Reglas:
- Al terminar un bloque estando en pausa: primero se registra `fin_pausa` automático **con confirmación** del usuario.
- Al terminar el bloque de campo estando en un parque: se registra `salida_sitio` antes de `fin_bloque`.
- Si a las 20:30 (fin de horario + 30 min, configurable) hay bloque abierto: notificación local "¿Olvidaste checar salida?" (HU-15).
- El bloque sugerido sale de `horarios`; si no hay horario cargado, la app pregunta "¿Qué bloque inicias?".

## 3. Flujo de checada (inicio/fin de bloque)

1. Usuario toca el botón principal.
2. **Ubicación**: `getCurrentPosition` con alta precisión; se muestran lecturas durante máx. 20 s y se guarda la de menor `accuracy`.
   Se puede confirmar antes si la precisión estimada ≤ 20 m.
3. **Sitio**: con `v_sitios_app` en caché local se calcula el sitio que contiene el punto (punto en polígono) o el más cercano
   a ≤ 500 m. Se muestra: nombre, distancia al perímetro, precisión estimada y si está dentro de la zona.
   - Bloque de campo fuera de zona: aviso amarillo + campo **Justificación** obligatorio para continuar.
   - Bloque de escritorio en modalidad `teletrabajo`: no se valida zona mientras `validar_domicilio = false`; se guarda la ubicación.
4. **Selfie**: cámara frontal en vivo, captura, vista previa, "Repetir" o "Usar". Si la cámara falla: `<input type="file" accept="image/*" capture="user">`.
5. **Confirmar** → se arma el evento y se intenta enviar (sección 5). La pantalla muestra "Registrado" o "Guardado en el teléfono; se enviará al tener señal".

Las pausas (`inicio_pausa`/`fin_pausa`) y las visitas (`llegada_sitio`/`salida_sitio`) usan el mismo flujo **sin selfie** (configurable).

## 4. Geocerca en el cliente (`js/geo.js`)

- Punto en polígono por *ray casting* sobre el GeoJSON (MultiPolygon, anillos exteriores e interiores).
- Distancia a perímetro: mínima distancia del punto a cada segmento, en metros, con proyección equirectangular local
  (suficiente a escala de parque).
- Dentro de zona si: dentro del polígono, o distancia ≤ `tolerancia_m` + min(precisión, 50).
  Sin polígono: distancia al centro ≤ `radio_m` + min(precisión, 50).
- Es solo informativo; **la decisión que cuenta la toma el servidor** (`preparar_evento`).
- Caché de sitios: se descarga al iniciar sesión y una vez al día (≈160 KB para 782 parques) y se guarda en IndexedDB.

## 5. Cola offline y sincronización (`js/cola.js`)

Almacén IndexedDB `asistencia` con tiendas:
- `eventos_pendientes` (clave `id`): `{ evento, selfieBlob|null, intentos, ultimoError, creadoEn }`
- `eventos_locales` (clave `id`): copia de todo lo capturado en los últimos 35 días, para la pantalla del día e historial sin señal
- `sitios` (clave `id`) y `meta` (versión de caché de sitios, perfil, horarios)

Envío de un pendiente:
1. Si hay selfie: `storage.from('selfies').upload(ruta, blob, { upsert: false })`. Si responde "ya existe" (409), se considera subida.
2. `from('eventos_jornada').upsert(evento, { onConflict: 'id', ignoreDuplicates: true })`.
3. Éxito → se borra de `eventos_pendientes` y se marca como enviado en `eventos_locales`.
4. Error de red → `intentos++`, reintento con espera creciente (30 s, 1, 2, 5, 10 min). Error de permisos/validación → se marca para soporte y se muestra al usuario.

Disparadores: al capturar, evento `online`, `visibilitychange` a visible, cada 60 s con la app abierta, y Background Sync donde exista.
Indicador fijo en la barra: "Todo enviado" / "N por enviar".

## 6. Selfie (`js/camara.js`)

- `getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } } })`.
- Se dibuja en canvas a 480 px de ancho, se exporta `image/webp` calidad 0.6; si el navegador no soporta WebP (algunos iOS), `image/jpeg` 0.6.
- Objetivo ≤ 60 KB; si excede, se reduce calidad hasta 0.4. Límite del bucket: 150 KB.
- Se apaga la cámara en cuanto se captura o se cancela.

## 7. Pantallas del asesor (ver `docs/maqueta.png`)

1. **Inicio**: saludo, organización, tarjeta "Jornada de hoy" (horas efectivas vs. programadas, estado En regla / Retardo / Revisar),
   lista de bloques del día, botón principal, indicador de envío.
2. **Checada**: mapa esquemático simple (SVG propio con el polígono y el punto, sin teselas para que funcione offline), datos de sitio,
   distancia, precisión estimada, hora; selfie; confirmar.
3. **Visitas**: recorrido del día por parque con hora de llegada/salida y estado de envío; "Registrar llegada a otro parque"; "Terminar jornada".
4. **Historial**: días anteriores con horas efectivas; detalle por evento; **descarga de mi registro** (CSV/PDF) — derecho del trabajador a conocer su registro.
5. **Perfil**: nombre, organización, horario vigente, versión de la app, cerrar sesión, solicitar corrección (incidencia).

## 8. Panel de coordinación (`panel.html`, Sprint 3)

- Tarjetas: en jornada ahora / total, % checadas dentro de zona (semana), incidencias por revisar, parques visitados hoy.
- Tabla del día por persona: entrada, sitio actual, horas, estado (En regla, Retardo, Revisar, Sin checar).
- Bandeja de eventos `estado_revision = 'revisar'` con motivos y selfie (URL firmada de 60 s).
- Incidencias: aprobar / rechazar con comentario. Nadie aprueba las suyas (lo impide la base de datos).
- Reportes: periodo + persona(s) → PDF para autoridad y Excel/CSV para nómina (horas ordinarias y extras por semana: Sprint 4).

## 9. Acceso

- Correo + contraseña (Supabase Auth). Sesión persistente en el teléfono.
- Alta de personas en el Sprint 1: desde el panel de Supabase (Authentication → Add user) + fila en `miembros`.
  Una Edge Function `alta-persona` puede sustituirlo después (HU-09).
- No se usa correo mágico en el plan gratuito: el envío de correos de Supabase tiene un límite muy bajo por hora.

## 10. Pendientes que dependen de Parques Alegres (no bloquean el desarrollo)

| Tema | Mientras tanto |
|---|---|
| Reglas de jornada (tolerancia, extras, comida) | Valores por defecto en `organizaciones.config` |
| ¿El bloque en casa es teletrabajo? ¿Se valida el domicilio? | `validar_domicilio = false`; se guarda ubicación sin juzgarla |
| Coordenadas de la oficina | Sitio `oficina` comentado en el seed |
| Lista de asesores y horarios | Usuarios ficticios |
| Sistema de nómina | Exportación CSV genérica |
| Lineamientos STPS | Revisión en cada Sprint Review |
