-- Pruebas de la migración 0004 · revisiones (HU-23). Se corren después de las demás pruebas SQL. Datos ficticios.
\set ON_ERROR_STOP 1
reset role;

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

set role authenticated;
-- Checadas sin ubicación (quedan en 'revisar'): una del asesor de PA y una de la coordinación de PA
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into eventos_jornada(id, miembro_id, tipo, bloque, hora_dispositivo, selfie_path) values
 ('f4000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'inicio_bloque', 'campo', now(), 's'),
 ('f4000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'fin_bloque',    'campo', now(), 's');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into eventos_jornada(id, miembro_id, tipo, bloque, hora_dispositivo, selfie_path) values
 ('f4000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'inicio_bloque', 'campo', now(), 's');
-- Pausa sin ubicación: no se marca (migración 0002), queda 'ok'
insert into eventos_jornada(id, miembro_id, tipo, hora_dispositivo) values
 ('f4000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002', 'inicio_pausa', now());

\echo '--- R1 el asesor no revisa'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select prueba_debe_fallar($q$insert into revisiones(evento_id, decision) values ('f4000000-0000-0000-0000-000000000001', 'validada')$q$, 'Solo coordinación');

\echo '--- R2 coordinación: validar, observar con comentario, reglas'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select prueba_debe_fallar($q$insert into revisiones(evento_id, decision) values ('f4000000-0000-0000-0000-000000000002', 'observada')$q$, 'escribe el motivo');
select prueba_debe_fallar($q$insert into revisiones(evento_id, decision) values ('f4000000-0000-0000-0000-000000000003', 'validada')$q$, 'Nadie revisa sus propias');
select prueba_debe_fallar($q$insert into revisiones(evento_id, decision) values ('f4000000-0000-0000-0000-000000000004', 'validada')$q$, 'Solo se revisan checadas marcadas');
insert into revisiones(evento_id, decision, comentario, organizacion_id, revisado_por) values
 ('f4000000-0000-0000-0000-000000000001', 'validada', 'GPS sin señal junto al parque', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into revisiones(evento_id, decision, comentario) values ('f4000000-0000-0000-0000-000000000002', 'observada', 'Sin ubicación al cerrar el campo');
select prueba_debe_fallar($q$insert into revisiones(evento_id, decision) values ('f4000000-0000-0000-0000-000000000001', 'validada')$q$, 'revisiones_evento_id_key');
select prueba_debe_fallar($q$update revisiones set decision = 'observada' where evento_id = 'f4000000-0000-0000-0000-000000000001'$q$, 'permission denied');
select prueba_debe_fallar($q$delete from revisiones$q$, 'permission denied');

\echo '--- R3 IAP Demo no ve las de PA; el asesor ve las de sus checadas'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$ begin assert (select count(*) from revisiones) = 0, 'R3 otra organización no ve revisiones'; end $$;
select prueba_debe_fallar($q$insert into revisiones(evento_id, decision) values ('f4000000-0000-0000-0000-000000000002', 'validada')$q$, 'Solo coordinación');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin assert (select count(*) from revisiones where evento_id::text like 'f4000000%') = 2, 'R3 el asesor ve las revisiones de sus checadas'; end $$;

reset role;
select prueba_debe_fallar($q$update revisiones set comentario = 'x'$q$, 'Registro inalterable');
do $$
declare r record; n int;
begin
  select * into r from revisiones where evento_id = 'f4000000-0000-0000-0000-000000000001';
  -- El servidor ignora la organización y el revisor que mande el cliente
  assert r.organizacion_id = '11111111-1111-1111-1111-111111111111' and r.revisado_por = 'aaaaaaaa-0000-0000-0000-000000000002', 'R4 organización y revisor los fija el servidor';
  select estado_revision into r from eventos_jornada where id = 'f4000000-0000-0000-0000-000000000001';
  assert r.estado_revision = 'revisar', 'R4 la checada no cambia';
  select count(*) into n from bitacora where tabla = 'revisiones' and accion = 'INSERT';
  assert n = 2, 'R5 bitácora registra las revisiones';
  raise notice 'PRUEBAS 0004: OK';
end $$;
drop function public.prueba_debe_fallar(text, text);
