-- HU-33 · Inalterabilidad de selfies y bitácora (se corre después de pruebas_esquema.sql y pruebas_0002.sql).
-- Las selfies (storage.objects) no tienen políticas de update/delete: nadie puede reemplazarlas ni borrarlas.
\set ON_ERROR_STOP 1
reset role;
insert into storage.objects(bucket_id, name) values
  ('selfies', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/2026/10/inalterable.webp');

set role authenticated;
do $$
declare n int;
begin
  -- Dueña de la selfie (asesora de PA)
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  update storage.objects set name = name || '.x' where bucket_id = 'selfies'; get diagnostics n = row_count;
  assert n = 0, 'la dueña pudo renombrar/reemplazar una selfie';
  delete from storage.objects where bucket_id = 'selfies'; get diagnostics n = row_count;
  assert n = 0, 'la dueña pudo borrar una selfie';
  -- Coordinación de PA
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  delete from storage.objects where bucket_id = 'selfies'; get diagnostics n = row_count;
  assert n = 0, 'coordinación pudo borrar una selfie';
  -- Administración (de otra organización) no puede tocar la bitácora
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
  begin
    delete from bitacora where true;
    raise exception 'la administración pudo borrar la bitácora';
  exception when insufficient_privilege then null;
  end;
  begin
    update bitacora set accion = 'x' where true;
    raise exception 'la administración pudo editar la bitácora';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBAS INALTERABILIDAD: OK';
end $$;
reset role;
do $$ begin
  assert (select count(*) from storage.objects where name like '%inalterable.webp') = 1, 'la selfie ya no está';
end $$;
