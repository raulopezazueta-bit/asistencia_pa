-- =====================================================================
-- Migración 0004 · Revisiones de checadas marcadas "revisar" (HU-23, bandeja de revisión)
-- Ecosistémica – Consultoría Ambiental Integral · v0.4 (2026-10-04)
--
-- Cómo aplicarla: Supabase > SQL Editor > New query > pegar todo > Run (una sola vez, después de la 0003).
--
-- Las checadas son inalterables: coordinación no cambia su estado_revision. Su decisión queda aparte, en
-- `revisiones` (solo-inserción, una por checada):
--   · validada  → la checada es correcta aunque el sistema la marcó (p. ej. GPS impreciso junto al parque);
--   · observada → hay algo que aclarar; exige comentario. La persona puede verlo y, si corresponde, pedir una incidencia.
-- Reglas (trigger preparar_revision): solo coordinación/admin de la organización de la checada; nadie revisa
-- sus propias checadas; solo checadas en 'revisar'; la organización y quién revisa los fija el servidor.
-- =====================================================================

create table public.revisiones (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones(id),
  evento_id        uuid not null unique references public.eventos_jornada(id),
  decision         text not null check (decision in ('validada', 'observada')),
  comentario       text,
  revisado_por     uuid references public.miembros(id),
  revisado_en      timestamptz not null default now()
);
create index revisiones_org_en_idx on public.revisiones (organizacion_id, revisado_en desc);

create or replace function public.preparar_revision()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  e    public.eventos_jornada%rowtype;
  yo   public.miembros%rowtype;
begin
  select * into e from public.eventos_jornada where id = new.evento_id;
  if not found then raise exception 'Checada inexistente'; end if;
  if e.estado_revision <> 'revisar' then raise exception 'Solo se revisan checadas marcadas para revisión'; end if;
  select * into yo from public.miembros
    where user_id = auth.uid() and organizacion_id = e.organizacion_id and activo and rol in ('coordinador', 'admin');
  if not found then raise exception 'Solo coordinación puede revisar checadas'; end if;
  if yo.id = e.miembro_id then raise exception 'Nadie revisa sus propias checadas'; end if;
  if new.decision = 'observada' and length(trim(coalesce(new.comentario, ''))) < 5 then
    raise exception 'Para observar, escribe el motivo (al menos 5 caracteres)';
  end if;
  new.organizacion_id := e.organizacion_id;
  new.revisado_por    := yo.id;
  new.revisado_en     := now();
  return new;
end $$;

create trigger revisiones_preparar before insert on public.revisiones
  for each row execute function public.preparar_revision();
create trigger revisiones_inalterables before update or delete on public.revisiones
  for each row execute function public.bloquear_modificacion();
create trigger bit_revisiones after insert on public.revisiones
  for each row execute function public.registrar_bitacora();

alter table public.revisiones enable row level security;
-- Coordinación revisa y consulta las de su organización; cada persona ve las revisiones de sus propias checadas
create policy rev_insertar on public.revisiones for insert to authenticated
  with check (organizacion_id in (select public.mis_organizaciones(array['coordinador','admin'])));
create policy rev_ver on public.revisiones for select to authenticated
  using (organizacion_id in (select public.mis_organizaciones(array['coordinador','admin']))
         or evento_id in (select id from public.eventos_jornada where miembro_id in (select public.mis_miembros())));

revoke all on public.revisiones from anon;
revoke update, delete, truncate on public.revisiones from authenticated;
grant select, insert on public.revisiones to authenticated;
