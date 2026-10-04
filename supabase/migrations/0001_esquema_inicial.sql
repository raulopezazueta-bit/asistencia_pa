-- =====================================================================
-- App de Asistencia (registro electrónico de jornada, art. 132 fr. XXXIV LFT)
-- Migración 0001 · Esquema inicial multi-organización
-- Ecosistémica – Consultoría Ambiental Integral · v0.1 (2026-10-02)
--
-- Cómo aplicarla: Supabase > SQL Editor > New query > pegar todo > Run.
-- Es idempotente solo en la creación de extensiones; está pensada para
-- correrse UNA vez sobre un proyecto vacío.
--
-- Principios:
--   1. Todo dato pertenece a una organización (IAP). RLS separa organizaciones.
--   2. Los eventos de jornada son SOLO-INSERCIÓN: no se editan ni se borran.
--      Las correcciones entran como incidencias y, al aprobarse, generan un
--      evento nuevo que referencia a la incidencia.
--   3. La hora legal la pone el servidor (hora_servidor). La del teléfono se
--      guarda aparte para detectar relojes alterados o registros sin conexión.
--   4. La geocerca se valida en el servidor con PostGIS (no se confía en el cliente).
-- =====================================================================

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Organizaciones (cada IAP de Fundación GC1 es una organización)
-- ---------------------------------------------------------------------
create table public.organizaciones (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  nombre        text not null,
  zona_horaria  text not null default 'America/Mazatlan',
  -- Reglas configurables: se ajustan cuando el Product Owner de cada IAP decida.
  config        jsonb not null default jsonb_build_object(
                  'tolerancia_entrada_min', 10,     -- retardo permitido
                  'tolerancia_geocerca_m', 30,      -- margen extra sobre el perímetro del sitio
                  'radio_por_defecto_m', 80,        -- sitios sin polígono
                  'umbral_desfase_min', 10,         -- diferencia teléfono vs servidor (en línea)
                  'max_horas_sin_conexion', 72,     -- registros offline más viejos se marcan
                  'selfie_obligatoria', true,
                  'validar_domicilio', false,       -- pendiente decisión legal (HU-03 / HU-20)
                  'color_primario', '#14503A'
                ),
  activa        boolean not null default true,
  creada_en     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Miembros (personas de la organización, ligadas a auth.users)
-- ---------------------------------------------------------------------
create table public.miembros (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones(id),
  user_id          uuid references auth.users(id),
  nombre_completo  text not null,
  num_empleado     text,
  rol              text not null default 'asesor' check (rol in ('asesor','coordinador','admin')),
  activo           boolean not null default true,
  fecha_alta       date not null default current_date,
  fecha_baja       date,                         -- conservar registros >= 1 año después (art. 804)
  creado_en        timestamptz not null default now(),
  unique (organizacion_id, user_id),
  unique (organizacion_id, num_empleado)
);

-- ---------------------------------------------------------------------
-- 3. Sitios (parques, oficina, domicilios, otros) = geocercas
-- ---------------------------------------------------------------------
create table public.sitios (
  id                 uuid primary key default gen_random_uuid(),
  organizacion_id    uuid not null references public.organizaciones(id),
  clave_externa      text,                       -- p. ej. Parque_ID de PA (14601)
  id_oficial         text,                       -- p. ej. PA-2500600016677006-01 (INEGI)
  nombre             text not null,
  colonia            text,
  tipo               text not null default 'parque' check (tipo in ('parque','oficina','domicilio','otro')),
  responsable_ref    text,                       -- asesor asignado según catálogo (texto libre)
  miembro_id         uuid references public.miembros(id),  -- solo para tipo 'domicilio'
  centro             extensions.geography(Point, 4326) not null,
  perimetro          extensions.geography(MultiPolygon, 4326),
  radio_m            integer check (radio_m between 10 and 1000),
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  unique (organizacion_id, clave_externa),
  check (tipo <> 'domicilio' or miembro_id is not null)
);
create index sitios_centro_gix    on public.sitios using gist (centro);
create index sitios_perimetro_gix on public.sitios using gist (perimetro);

-- ---------------------------------------------------------------------
-- 4. Horarios programados (jornada partida: escritorio + campo)
-- ---------------------------------------------------------------------
create table public.horarios (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones(id),
  miembro_id       uuid not null references public.miembros(id),
  dia_semana       smallint not null check (dia_semana between 1 and 7),  -- 1 = lunes (ISO)
  bloque           text not null check (bloque in ('escritorio','campo')),
  hora_inicio      time not null,
  hora_fin         time not null check (hora_fin > hora_inicio),
  modalidad        text not null default 'presencial' check (modalidad in ('presencial','teletrabajo')),
  vigente_desde    date not null default current_date,
  vigente_hasta    date,
  creado_en        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Eventos de jornada (SOLO-INSERCIÓN)
-- ---------------------------------------------------------------------
create table public.eventos_jornada (
  id                     uuid primary key,          -- lo genera el teléfono (idempotencia offline)
  organizacion_id        uuid not null references public.organizaciones(id),
  miembro_id             uuid not null references public.miembros(id),
  tipo                   text not null check (tipo in (
                           'inicio_bloque','fin_bloque',
                           'inicio_pausa','fin_pausa',
                           'llegada_sitio','salida_sitio')),
  bloque                 text check (bloque in ('escritorio','campo')),
  modalidad              text not null default 'presencial' check (modalidad in ('presencial','teletrabajo')),
  -- Tiempo
  hora_dispositivo       timestamptz not null,
  hora_servidor          timestamptz not null default now(),   -- la fija el trigger, nunca el cliente
  hora_efectiva          timestamptz,                          -- la que cuenta para la jornada (trigger)
  desfase_seg            integer,                              -- servidor - dispositivo
  capturado_sin_conexion boolean not null default false,
  -- Ubicación
  lat                    double precision check (lat between -90 and 90),
  lon                    double precision check (lon between -180 and 180),
  precision_m            real,
  ubicacion              extensions.geography(Point, 4326),    -- trigger
  sitio_id               uuid references public.sitios(id),
  distancia_sitio_m      real,                                 -- trigger
  dentro_geocerca        boolean,                              -- trigger (null = no aplica)
  -- Evidencia
  selfie_path            text,                                 -- storage: selfies/{org}/{miembro}/{yyyy}/{mm}/{id}.webp
  justificacion          text,                                 -- p. ej. checada fuera de geocerca acordada
  -- Revisión automática
  estado_revision        text not null default 'ok' check (estado_revision in ('ok','revisar')),
  motivos_revision       text[] not null default '{}',
  -- Trazabilidad
  origen                 text not null default 'app' check (origen in ('app','incidencia')),
  incidencia_id          uuid,
  version_app            text,
  user_agent             text,
  creado_por             uuid default auth.uid(),
  check (tipo not in ('inicio_bloque','fin_bloque') or bloque is not null),
  check (origen = 'app' or incidencia_id is not null)
);
create index eventos_miembro_hora_idx on public.eventos_jornada (miembro_id, hora_efectiva);
create index eventos_org_hora_idx     on public.eventos_jornada (organizacion_id, hora_efectiva);
create index eventos_revision_idx     on public.eventos_jornada (organizacion_id) where estado_revision = 'revisar';

-- ---------------------------------------------------------------------
-- 6. Incidencias (correcciones sin borrar nada)
-- ---------------------------------------------------------------------
create table public.incidencias (
  id                     uuid primary key default gen_random_uuid(),
  organizacion_id        uuid not null references public.organizaciones(id),
  miembro_id             uuid not null references public.miembros(id),
  evento_original_id     uuid references public.eventos_jornada(id),
  tipo                   text not null check (tipo in ('omision','correccion_hora','fuera_geocerca','otro')),
  tipo_evento_propuesto  text check (tipo_evento_propuesto in (
                           'inicio_bloque','fin_bloque','inicio_pausa','fin_pausa','llegada_sitio','salida_sitio')),
  bloque_propuesto       text check (bloque_propuesto in ('escritorio','campo')),
  hora_propuesta         timestamptz,
  motivo                 text not null check (length(trim(motivo)) >= 5),
  estado                 text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada')),
  resuelta_por           uuid references public.miembros(id),
  resuelta_en            timestamptz,
  comentario_resolucion  text,
  creada_en              timestamptz not null default now(),
  creada_por             uuid default auth.uid()
);
alter table public.eventos_jornada
  add constraint eventos_incidencia_fk foreign key (incidencia_id) references public.incidencias(id);

-- ---------------------------------------------------------------------
-- 7. Bitácora (auditoría de todo cambio; solo-inserción)
-- ---------------------------------------------------------------------
create table public.bitacora (
  id               bigint generated always as identity primary key,
  organizacion_id  uuid,
  tabla            text not null,
  registro_id      text not null,
  accion           text not null,
  actor            uuid default auth.uid(),
  datos            jsonb,
  en               timestamptz not null default now()
);
create index bitacora_org_en_idx on public.bitacora (organizacion_id, en desc);

-- =====================================================================
-- FUNCIONES AUXILIARES (security definer: evitan recursión en RLS)
-- =====================================================================
create or replace function public.mis_organizaciones(roles text[] default array['asesor','coordinador','admin'])
returns setof uuid language sql stable security definer set search_path = public as $$
  select organizacion_id from public.miembros
  where user_id = auth.uid() and activo and rol = any(roles);
$$;

create or replace function public.mis_miembros()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.miembros where user_id = auth.uid() and activo;
$$;

-- =====================================================================
-- TRIGGERS
-- =====================================================================

-- 7.1 Bloquear UPDATE/DELETE en tablas inalterables
create or replace function public.bloquear_modificacion()
returns trigger language plpgsql as $$
begin
  raise exception 'Registro inalterable: % no permite %. Use una incidencia.', tg_table_name, tg_op
    using errcode = '42501';
end $$;

create trigger eventos_inalterables before update or delete on public.eventos_jornada
  for each row execute function public.bloquear_modificacion();
create trigger bitacora_inalterable before update or delete on public.bitacora
  for each row execute function public.bloquear_modificacion();
create trigger incidencias_sin_borrado before delete on public.incidencias
  for each row execute function public.bloquear_modificacion();

-- 7.2 Preparar evento: hora del servidor, desfase, geocerca, banderas de revisión
create or replace function public.preparar_evento()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  m      public.miembros%rowtype;
  cfg    jsonb;
  s      public.sitios%rowtype;
  tol_m  real;
  motivos text[] := '{}';
begin
  select * into m from public.miembros where id = new.miembro_id;
  if not found or not m.activo then
    raise exception 'Miembro inexistente o inactivo';
  end if;
  -- La organización siempre es la del miembro (el cliente no puede elegirla)
  new.organizacion_id := m.organizacion_id;
  select config into cfg from public.organizaciones where id = m.organizacion_id;

  -- Tiempo: el servidor manda
  new.hora_servidor := now();
  new.desfase_seg   := extract(epoch from (new.hora_servidor - new.hora_dispositivo))::int;
  if new.capturado_sin_conexion then
    new.hora_efectiva := new.hora_dispositivo;
    if new.hora_dispositivo > new.hora_servidor + interval '2 minutes' then
      motivos := array_append(motivos, 'hora_futura');
    end if;
    if new.desfase_seg > (cfg->>'max_horas_sin_conexion')::int * 3600 then
      motivos := array_append(motivos, 'sin_conexion_prolongada');
    end if;
  else
    new.hora_efectiva := new.hora_servidor;
    if abs(new.desfase_seg) > (cfg->>'umbral_desfase_min')::int * 60 then
      motivos := array_append(motivos, 'reloj_desfasado');
    end if;
  end if;

  -- Ubicación
  if new.lat is not null and new.lon is not null then
    new.ubicacion := st_setsrid(st_makepoint(new.lon, new.lat), 4326)::geography;
  end if;

  -- Sitio: el indicado por el cliente o, si no viene, el más cercano a 500 m
  if new.sitio_id is null and new.ubicacion is not null then
    select * into s from public.sitios
      where organizacion_id = m.organizacion_id and activo
        and (tipo <> 'domicilio' or miembro_id = m.id)
        and st_dwithin(coalesce(perimetro, centro), new.ubicacion, 500)
      order by st_distance(coalesce(perimetro, centro), new.ubicacion)
      limit 1;
    if found then new.sitio_id := s.id; end if;
  elsif new.sitio_id is not null then
    select * into s from public.sitios where id = new.sitio_id and organizacion_id = m.organizacion_id;
    if not found then raise exception 'Sitio no pertenece a la organización'; end if;
  end if;

  -- Geocerca
  if new.modalidad = 'teletrabajo' and not coalesce((cfg->>'validar_domicilio')::boolean, false) then
    new.dentro_geocerca := null;                 -- no aplica hasta decisión legal
  elsif new.ubicacion is null then
    new.dentro_geocerca := false;
    motivos := array_append(motivos, 'sin_ubicacion');
  elsif s.id is null then
    new.dentro_geocerca := false;
    motivos := array_append(motivos, 'fuera_de_geocerca');
  else
    new.distancia_sitio_m := st_distance(coalesce(s.perimetro, s.centro), new.ubicacion);
    tol_m := case when s.perimetro is not null
                  then (cfg->>'tolerancia_geocerca_m')::real
                  else coalesce(s.radio_m, (cfg->>'radio_por_defecto_m')::int)::real end;
    new.dentro_geocerca := new.distancia_sitio_m <= tol_m + least(coalesce(new.precision_m, 0), 50);
    if not new.dentro_geocerca then motivos := array_append(motivos, 'fuera_de_geocerca'); end if;
  end if;

  -- Selfie
  if coalesce((cfg->>'selfie_obligatoria')::boolean, true)
     and new.origen = 'app'
     and new.tipo in ('inicio_bloque','fin_bloque')
     and new.selfie_path is null then
    motivos := array_append(motivos, 'sin_selfie');
  end if;

  new.motivos_revision := motivos;
  -- Con justificación también queda en 'revisar': coordinación decide (la justificación ayuda, no aprueba)
  new.estado_revision  := case when cardinality(motivos) > 0 then 'revisar' else 'ok' end;
  new.creado_por := auth.uid();
  return new;
end $$;

create trigger eventos_preparar before insert on public.eventos_jornada
  for each row execute function public.preparar_evento();

-- 7.3 Incidencias: solo se resuelven una vez; al aprobar se crea el evento corregido
create or replace function public.controlar_incidencia()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  resolutor public.miembros%rowtype;
begin
  if tg_op = 'INSERT' then
    select organizacion_id into new.organizacion_id from public.miembros where id = new.miembro_id;
    new.estado := 'pendiente';
    new.resuelta_por := null; new.resuelta_en := null;
    return new;
  end if;
  -- UPDATE: solo transición pendiente -> aprobada/rechazada, por coordinador/admin
  if old.estado <> 'pendiente' then
    raise exception 'La incidencia ya fue resuelta';
  end if;
  if new.estado not in ('aprobada','rechazada') then
    raise exception 'Estado inválido';
  end if;
  if (new.miembro_id, new.tipo, new.motivo, new.hora_propuesta, new.evento_original_id,
      new.tipo_evento_propuesto, new.bloque_propuesto)
     is distinct from
     (old.miembro_id, old.tipo, old.motivo, old.hora_propuesta, old.evento_original_id,
      old.tipo_evento_propuesto, old.bloque_propuesto) then
    raise exception 'Solo se puede cambiar el estado y el comentario de resolución';
  end if;
  select * into resolutor from public.miembros
    where user_id = auth.uid() and organizacion_id = old.organizacion_id
      and activo and rol in ('coordinador','admin');
  if not found then raise exception 'Solo coordinación puede resolver incidencias'; end if;
  if resolutor.id = old.miembro_id then raise exception 'Nadie aprueba sus propias incidencias'; end if;
  new.resuelta_por := resolutor.id;
  new.resuelta_en  := now();
  return new;
end $$;

create trigger incidencias_controlar before insert or update on public.incidencias
  for each row execute function public.controlar_incidencia();

create or replace function public.aplicar_incidencia_aprobada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'aprobada' and old.estado = 'pendiente'
     and new.tipo_evento_propuesto is not null and new.hora_propuesta is not null then
    insert into public.eventos_jornada (id, miembro_id, tipo, bloque, hora_dispositivo,
                                        capturado_sin_conexion, origen, incidencia_id, justificacion)
    values (gen_random_uuid(), new.miembro_id, new.tipo_evento_propuesto, new.bloque_propuesto,
            new.hora_propuesta, true, 'incidencia', new.id, new.motivo);
  end if;
  return new;
end $$;

create trigger incidencias_aplicar after update on public.incidencias
  for each row execute function public.aplicar_incidencia_aprobada();

-- Los eventos que vienen de incidencia toman la hora propuesta y no se validan por geocerca
create or replace function public.ajustar_evento_incidencia()
returns trigger language plpgsql as $$
begin
  if new.origen = 'incidencia' then
    new.hora_efectiva := new.hora_dispositivo;
    new.dentro_geocerca := null;
    new.motivos_revision := '{}';
    new.estado_revision := 'ok';
  end if;
  return new;
end $$;
-- Se ejecuta después de preparar_evento (orden alfabético de triggers BEFORE)
create trigger eventos_zz_incidencia before insert on public.eventos_jornada
  for each row execute function public.ajustar_evento_incidencia();

-- 7.4 Bitácora genérica
create or replace function public.registrar_bitacora()
returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := to_jsonb(coalesce(new, old));
  insert into public.bitacora (organizacion_id, tabla, registro_id, accion, datos)
  values (case when tg_table_name = 'organizaciones' then (r->>'id')::uuid
               else (r->>'organizacion_id')::uuid end,
          tg_table_name, r->>'id', tg_op,
          case when tg_op = 'UPDATE' then jsonb_build_object('antes', to_jsonb(old), 'despues', to_jsonb(new)) else r end);
  return coalesce(new, old);
end $$;

create trigger bit_organizaciones after insert or update on public.organizaciones for each row execute function public.registrar_bitacora();
create trigger bit_miembros       after insert or update on public.miembros       for each row execute function public.registrar_bitacora();
create trigger bit_sitios         after insert or update on public.sitios         for each row execute function public.registrar_bitacora();
create trigger bit_horarios       after insert or update on public.horarios       for each row execute function public.registrar_bitacora();
create trigger bit_eventos        after insert            on public.eventos_jornada for each row execute function public.registrar_bitacora();
create trigger bit_incidencias    after insert or update on public.incidencias    for each row execute function public.registrar_bitacora();

-- Bajas lógicas: miembros y sitios no se borran
create trigger miembros_sin_borrado before delete on public.miembros for each row execute function public.bloquear_modificacion();
create trigger sitios_sin_borrado   before delete on public.sitios   for each row execute function public.bloquear_modificacion();

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.organizaciones  enable row level security;
alter table public.miembros        enable row level security;
alter table public.sitios          enable row level security;
alter table public.horarios        enable row level security;
alter table public.eventos_jornada enable row level security;
alter table public.incidencias     enable row level security;
alter table public.bitacora        enable row level security;

-- Organizaciones: cada quien ve la suya; solo admin la edita (config)
create policy org_ver    on public.organizaciones for select to authenticated using (id in (select public.mis_organizaciones()));
create policy org_editar on public.organizaciones for update to authenticated
  using (id in (select public.mis_organizaciones(array['admin']))) with check (id in (select public.mis_organizaciones(array['admin'])));

-- Miembros: el asesor se ve a sí mismo; coordinación ve a todos; admin administra
create policy mie_ver on public.miembros for select to authenticated
  using (user_id = auth.uid() or organizacion_id in (select public.mis_organizaciones(array['coordinador','admin'])));
create policy mie_alta on public.miembros for insert to authenticated
  with check (organizacion_id in (select public.mis_organizaciones(array['admin'])));
create policy mie_editar on public.miembros for update to authenticated
  using (organizacion_id in (select public.mis_organizaciones(array['admin'])))
  with check (organizacion_id in (select public.mis_organizaciones(array['admin'])));

-- Sitios: todos los de la organización ven parques/oficina; domicilios solo su dueño y coordinación
create policy sit_ver on public.sitios for select to authenticated
  using (organizacion_id in (select public.mis_organizaciones())
         and (tipo <> 'domicilio' or miembro_id in (select public.mis_miembros())
              or organizacion_id in (select public.mis_organizaciones(array['coordinador','admin']))));
create policy sit_alta on public.sitios for insert to authenticated
  with check (organizacion_id in (select public.mis_organizaciones(array['admin'])));
create policy sit_editar on public.sitios for update to authenticated
  using (organizacion_id in (select public.mis_organizaciones(array['admin'])))
  with check (organizacion_id in (select public.mis_organizaciones(array['admin'])));

-- Horarios
create policy hor_ver on public.horarios for select to authenticated
  using (miembro_id in (select public.mis_miembros())
         or organizacion_id in (select public.mis_organizaciones(array['coordinador','admin'])));
create policy hor_admin on public.horarios for all to authenticated
  using (organizacion_id in (select public.mis_organizaciones(array['admin'])))
  with check (organizacion_id in (select public.mis_organizaciones(array['admin'])));

-- Eventos: cada quien inserta los suyos; lectura propia o de coordinación. Sin update/delete.
create policy eve_insertar on public.eventos_jornada for insert to authenticated
  with check (miembro_id in (select public.mis_miembros()) and origen = 'app');
create policy eve_ver on public.eventos_jornada for select to authenticated
  using (miembro_id in (select public.mis_miembros())
         or organizacion_id in (select public.mis_organizaciones(array['coordinador','admin'])));

-- Incidencias: el asesor solicita; coordinación resuelve
create policy inc_insertar on public.incidencias for insert to authenticated
  with check (miembro_id in (select public.mis_miembros()));
create policy inc_ver on public.incidencias for select to authenticated
  using (miembro_id in (select public.mis_miembros())
         or organizacion_id in (select public.mis_organizaciones(array['coordinador','admin'])));
create policy inc_resolver on public.incidencias for update to authenticated
  using (organizacion_id in (select public.mis_organizaciones(array['coordinador','admin'])))
  with check (organizacion_id in (select public.mis_organizaciones(array['coordinador','admin'])));

-- Bitácora: solo admin la consulta
create policy bit_ver on public.bitacora for select to authenticated
  using (organizacion_id in (select public.mis_organizaciones(array['admin'])));

-- Privilegios mínimos: nadie (ni con la llave pública) borra ni edita eventos
revoke all on public.eventos_jornada, public.bitacora from anon;
revoke update, delete, truncate on public.eventos_jornada from authenticated;
revoke insert, update, delete, truncate on public.bitacora from authenticated;
revoke delete, truncate on public.incidencias, public.miembros, public.sitios, public.organizaciones from authenticated;
revoke all on public.organizaciones, public.miembros, public.sitios, public.horarios, public.incidencias from anon;

-- =====================================================================
-- VISTA DE JORNADA DIARIA (base del reporte para autoridad y nómina)
-- =====================================================================
create or replace view public.v_jornada_diaria with (security_invoker = true) as
with ev as (
  select e.*, (e.hora_efectiva at time zone o.zona_horaria)::date as fecha
  from public.eventos_jornada e
  join public.organizaciones o on o.id = e.organizacion_id
  where e.tipo in ('inicio_bloque','fin_bloque','inicio_pausa','fin_pausa')
),
bloques as (
  select organizacion_id, miembro_id, fecha, bloque,
         min(hora_efectiva) filter (where tipo = 'inicio_bloque') as inicio,
         max(hora_efectiva) filter (where tipo = 'fin_bloque')    as fin
  from ev where bloque is not null
  group by organizacion_id, miembro_id, fecha, bloque
),
revision as (
  select miembro_id, fecha, bool_or(estado_revision = 'revisar') as con_revision
  from ev group by miembro_id, fecha
),
pares_pausa as (
  select * from (
    select miembro_id, fecha, tipo, hora_efectiva as ini_p,
           lead(hora_efectiva) over (partition by miembro_id, fecha order by hora_efectiva) as fin_p,
           lead(tipo)          over (partition by miembro_id, fecha order by hora_efectiva) as sig
    from ev where tipo in ('inicio_pausa','fin_pausa')
  ) x where tipo = 'inicio_pausa' and sig = 'fin_pausa'
),
pausas as (
  -- Solo descuenta la parte de la pausa que cae DENTRO de un bloque
  -- (en jornada partida, la comida entre bloques no resta tiempo).
  select pp.miembro_id, pp.fecha,
         coalesce(sum(extract(epoch from greatest(interval '0', least(pp.fin_p, b.fin) - greatest(pp.ini_p, b.inicio))) / 60), 0)::int as minutos_pausa
  from pares_pausa pp
  join bloques b on b.miembro_id = pp.miembro_id and b.fecha = pp.fecha and b.fin > b.inicio
  group by pp.miembro_id, pp.fecha
)
select b.organizacion_id, b.miembro_id, m.nombre_completo, b.fecha,
       min(b.inicio) as inicio_jornada,
       max(b.fin)    as fin_jornada,
       jsonb_object_agg(b.bloque, jsonb_build_object('inicio', b.inicio, 'fin', b.fin)) as bloques,
       coalesce(max(p.minutos_pausa), 0) as minutos_pausa,
       greatest(0, coalesce(sum(extract(epoch from (b.fin - b.inicio)) / 60) filter (where b.fin > b.inicio), 0)
                   - coalesce(max(p.minutos_pausa), 0))::int as minutos_efectivos,
       bool_or(b.fin is null or b.inicio is null) as jornada_abierta,
       coalesce(bool_or(b.fin <= b.inicio), false) as bloque_inconsistente,
       coalesce(bool_or(r.con_revision), false) as con_revision
from bloques b
join public.miembros m on m.id = b.miembro_id
left join pausas p   on p.miembro_id = b.miembro_id and p.fecha = b.fecha
left join revision r on r.miembro_id = b.miembro_id and r.fecha = b.fecha
group by b.organizacion_id, b.miembro_id, m.nombre_completo, b.fecha;

-- =====================================================================
-- VISTA DE SITIOS PARA LA APP (GeoJSON listo para validar geocerca sin conexión)
-- =====================================================================
create or replace view public.v_sitios_app with (security_invoker = true) as
select s.id, s.organizacion_id, s.clave_externa, s.id_oficial, s.nombre, s.colonia, s.tipo,
       s.responsable_ref, s.miembro_id,
       extensions.st_y(s.centro::extensions.geometry) as lat,
       extensions.st_x(s.centro::extensions.geometry) as lon,
       coalesce(s.radio_m, (o.config->>'radio_por_defecto_m')::int) as radio_m,
       (o.config->>'tolerancia_geocerca_m')::int as tolerancia_m,
       extensions.st_asgeojson(s.perimetro::extensions.geometry, 6)::jsonb as perimetro_geojson
from public.sitios s
join public.organizaciones o on o.id = s.organizacion_id
where s.activo;

-- =====================================================================
-- STORAGE: selfies privadas (ruta: {organizacion_id}/{miembro_id}/{yyyy}/{mm}/{evento_id}.webp)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selfies', 'selfies', false, 150000, array['image/webp','image/jpeg'])
on conflict (id) do nothing;

create policy selfies_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'selfies'
              and (storage.foldername(name))[1]::uuid in (select public.mis_organizaciones())
              and (storage.foldername(name))[2]::uuid in (select public.mis_miembros()));
create policy selfies_ver on storage.objects for select to authenticated
  using (bucket_id = 'selfies'
         and ((storage.foldername(name))[2]::uuid in (select public.mis_miembros())
              or (storage.foldername(name))[1]::uuid in (select public.mis_organizaciones(array['coordinador','admin']))));
-- Sin políticas de update/delete: las selfies no se reemplazan ni se borran.
