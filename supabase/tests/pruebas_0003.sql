-- Pruebas de la migración 0003 · incidencias (HU-28/29). Se corren después de las demás pruebas SQL.
-- Cada caso se verifica con assert: si algo no coincide, el script se detiene con error. Datos ficticios.
\set ON_ERROR_STOP 1
reset role;

-- Persona ficticia nueva en Parques Alegres para tener un día "limpio" (ayer, hora de Culiacán)
insert into auth.users values ('00000000-0000-0000-0000-0000000000e3');
insert into miembros(id, organizacion_id, user_id, nombre_completo, rol) values
 ('eeeeeeee-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e3', 'Asesor Incidencias', 'asesor');

-- Ejecuta una sentencia que DEBE fallar con un mensaje que contenga «esperado»
create function public.prueba_debe_fallar(sentencia text, esperado text) returns void language plpgsql as $$
begin
  begin
    execute sentencia;
  exception when others then
    if position(esperado in sqlerrm) = 0 then raise exception 'Falló con otro mensaje: % (se esperaba: %)', sqlerrm, esperado; end if;
    return;
  end;
  raise exception 'Debía fallar y no falló (se esperaba: %)', esperado;
end $$;
grant execute on function public.prueba_debe_fallar(text, text) to authenticated;

-- «base» = medianoche de ayer en Culiacán
create function public.ayer(h numeric) returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/Mazatlan')::date - 1)::timestamp at time zone 'America/Mazatlan') + make_interval(mins => (h * 60)::int) $$;
grant execute on function public.ayer(numeric) to authenticated;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e3';
-- Ayer: escritorio 9:00 y fin olvidado (checó hasta las 15:00); campo 16:00 sin fin
insert into eventos_jornada(id, miembro_id, tipo, bloque, modalidad, hora_dispositivo, capturado_sin_conexion) values
 ('f3000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000003', 'inicio_bloque', 'escritorio', 'teletrabajo', ayer(9),  true),
 ('f3000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000003', 'fin_bloque',    'escritorio', 'teletrabajo', ayer(15), true),
 ('f3000000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000003', 'inicio_bloque', 'campo',      'presencial',  ayer(16), true);

\echo '--- I1 validaciones al solicitar'
select prueba_debe_fallar($q$insert into incidencias(miembro_id, tipo, motivo) values ('eeeeeeee-0000-0000-0000-000000000003', 'omision', 'Olvidé checar')$q$, 'Indica qué checada y a qué hora');
select prueba_debe_fallar($q$insert into incidencias(miembro_id, tipo, tipo_evento_propuesto, hora_propuesta, motivo) values ('eeeeeeee-0000-0000-0000-000000000003', 'omision', 'fin_bloque', ayer(20), 'Olvidé checar')$q$, 'Indica el bloque');
select prueba_debe_fallar($q$insert into incidencias(miembro_id, tipo, tipo_evento_propuesto, bloque_propuesto, hora_propuesta, motivo) values ('eeeeeeee-0000-0000-0000-000000000003', 'correccion_hora', 'fin_bloque', 'escritorio', ayer(13), 'Hora equivocada')$q$, 'Indica la checada que quieres corregir');
select prueba_debe_fallar($q$insert into incidencias(miembro_id, tipo, motivo, evento_original_id) values ('eeeeeeee-0000-0000-0000-000000000003', 'fuera_geocerca', 'Estaba en el parque', 'cccccccc-0000-0000-0000-000000000003')$q$, 'no es de esta persona');
select prueba_debe_fallar($q$insert into incidencias(miembro_id, tipo, tipo_evento_propuesto, bloque_propuesto, hora_propuesta, motivo) values ('eeeeeeee-0000-0000-0000-000000000003', 'omision', 'fin_bloque', 'campo', now() + interval '2 hours', 'Olvidé checar')$q$, 'futuro');
select prueba_debe_fallar($q$insert into incidencias(miembro_id, tipo, tipo_evento_propuesto, bloque_propuesto, hora_propuesta, motivo) values ('eeeeeeee-0000-0000-0000-000000000003', 'omision', 'fin_bloque', 'campo', now() - interval '31 days', 'Olvidé checar')$q$, 'últimos 30 días');
select prueba_debe_fallar($q$insert into incidencias(miembro_id, tipo, motivo) values ('eeeeeeee-0000-0000-0000-000000000003', 'otro', 'abc')$q$, 'incidencias_motivo_check');

\echo '--- I2 solicitudes válidas'
insert into incidencias(id, miembro_id, tipo, evento_original_id, tipo_evento_propuesto, bloque_propuesto, hora_propuesta, motivo) values
 ('d3000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000003', 'correccion_hora', 'f3000000-0000-0000-0000-000000000002', 'fin_bloque', 'escritorio', ayer(13), 'Terminé a las 13:00, checé tarde'),
 ('d3000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000003', 'omision', null, 'fin_bloque', 'campo', ayer(20), 'Se me descargó el teléfono'),
 ('d3000000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000003', 'otro', null, null, null, null, 'Solicitud que será rechazada');

reset role;
do $$
declare e record;
begin
  select * into e from v_jornada_diaria where miembro_id = 'eeeeeeee-0000-0000-0000-000000000003';
  assert e.minutos_efectivos = 360 and e.jornada_abierta and not e.con_incidencia, 'I2 antes de aprobar: 6 h de escritorio y campo abierto';
end $$;

\echo '--- I3 resolver: el asesor no puede (RLS no le deja tocar la fila); rechazar exige comentario'
set role authenticated;
update incidencias set estado = 'aprobada' where id = 'd3000000-0000-0000-0000-000000000001';   -- RLS: 0 filas
do $$ begin assert (select estado from incidencias where id = 'd3000000-0000-0000-0000-000000000001') = 'pendiente', 'I3 el asesor no aprueba la suya'; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';   -- coordinación PA
select prueba_debe_fallar($q$update incidencias set estado = 'rechazada' where id = 'd3000000-0000-0000-0000-000000000003'$q$, 'escribe el motivo');
update incidencias set estado = 'rechazada', comentario_resolucion = 'No corresponde a una checada' where id = 'd3000000-0000-0000-0000-000000000003';
update incidencias set estado = 'aprobada' where id in ('d3000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000002');

\echo '--- I4 coordinación de otra organización no ve ni resuelve'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';   -- admin de IAP Demo
do $$ begin assert (select count(*) from incidencias where miembro_id = 'eeeeeeee-0000-0000-0000-000000000003') = 0, 'I4 otra organización no ve'; end $$;

reset role;
do $$
declare e record; n int;
begin
  -- I5 la corrección reemplaza a la checada original en el cálculo; la omisión cierra el campo
  select * into e from v_jornada_diaria where miembro_id = 'eeeeeeee-0000-0000-0000-000000000003';
  assert e.minutos_efectivos = 480 and not e.jornada_abierta and e.con_incidencia, format('I5 tras aprobar: 4 h + 4 h (hay %s)', e.minutos_efectivos);
  -- La checada original sigue guardada, sin cambios
  select count(*) into n from eventos_jornada where id = 'f3000000-0000-0000-0000-000000000002' and hora_efectiva = ayer(15);
  assert n = 1, 'I5 la checada original sigue intacta';
  select count(*) into n from eventos_jornada where miembro_id = 'eeeeeeee-0000-0000-0000-000000000003' and origen = 'incidencia' and estado_revision = 'ok';
  assert n = 2, 'I5 dos eventos nuevos con origen incidencia';
  -- I6 la rechazada no generó evento, guarda quién y cuándo
  select * into e from incidencias where id = 'd3000000-0000-0000-0000-000000000003';
  assert e.estado = 'rechazada' and e.resuelta_por = 'aaaaaaaa-0000-0000-0000-000000000002' and e.resuelta_en is not null, 'I6 rechazada con resolutor';
  assert not exists (select 1 from eventos_jornada where incidencia_id = 'd3000000-0000-0000-0000-000000000003'), 'I6 sin evento';
  -- I7 bitácora de la resolución
  select count(*) into n from bitacora where tabla = 'incidencias' and registro_id like 'd3000000%' and accion = 'UPDATE';
  assert n = 3, 'I7 bitácora registra las 3 resoluciones';
  raise notice 'PRUEBAS 0003: OK';
end $$;

drop function public.prueba_debe_fallar(text, text);
drop function public.ayer(numeric);
