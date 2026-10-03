# Alta de personas (manual, desde el panel de Supabase)

Guía para **administración** (HU-09a). Mientras no exista la función `alta-persona` (HU-09), el alta se hace a mano
en el panel de Supabase en tres pasos: **usuario → miembro → horario**. Toma unos 5 minutos por persona.

> **Antes de dar de alta a personas reales:** Parques Alegres debe haber firmado el aviso de privacidad y el
> convenio del registro electrónico. Hasta entonces, usa solo usuarios de prueba (por ejemplo `asesor1@prueba.test`).

Todos los bloques de SQL de esta guía se pegan en **SQL Editor → New query → Run**. Cambia solo lo que está
entre comillas en la parte de `datos` de cada bloque. La persona se identifica siempre por su **correo**.

---

## Paso 1 · Crear el usuario (correo y contraseña)

1. En el panel de Supabase, abre **Authentication → Users**.
2. Toca **Add user → Create new user**.
3. Escribe el **correo** de la persona y una **contraseña provisional** de al menos 8 caracteres.
4. Deja marcada la casilla **Auto Confirm User**. Sin ella, la persona no podrá entrar hasta confirmar su correo,
   y el plan gratuito de Supabase envía muy pocos correos por hora.
5. Toca **Create user**.

Entrega la contraseña en persona o por un medio privado, nunca en un grupo.

## Paso 2 · Ligar el usuario con la organización (fila en `miembros`)

Sin esta fila, la app dice *"Tu cuenta existe, pero no tiene un alta activa en ninguna organización"* y cierra la sesión.

```sql
-- PASO 2 · Alta en miembros. Cambia los 5 valores de "datos".
with datos as (
  select 'parques-alegres'                        as organizacion,   -- slug de la organización
         'correo@de.la.persona'                   as correo,         -- el correo del paso 1
         'Nombre Apellido Apellido'               as nombre,
         'PA-000'                                 as num_empleado,   -- opcional: deja '' si no hay
         'asesor'                                 as rol             -- asesor | coordinador | admin
)
insert into public.miembros (organizacion_id, user_id, nombre_completo, num_empleado, rol)
select o.id, u.id, d.nombre, nullif(d.num_empleado, ''), d.rol
from datos d
join public.organizaciones o on o.slug = d.organizacion
join auth.users u on lower(u.email) = lower(trim(d.correo))
returning id as miembro_id, nombre_completo, rol;
```

Si sale un error:
- `duplicate key … organizacion_id, user_id`: esa persona ya está dada de alta en esa organización.
- `0 rows`: el correo no coincide con ningún usuario del paso 1, o el slug de la organización está mal escrito.
  Revísalos con `select email from auth.users;` y `select slug, nombre from organizaciones;`.

## Paso 3 · Cargar su horario

El horario le dice a la app qué bloque toca a cada hora y cuántas horas están programadas.
El ejemplo es la jornada partida típica (lunes a viernes): **escritorio 9:00–13:00 en teletrabajo** y **campo 16:00–20:00**.
Ajusta días, horas y modalidad a lo que acuerde Parques Alegres.

```sql
-- PASO 3 · Horario semanal. Cambia los valores de "datos" y, si hace falta, la lista de bloques.
with datos as (
  select 'parques-alegres'        as organizacion,
         'correo@de.la.persona'   as correo,
         current_date             as vigente_desde      -- desde cuándo aplica
),
dias as (select generate_series(1, 5) as dia),          -- 1 = lunes … 5 = viernes (6 = sábado, 7 = domingo)
bloques (bloque, hora_inicio, hora_fin, modalidad) as (values
  ('escritorio', time '09:00', time '13:00', 'teletrabajo'),   -- 'presencial' si es en oficina
  ('campo',      time '16:00', time '20:00', 'presencial')
)
insert into public.horarios (organizacion_id, miembro_id, dia_semana, bloque, hora_inicio, hora_fin, modalidad, vigente_desde)
select m.organizacion_id, m.id, dias.dia, b.bloque, b.hora_inicio, b.hora_fin, b.modalidad, d.vigente_desde
from datos d
join public.organizaciones o on o.slug = d.organizacion
join auth.users u on lower(u.email) = lower(trim(d.correo))
join public.miembros m on m.organizacion_id = o.id and m.user_id = u.id
cross join dias
cross join bloques b
returning dia_semana, bloque, hora_inicio, hora_fin, modalidad;
```

Debe responder 10 filas (5 días × 2 bloques). Si responde 0, el paso 2 no se hizo o el correo está mal escrito.

Si la persona no tiene horario fijo, puedes omitir este paso: la app le preguntará *"¿Qué bloque inicias?"* al checar.

## Paso 4 · Comprobar

```sql
-- PASO 4 · Revisión de la persona
select o.nombre as organizacion, m.nombre_completo, m.rol, m.activo,
       u.email, u.email_confirmed_at is not null as correo_confirmado,
       (select count(*) from public.horarios h where h.miembro_id = m.id
          and (h.vigente_hasta is null or h.vigente_hasta >= current_date)) as bloques_de_horario
from public.miembros m
join public.organizaciones o on o.id = m.organizacion_id
join auth.users u on u.id = m.user_id
where u.email = 'correo@de.la.persona';
```

Debe salir `activo = true`, `correo_confirmado = true` y los bloques del horario. Luego pide a la persona que
abra la app, entre con su correo y contraseña, y revise en **Perfil** su nombre, organización y rol.

---

## Otras tareas

### Cambiar un horario (sin borrar el anterior)
Los horarios viejos se conservan para que los reportes de fechas pasadas sigan saliendo bien:
se **cierra** el horario anterior y se carga uno nuevo con el paso 3, con `vigente_desde` igual a la fecha del cambio.

```sql
-- Cierra el horario vigente: dejará de aplicar desde mañana
update public.horarios h set vigente_hasta = current_date
from public.miembros m join auth.users u on u.id = m.user_id
where h.miembro_id = m.id and h.vigente_hasta is null
  and u.email = 'correo@de.la.persona';
```

Después corre el paso 3 con `current_date + 1` en `vigente_desde`.

### Dar de baja a una persona
**Nunca borres el usuario ni su fila en `miembros`.** La ley pide conservar los registros de asistencia
(al menos un año después de la baja), y la base de datos no permite borrar miembros.

```sql
-- Baja lógica: la app le cerrará la sesión en cuanto tenga señal
update public.miembros m set activo = false, fecha_baja = current_date
from auth.users u
where u.id = m.user_id and u.email = 'correo@de.la.persona';
```

Para impedir que vuelva a entrar, también cámbiale la contraseña en **Authentication → Users**.

### Persona en dos organizaciones
Repite el paso 2 con el mismo correo y el slug de la otra organización. Al entrar, la app le preguntará con cuál
organización va a registrar, y podrá cambiarla desde **Perfil**.

### Olvidó su contraseña
En **Authentication → Users**, abre a la persona y usa la opción para enviarle la recuperación de contraseña por
correo. Recuerda que el plan gratuito envía pocos correos por hora.

---

## Si la app dice "no tiene un alta activa"

| Causa probable | Cómo se ve en el paso 4 | Qué hacer |
|---|---|---|
| No se hizo el paso 2 | La consulta no devuelve filas | Hacer el paso 2 |
| El usuario se creó con otro correo | La consulta no devuelve filas | Revisar el correo en Authentication → Users |
| Está dada de baja | `activo = false` | Reactivar: `update public.miembros set activo = true, fecha_baja = null where id = '…';` |
| La organización está desactivada | (revisar `select slug, activa from organizaciones;`) | Pedir a Ecosistémica que la revise |

## Pendientes que dependen de Parques Alegres
- Horarios reales de cada asesor y si el bloque de escritorio es teletrabajo (por ahora, el ejemplo de esta guía).
- Validar o no el domicilio en teletrabajo (`validar_domicilio`, hoy `false`): si se decide validar, habrá que dar de
  alta un sitio tipo `domicilio` por persona. Se documentará entonces.
- Firma del aviso de privacidad y del convenio antes de usar datos reales.
