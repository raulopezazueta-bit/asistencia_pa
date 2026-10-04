-- =====================================================================
-- Migración 0002 · Pausas sin revisión de zona y teletrabajo contra el domicilio propio
-- Ecosistémica – Consultoría Ambiental Integral · v0.2 (2026-10-03)
--
-- Cómo aplicarla: Supabase > SQL Editor > New query > pegar todo > Run (una sola vez, después de la 0001).
--
-- Cambios en el trigger preparar_evento (la 0001 no se edita: esta función la reemplaza):
--   1. Pausas (inicio_pausa / fin_pausa): la zona NO se revisa (decisión del Product Owner, 2026-10-03:
--      salir a comer fuera del parque es normal). Se guarda la ubicación, el sitio más cercano y la distancia
--      como información, pero dentro_geocerca queda en null y no se marcan fuera_de_geocerca ni sin_ubicacion.
--   2. Teletrabajo con validar_domicilio = true (HU-20, pendiente de decisión legal): se compara SOLO contra
--      el sitio tipo 'domicilio' de la propia persona, nunca contra un parque cercano. Si el teléfono manda
--      otro sitio, se ignora y se usa el domicilio. Con validar_domicilio = false nada cambia.
-- Todo lo demás es idéntico a la 0001.
-- =====================================================================

create or replace function public.preparar_evento()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  m      public.miembros%rowtype;
  cfg    jsonb;
  s      public.sitios%rowtype;
  tol_m  real;
  motivos text[] := '{}';
  es_pausa boolean;
  validar_dom boolean;
  contra_domicilio boolean;
begin
  select * into m from public.miembros where id = new.miembro_id;
  if not found or not m.activo then
    raise exception 'Miembro inexistente o inactivo';
  end if;
  -- La organización siempre es la del miembro (el cliente no puede elegirla)
  new.organizacion_id := m.organizacion_id;
  select config into cfg from public.organizaciones where id = m.organizacion_id;
  validar_dom := coalesce((cfg->>'validar_domicilio')::boolean, false);
  es_pausa := new.tipo in ('inicio_pausa', 'fin_pausa');
  contra_domicilio := new.modalidad = 'teletrabajo' and validar_dom;

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

  -- Teletrabajo validado: solo cuenta el domicilio propio, aunque el teléfono mande otro sitio
  if contra_domicilio and new.sitio_id is not null
     and not exists (select 1 from public.sitios where id = new.sitio_id and tipo = 'domicilio' and miembro_id = m.id) then
    new.sitio_id := null;
  end if;

  -- Sitio: el indicado por el cliente o, si no viene, el más cercano a 500 m
  if new.sitio_id is null and new.ubicacion is not null then
    select * into s from public.sitios
      where organizacion_id = m.organizacion_id and activo
        and (tipo <> 'domicilio' or miembro_id = m.id)
        and (not contra_domicilio or (tipo = 'domicilio' and miembro_id = m.id))
        and st_dwithin(coalesce(perimetro, centro), new.ubicacion, 500)
      order by st_distance(coalesce(perimetro, centro), new.ubicacion)
      limit 1;
    if found then new.sitio_id := s.id; end if;
  elsif new.sitio_id is not null then
    select * into s from public.sitios where id = new.sitio_id and organizacion_id = m.organizacion_id;
    if not found then raise exception 'Sitio no pertenece a la organización'; end if;
  end if;

  -- Geocerca
  if new.modalidad = 'teletrabajo' and not validar_dom then
    new.dentro_geocerca := null;                 -- no aplica hasta decisión legal
  elsif es_pausa then
    new.dentro_geocerca := null;                 -- pausas: la zona no se revisa (solo informativa)
    if s.id is not null and new.ubicacion is not null then
      new.distancia_sitio_m := st_distance(coalesce(s.perimetro, s.centro), new.ubicacion);
    end if;
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
