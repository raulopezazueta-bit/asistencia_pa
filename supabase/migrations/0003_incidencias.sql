-- =====================================================================
-- Migración 0003 · Incidencias (HU-28/29): validaciones y corrección de hora que reemplaza a la original
-- Ecosistémica – Consultoría Ambiental Integral · v0.3 (2026-10-04)
--
-- Cómo aplicarla: Supabase > SQL Editor > New query > pegar todo > Run (una sola vez, después de la 0002).
--
-- Cambios (la 0001 no se edita):
--   1. Trigger incidencias_validar (antes de insertar o resolver):
--      · omisión y corrección de hora exigen el tipo de checada y la hora propuesta (y el bloque si es inicio/fin de bloque);
--      · corrección de hora y "fuera de zona" exigen la checada original, que debe ser de la misma persona;
--      · la hora propuesta no puede estar en el futuro ni ser más vieja que config.dias_para_corregir (30 por omisión);
--      · rechazar exige un comentario de al menos 5 caracteres (la persona tiene derecho a saber por qué).
--   2. v_jornada_diaria: una checada cuya hora fue corregida por una incidencia APROBADA ya no cuenta
--      (sigue guardada sin cambios; solo deja de sumar). Se agrega al final la columna con_incidencia.
-- Nada se borra ni se edita en eventos_jornada: la checada corregida sigue ahí, inalterable.
-- =====================================================================

create or replace function public.validar_incidencia()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cfg   jsonb;
  dias  int;
  dueno uuid;
begin
  if tg_op = 'UPDATE' then
    if new.estado = 'rechazada' and length(trim(coalesce(new.comentario_resolucion, ''))) < 5 then
      raise exception 'Para rechazar, escribe el motivo (al menos 5 caracteres)';
    end if;
    return new;
  end if;

  if new.tipo in ('omision', 'correccion_hora') then
    if new.tipo_evento_propuesto is null or new.hora_propuesta is null then
      raise exception 'Indica qué checada y a qué hora';
    end if;
    if new.tipo_evento_propuesto in ('inicio_bloque', 'fin_bloque') and new.bloque_propuesto is null then
      raise exception 'Indica el bloque (escritorio o campo)';
    end if;
  end if;
  if new.tipo in ('correccion_hora', 'fuera_geocerca') and new.evento_original_id is null then
    raise exception 'Indica la checada que quieres corregir';
  end if;
  if new.evento_original_id is not null then
    select miembro_id into dueno from public.eventos_jornada where id = new.evento_original_id;
    if dueno is distinct from new.miembro_id then
      raise exception 'La checada original no es de esta persona';
    end if;
  end if;
  if new.hora_propuesta is not null then
    select config into cfg from public.organizaciones where id = new.organizacion_id;
    dias := coalesce((cfg->>'dias_para_corregir')::int, 30);
    if new.hora_propuesta > now() + interval '5 minutes' then
      raise exception 'La hora propuesta no puede estar en el futuro';
    end if;
    if new.hora_propuesta < now() - make_interval(days => dias) then
      raise exception 'Solo se pueden corregir checadas de los últimos % días', dias;
    end if;
  end if;
  return new;
end $$;

-- Se ejecuta después de incidencias_controlar (orden alfabético), que ya fijó la organización
create trigger incidencias_validar before insert or update on public.incidencias
  for each row execute function public.validar_incidencia();

-- Igual que en la 0001, con dos cambios marcados con «0003».
create or replace view public.v_jornada_diaria with (security_invoker = true) as
with ev as (
  select e.*, (e.hora_efectiva at time zone o.zona_horaria)::date as fecha
  from public.eventos_jornada e
  join public.organizaciones o on o.id = e.organizacion_id
  where e.tipo in ('inicio_bloque','fin_bloque','inicio_pausa','fin_pausa')
    -- «0003» la checada cuya hora corrigió una incidencia aprobada deja de contar
    and not exists (select 1 from public.incidencias i
                    where i.evento_original_id = e.id and i.estado = 'aprobada' and i.tipo = 'correccion_hora')
),
bloques as (
  select organizacion_id, miembro_id, fecha, bloque,
         min(hora_efectiva) filter (where tipo = 'inicio_bloque') as inicio,
         max(hora_efectiva) filter (where tipo = 'fin_bloque')    as fin
  from ev where bloque is not null
  group by organizacion_id, miembro_id, fecha, bloque
),
revision as (
  select miembro_id, fecha, bool_or(estado_revision = 'revisar') as con_revision,
         bool_or(origen = 'incidencia') as con_incidencia
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
       coalesce(bool_or(r.con_revision), false) as con_revision,
       coalesce(bool_or(r.con_incidencia), false) as con_incidencia   -- «0003»
from bloques b
join public.miembros m on m.id = b.miembro_id
left join pausas p   on p.miembro_id = b.miembro_id and p.fecha = b.fecha
left join revision r on r.miembro_id = b.miembro_id and r.fecha = b.fecha
group by b.organizacion_id, b.miembro_id, m.nombre_completo, b.fecha;
