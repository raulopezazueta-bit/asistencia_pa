# Avisos con la app cerrada (HU-15b y HU-30)

Qué hace:

- **Al asesor:** "¿Olvidaste checar salida?" si un bloque sigue abierto 30 minutos después de su hora de fin
  (`recordatorio_salida_min`). Es el mismo aviso que ya da la app abierta, pero ahora llega aunque esté cerrada.
- **A coordinación y administración** (un solo aviso que agrupa lo nuevo):
  - "No ha iniciado…": pasaron 30 minutos desde el inicio de un bloque programado y la persona no ha checado
    (`aviso_sin_checar_min`). Solo mientras el bloque no termina.
  - "No ha cerrado…": el bloque sigue abierto 60 minutos después de su fin (`aviso_coord_bloque_abierto_min`).
  - Nunca recibes avisos sobre ti. Si en la organización hay varias personas de coordinación, todas reciben los
    avisos (la que activó los avisos en su teléfono).
- Cada aviso se manda **una sola vez** por persona, bloque y día. Los días sin horario (p. ej. sábado) no hay avisos.
- Los minutos se cambian por organización en `organizaciones.config` (ver abajo). No están escritos en el código.

Cómo funciona, en sencillo: cada teléfono que activa los avisos deja en Supabase su "dirección de avisos"
(no es su ubicación ni su número; es una dirección que da el navegador). Un reloj de Supabase revisa cada 5
minutos quién necesita aviso y la función `avisos` lo envía. **El GPS no se usa para nada de esto.**

Teléfonos:

- **Android (Chrome):** funciona con la app instalada o abierta desde el navegador.
- **iPhone:** solo con la app **agregada a la pantalla de inicio** y iOS 16.4 o más.
- Cada persona activa los avisos en **Perfil › Recordatorio de salida › Activar**. Con el permiso dado, el teléfono
  se registra solo. Después aparece **Probar aviso**.
- Al **cerrar sesión**, ese teléfono deja de recibir avisos de esa cuenta.

---

## Lo que toca hacer una sola vez en Supabase (3 pasos)

### Paso 1 · Aplicar la migración 0005

**SQL Editor › New query**: pega todo `supabase/migrations/0005_avisos.sql` › **Run**. Debe decir "Success".

### Paso 2 · Publicar la función `avisos`

Igual que `alta-persona` (ver `docs/ALTA_PERSONAS.md`):

1. **Edge Functions › Deploy a new function › Via Editor**.
2. Nombre: `avisos` (exacto). **Escríbelo antes de publicar**: si queda con el nombre que propone el editor
   (p. ej. `quick-task`), la dirección no sirve y hay que crearla de nuevo.
3. Borra el `index.ts` de ejemplo y pega `supabase/functions/avisos/index_un_archivo.ts`.
4. **Deploy function**.
5. En sus ajustes, desactiva **"Verify JWT with legacy secret"** (o "Enforce JWT verification"). La función revisa
   por su cuenta quién la llama.
6. Abre en el navegador `https://kkaaaaifzyjnafvmfdqe.supabase.co/functions/v1/avisos`. La primera vez la función
   crea sola sus llaves y la contraseña del reloj (nadie tiene que copiar llaves).

| Lo que muestra | Qué significa | Qué hacer |
|---|---|---|
| `{"funcion":"avisos","publicada":true,"llave_secreta":true,"claves_listas":true}` | Todo bien | Seguir al paso 3 |
| `"llave_secreta":false` | No encuentra su llave secreta | Avisar a Ecosistémica |
| `NOT_FOUND` | No está publicada o tiene otro nombre | Publicarla como `avisos` |
| 401 / "Missing authorization header" | La verificación de JWT sigue activada | Desactivarla (punto 5) |
| `{"error":"No se pudo completar…"}` | Falta la migración 0005 | Paso 1 |

### Paso 3 · Encender el reloj (cada 5 minutos)

**SQL Editor › New query**, pega y **Run** (una sola vez):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'avisos-cada-5-min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://kkaaaaifzyjnafvmfdqe.supabase.co/functions/v1/avisos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-token-cron', (select token_cron from public.claves_push where id = 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
```

La contraseña del reloj no se copia: el reloj la lee cada vez de la tabla `claves_push`, que la app no puede ver.

**Comprobar** (10 minutos después):

```sql
-- ¿El reloj corre? (status = succeeded)
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
-- ¿Qué contestó la función? (status_code 200 y un resumen como {"avisos":0,"enviados":0,…})
select status_code, content, created from net._http_response order by created desc limit 5;
```

Un 401 en la primera vuelta es normal si las llaves todavía no existían (se crean en ese momento); la siguiente vuelta
ya sale 200. Si sigue en 401, abre la dirección de la función (paso 2.6) y espera otros 5 minutos.

**Apagar el reloj** (si hiciera falta): `select cron.unschedule('avisos-cada-5-min');`

---

## Prueba en el teléfono

1. Actualiza la app (versión **v29** en Perfil).
2. Perfil › Recordatorio de salida › **Activar** › Permitir. Debe decir "Con la app cerrada: activado en este teléfono".
3. **Probar aviso** › cierra la app. En unos segundos llega "Avisos activados".
4. Prueba real: con un usuario ficticio, inicia un bloque y no lo cierres. 30 minutos después de su hora de fin
   llega "¿Olvidaste checar salida?" al asesor; a los 60 minutos, "Coordinación: 1 pendiente" a coordinación.

## Configuración (por organización)

En `organizaciones.config` (valores por defecto entre paréntesis):

| Clave | Para qué |
|---|---|
| `recordatorio_salida_min` (30) | Minutos después del fin para avisar al asesor |
| `aviso_sin_checar_min` (30) | Minutos después del inicio sin checada para avisar a coordinación |
| `aviso_coord_bloque_abierto_min` (60) | Minutos después del fin con el bloque abierto para avisar a coordinación |

Ejemplo: `update public.organizaciones set config = config || '{"aviso_sin_checar_min": 20}' where slug = 'parques-alegres';`

## Pendientes que dependen de Parques Alegres

- Confirmar los minutos (30 / 30 / 60) y si administración también debe recibir las alertas de coordinación
  (hoy sí; quien no las quiera, no activa los avisos en su teléfono).
- Horario de silencio (no avisar de noche), si se quiere.
