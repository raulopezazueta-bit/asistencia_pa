-- Pruebas de la migración 0005 · avisos (HU-15b, HU-30). Se corren después de las demás pruebas SQL. Datos ficticios.
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
insert into claves_push(vapid, token_cron) values ('{"publicKey":{},"privateKey":{}}', 'token-de-prueba');

set role authenticated;
\echo '--- S1 el asesor registra su teléfono; no puede registrar a nombre de otra persona'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select registrar_suscripcion('aaaaaaaa-0000-0000-0000-000000000001', 'https://push.ejemplo.test/telefono-1', 'BCLAVEP256DHDEPRUEBA0000000000', 'autentica-123', 'Prueba');
select prueba_debe_fallar($q$select registrar_suscripcion('aaaaaaaa-0000-0000-0000-000000000002', 'https://push.ejemplo.test/x', 'BCLAVEP256DHDEPRUEBA0000000000', 'autentica-123')$q$, 'Solo puedes registrar avisos para ti');
select prueba_debe_fallar($q$select registrar_suscripcion('aaaaaaaa-0000-0000-0000-000000000001', 'http://inseguro.test/x', 'BCLAVEP256DHDEPRUEBA0000000000', 'autentica-123')$q$, 'Suscripción inválida');
select prueba_debe_fallar($q$insert into suscripciones_push(organizacion_id, miembro_id, endpoint, p256dh, auth) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'https://x', 'a', 'b')$q$, 'permission denied');
do $$ begin assert (select count(*) from suscripciones_push) = 1, 'S1 ve la suya'; end $$;
select prueba_debe_fallar($q$select * from avisos_enviados$q$, 'permission denied');
select prueba_debe_fallar($q$select * from claves_push$q$, 'permission denied');

\echo '--- S2 otra persona no ve ni quita la suscripción ajena; si usa el mismo teléfono, el registro pasa a ella'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin assert (select count(*) from suscripciones_push) = 0, 'S2 no ve la ajena'; end $$;
select quitar_suscripcion('https://push.ejemplo.test/telefono-1');
reset role;
do $$ begin assert (select count(*) from suscripciones_push) = 1, 'S2 no la quitó'; end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select registrar_suscripcion('aaaaaaaa-0000-0000-0000-000000000002', 'https://push.ejemplo.test/telefono-1', 'BCLAVEP256DHDEPRUEBA0000000000', 'autentica-456');
reset role;
do $$ begin
  assert (select miembro_id from suscripciones_push where endpoint = 'https://push.ejemplo.test/telefono-1') = 'aaaaaaaa-0000-0000-0000-000000000002', 'S2 pasa a quien usa el teléfono';
  assert (select count(*) from suscripciones_push) = 1, 'S2 sin duplicados';
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select quitar_suscripcion('https://push.ejemplo.test/telefono-1');
reset role;
do $$ begin
  assert (select count(*) from suscripciones_push) = 0, 'S3 la propia se quita';
  raise notice 'PRUEBAS 0005: OK';
end $$;
drop function public.prueba_debe_fallar(text, text);
