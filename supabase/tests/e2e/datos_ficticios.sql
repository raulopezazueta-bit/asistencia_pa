-- Datos FICTICIOS para la prueba e2e de separación entre organizaciones (HU-07). Nunca datos reales.
-- Dos organizaciones con la misma forma de datos: lo de una no debe verse desde la otra.
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
 ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');

insert into organizaciones(id, slug, nombre) values
 ('11111111-1111-1111-1111-111111111111', 'parques-alegres', 'Parques Alegres IAP'),
 ('22222222-2222-2222-2222-222222222222', 'iap-demo', 'IAP Demo');

insert into miembros(id, organizacion_id, user_id, nombre_completo, rol) values
 ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a', 'Asesor de Prueba', 'asesor'),
 ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b', 'Coordinación de Prueba', 'coordinador'),
 ('aaaaaaaa-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000c', 'Asesor Demo', 'asesor'),
 ('aaaaaaaa-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000d', 'Admin Demo', 'admin');

insert into sitios(id, organizacion_id, clave_externa, nombre, tipo, centro, perimetro, miembro_id) values
 ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'PA-1', 'Parque Ficticio Uno', 'parque',
  'SRID=4326;POINT(-107.4373 24.8046)', 'SRID=4326;MULTIPOLYGON(((-107.4378 24.8041,-107.4368 24.8041,-107.4368 24.8051,-107.4378 24.8051,-107.4378 24.8041)))', null),
 ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'PA-2', 'Parque Ficticio Dos', 'parque',
  'SRID=4326;POINT(-107.4000 24.8000)', null, null),
 ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', null, 'Domicilio ficticio PA', 'domicilio',
  'SRID=4326;POINT(-107.4100 24.8100)', null, 'aaaaaaaa-0000-0000-0000-000000000001'),
 ('bbbbbbbb-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'DEMO-1', 'Parque Demo', 'parque',
  'SRID=4326;POINT(-107.3900 24.7900)', null, null);

insert into horarios(organizacion_id, miembro_id, dia_semana, bloque, hora_inicio, hora_fin, modalidad) values
 ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 'escritorio', '09:00', '13:00', 'teletrabajo'),
 ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 'campo', '16:00', '20:00', 'presencial'),
 ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000003', 1, 'campo', '16:00', '20:00', 'presencial');

insert into eventos_jornada(id, miembro_id, tipo, bloque, hora_dispositivo, lat, lon, precision_m, selfie_path, capturado_sin_conexion) values
 ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'inicio_bloque', 'campo', '2026-10-01 16:00-07', 24.8047, -107.4372, 6, 'x.webp', true),
 ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'fin_bloque',    'campo', '2026-10-01 20:00-07', 24.8047, -107.4372, 6, 'x.webp', true),
 ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003', 'inicio_bloque', 'campo', '2026-10-01 16:05-07', 24.7900, -107.3900, 6, 'y.webp', true),
 ('cccccccc-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000003', 'fin_bloque',    'campo', '2026-10-01 19:55-07', 24.7900, -107.3900, 6, 'y.webp', true);

insert into incidencias(id, miembro_id, tipo, motivo) values
 ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'otro', 'Incidencia ficticia de PA'),
 ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003', 'otro', 'Incidencia ficticia de Demo');
