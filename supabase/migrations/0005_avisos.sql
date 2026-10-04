-- =====================================================================
-- Migración 0005 · Avisos con la app cerrada (HU-15b recordatorio de salida y HU-30 alertas a coordinación)
-- Ecosistémica – Consultoría Ambiental Integral · v0.5 (2026-10-04)
--
-- Cómo aplicarla: Supabase > SQL Editor > New query > pegar todo > Run (una sola vez, después de la 0004).
--
--   · suscripciones_push: la "dirección de avisos" de cada teléfono (Web Push). Cada persona registra y quita SOLO
--     las suyas (funciones registrar_suscripcion / quitar_suscripcion); nadie más las ve. No son registros de jornada:
--     se pueden quitar.
--   · avisos_enviados: qué aviso ya se mandó a quién (para no repetir). Solo la función `avisos` (llave secreta).
--   · claves_push: llaves de Web Push y la contraseña con la que el reloj programado llama a la función. Las genera la
--     función la primera vez; ninguna persona ni la app puede leerlas (RLS sin políticas).
-- =====================================================================

create table public.suscripciones_push (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones(id),
  miembro_id       uuid not null references public.miembros(id),
  endpoint         text not null unique,
  p256dh           text not null,
  auth             text not null,
  user_agent       text,
  creada_en        timestamptz not null default now()
);
create index suscripciones_miembro_idx on public.suscripciones_push (miembro_id);

create table public.avisos_enviados (
  id               bigint generated always as identity primary key,
  organizacion_id  uuid not null references public.organizaciones(id),
  miembro_id       uuid not null references public.miembros(id),   -- quien lo recibe
  clave            text not null,                                  -- p. ej. salida:<miembro>:2026-10-05:campo
  enviado_en       timestamptz not null default now(),
  unique (miembro_id, clave)
);

create table public.claves_push (
  id          smallint primary key default 1 check (id = 1),
  vapid       jsonb not null,          -- llaves VAPID (JWK) para firmar los avisos
  token_cron  text not null,           -- contraseña del reloj programado (pg_cron) para llamar a la función
  creada_en   timestamptz not null default now()
);

alter table public.suscripciones_push enable row level security;
alter table public.avisos_enviados    enable row level security;
alter table public.claves_push        enable row level security;
-- Cada quien ve sus suscripciones; avisos_enviados y claves_push no tienen políticas: solo la llave secreta las usa.
create policy sus_ver on public.suscripciones_push for select to authenticated
  using (miembro_id in (select public.mis_miembros()));
revoke all on public.suscripciones_push, public.avisos_enviados, public.claves_push from anon;
revoke insert, update, delete, truncate on public.suscripciones_push from authenticated;
revoke all on public.avisos_enviados, public.claves_push from authenticated;
grant select on public.suscripciones_push to authenticated;

-- Registrar el teléfono para recibir avisos. Si ese teléfono estaba registrado a nombre de otra persona (cerró sesión
-- y entró otra), pasa a la persona que llama: los avisos son de quien usa el teléfono ahora.
create or replace function public.registrar_suscripcion(p_miembro uuid, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
declare m public.miembros%rowtype;
begin
  select * into m from public.miembros where id = p_miembro and user_id = auth.uid() and activo;
  if not found then raise exception 'Solo puedes registrar avisos para ti'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(coalesce(p_p256dh, '')) < 20 or length(coalesce(p_auth, '')) < 8 then
    raise exception 'Suscripción inválida';
  end if;
  delete from public.suscripciones_push where endpoint = p_endpoint;
  insert into public.suscripciones_push (organizacion_id, miembro_id, endpoint, p256dh, auth, user_agent)
  values (m.organizacion_id, m.id, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300));
end $$;

-- Quitar el registro de este teléfono (al cerrar sesión o desactivar avisos). Solo las propias.
create or replace function public.quitar_suscripcion(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.suscripciones_push
   where endpoint = p_endpoint and miembro_id in (select id from public.miembros where user_id = auth.uid());
$$;

revoke all on function public.registrar_suscripcion(uuid, text, text, text, text), public.quitar_suscripcion(text) from public, anon;
grant execute on function public.registrar_suscripcion(uuid, text, text, text, text), public.quitar_suscripcion(text) to authenticated;
