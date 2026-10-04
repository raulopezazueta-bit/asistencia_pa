-- Pruebas de la migración 0002 (se corren después de pruebas_esquema.sql). Cada caso se verifica con assert:
-- si algo no coincide, el script se detiene con error. Datos ficticios.
\set ON_ERROR_STOP 1
reset role;

-- Organización ficticia con validar_domicilio = true; persona con domicilio y un parque a ~33 m del domicilio
insert into auth.users values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2');
insert into organizaciones(id, slug, nombre, config) values ('33333333-3333-3333-3333-333333333333', 'org-domicilio', 'Org Domicilio',
  (select config from organizaciones where slug = 'parques-alegres') || '{"validar_domicilio": true}');
insert into miembros(id, organizacion_id, user_id, nombre_completo, rol) values
 ('eeeeeeee-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-0000000000e1', 'Con Domicilio', 'asesor'),
 ('eeeeeeee-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-0000000000e2', 'Sin Domicilio', 'asesor');
insert into sitios(id, organizacion_id, nombre, tipo, centro, radio_m, miembro_id) values
 ('dddddddd-0000-0000-0000-00000000d001', '33333333-3333-3333-3333-333333333333', 'Domicilio ficticio', 'domicilio', 'SRID=4326;POINT(-107.30 24.70)', 50, 'eeeeeeee-0000-0000-0000-000000000001'),
 ('dddddddd-0000-0000-0000-00000000d002', '33333333-3333-3333-3333-333333333333', 'Parque junto al domicilio', 'parque', 'SRID=4326;POINT(-107.30 24.7003)', 80, null);

set role authenticated;

\echo '--- P1 pausas en parques-alegres (validar_domicilio = false): la zona no se revisa'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into eventos_jornada(id, miembro_id, tipo, hora_dispositivo, lat, lon, precision_m) values
 ('f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'inicio_pausa', now(), 24.8110, -107.4373, 8),   -- ~700 m: ningún sitio
 ('f0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'fin_pausa',    now(), 24.8058, -107.4373, 8);   -- ~78 m del parque
insert into eventos_jornada(id, miembro_id, tipo, hora_dispositivo) values
 ('f0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'inicio_pausa', now());                             -- sin ubicación

\echo '--- P2 teletrabajo con validar_domicilio = true: solo cuenta el domicilio propio'
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
insert into eventos_jornada(id, miembro_id, tipo, bloque, modalidad, hora_dispositivo, lat, lon, precision_m, selfie_path, sitio_id) values
 ('f0000000-0000-0000-0000-000000000011', 'eeeeeeee-0000-0000-0000-000000000001', 'inicio_bloque', 'escritorio', 'teletrabajo', now(), 24.7003, -107.30, 5, 's', null),       -- en el parque, a ~33 m de casa
 ('f0000000-0000-0000-0000-000000000012', 'eeeeeeee-0000-0000-0000-000000000001', 'fin_bloque',    'escritorio', 'teletrabajo', now(), 24.7020, -107.30, 5, 's', null),       -- ~222 m de casa
 ('f0000000-0000-0000-0000-000000000013', 'eeeeeeee-0000-0000-0000-000000000001', 'inicio_bloque', 'escritorio', 'teletrabajo', now(), 24.7003, -107.30, 5, 's', 'dddddddd-0000-0000-0000-00000000d002'), -- manda el parque
 ('f0000000-0000-0000-0000-000000000014', 'eeeeeeee-0000-0000-0000-000000000001', 'inicio_bloque', 'campo',      'presencial',  now(), 24.7003, -107.30, 5, 's', null);       -- campo: sí cuenta el parque
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e2';
insert into eventos_jornada(id, miembro_id, tipo, bloque, modalidad, hora_dispositivo, lat, lon, precision_m, selfie_path) values
 ('f0000000-0000-0000-0000-000000000021', 'eeeeeeee-0000-0000-0000-000000000002', 'inicio_bloque', 'escritorio', 'teletrabajo', now(), 24.7003, -107.30, 5, 's');            -- sin domicilio registrado

reset role;
select left(id::text, 8) || right(id::text, 2) as id, tipo, modalidad, (select nombre from sitios where id = sitio_id) sitio,
       round(distancia_sitio_m) dist, dentro_geocerca, estado_revision, motivos_revision
from eventos_jornada where id::text like 'f0000000%' order by id;

do $$
declare e record;
begin
  -- P1
  select * into e from eventos_jornada where id = 'f0000000-0000-0000-0000-000000000001';
  assert e.dentro_geocerca is null and e.sitio_id is null and e.motivos_revision = '{}' and e.estado_revision = 'ok', 'P1a pausa lejos';
  select * into e from eventos_jornada where id = 'f0000000-0000-0000-0000-000000000002';
  assert e.dentro_geocerca is null and e.sitio_id = 'bbbbbbbb-0000-0000-0000-000000000001' and e.distancia_sitio_m between 70 and 90
         and e.motivos_revision = '{}', 'P1b pausa cerca: sitio y distancia informativos';
  select * into e from eventos_jornada where id = 'f0000000-0000-0000-0000-000000000003';
  assert e.dentro_geocerca is null and e.motivos_revision = '{}', 'P1c pausa sin ubicación no se marca';
  -- P2
  select * into e from eventos_jornada where id = 'f0000000-0000-0000-0000-000000000011';
  assert e.sitio_id = 'dddddddd-0000-0000-0000-00000000d001' and e.dentro_geocerca and e.motivos_revision = '{}', 'P2a teletrabajo usa el domicilio aunque haya un parque más cerca';
  select * into e from eventos_jornada where id = 'f0000000-0000-0000-0000-000000000012';
  assert e.sitio_id = 'dddddddd-0000-0000-0000-00000000d001' and not e.dentro_geocerca and 'fuera_de_geocerca' = any(e.motivos_revision), 'P2b lejos de casa: fuera';
  select * into e from eventos_jornada where id = 'f0000000-0000-0000-0000-000000000013';
  assert e.sitio_id = 'dddddddd-0000-0000-0000-00000000d001' and e.dentro_geocerca, 'P2c se ignora el parque enviado por el teléfono';
  select * into e from eventos_jornada where id = 'f0000000-0000-0000-0000-000000000014';
  assert e.sitio_id = 'dddddddd-0000-0000-0000-00000000d002' and e.dentro_geocerca, 'P2d campo presencial sigue usando parques';
  select * into e from eventos_jornada where id = 'f0000000-0000-0000-0000-000000000021';
  assert e.sitio_id is null and not e.dentro_geocerca and 'fuera_de_geocerca' = any(e.motivos_revision), 'P2e sin domicilio registrado: fuera';
  raise notice 'PRUEBAS 0002: OK';
end $$;
