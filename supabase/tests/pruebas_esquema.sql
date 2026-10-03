-- Pruebas de comportamiento. Errores ESPERADOS (5): UPDATE y DELETE de eventos, evento a nombre de otro,
-- resolver incidencia dos veces, subir selfie a carpeta de otra organización.
\set ON_ERROR_STOP 0
-- Datos base (como postgres / dashboard)
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d');
insert into organizaciones(id,slug,nombre) values ('11111111-1111-1111-1111-111111111111','parques-alegres','Parques Alegres IAP'),('22222222-2222-2222-2222-222222222222','iap-demo','IAP Demo');
insert into miembros(id,organizacion_id,user_id,nombre_completo,rol) values
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000a','Asesora Uno','asesor'),
 ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000b','Coord PA','coordinador'),
 ('aaaaaaaa-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000000c','Asesor Demo','asesor'),
 ('aaaaaaaa-0000-0000-0000-000000000004','22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000000d','Admin Demo','admin');
-- Parque con polígono ~100x100 m alrededor de 24.8046,-107.4373
insert into sitios(id,organizacion_id,clave_externa,nombre,tipo,centro,perimetro) values
 ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','14601','P. Villas del Río','parque',
  'SRID=4326;POINT(-107.4373 24.8046)', 'SRID=4326;MULTIPOLYGON(((-107.4378 24.8041,-107.4368 24.8041,-107.4368 24.8051,-107.4378 24.8051,-107.4378 24.8041)))');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
\echo '--- T1 dentro de geocerca, en línea'
insert into eventos_jornada(id,miembro_id,organizacion_id,tipo,bloque,hora_dispositivo,lat,lon,precision_m,selfie_path)
 values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','inicio_bloque','campo',now(),24.8047,-107.4372,6,'x.webp');
\echo '--- T2 fuera de geocerca (~700 m), sin selfie'
insert into eventos_jornada(id,miembro_id,tipo,bloque,hora_dispositivo,lat,lon,precision_m)
 values ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','llegada_sitio',null,now(),24.8110,-107.4373,8);
\echo '--- T3 offline 3 h antes, dentro'
insert into eventos_jornada(id,miembro_id,tipo,bloque,hora_dispositivo,lat,lon,capturado_sin_conexion,selfie_path)
 values ('cccccccc-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','fin_bloque','campo',now()-interval '3 hours',24.8046,-107.4373,true,'y.webp');
\echo '--- T3b offline con hora futura'
insert into eventos_jornada(id,miembro_id,tipo,bloque,hora_dispositivo,lat,lon,capturado_sin_conexion,selfie_path) values ('cccccccc-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000001','fin_pausa',null,now()+interval '1 hour',24.8046,-107.4373,true,'q');
\echo '--- T4 reloj alterado en línea (+30 min)'
insert into eventos_jornada(id,miembro_id,tipo,bloque,hora_dispositivo,lat,lon,selfie_path)
 values ('cccccccc-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','inicio_pausa',null,now()-interval '30 min',24.8046,-107.4373,'z');
\echo '--- T5 teletrabajo sin ubicacion'
insert into eventos_jornada(id,miembro_id,tipo,bloque,modalidad,hora_dispositivo,selfie_path)
 values ('cccccccc-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','inicio_bloque','escritorio','teletrabajo',now(),'w');
select left(id::text,8) id, tipo, organizacion_id=('11111111-1111-1111-1111-111111111111') org_ok, round(distancia_sitio_m) dist, dentro_geocerca, estado_revision, motivos_revision, hora_efectiva=hora_dispositivo usa_disp from eventos_jornada order by id;
\echo '--- T6 UPDATE debe fallar'
update eventos_jornada set lat=0 where id='cccccccc-0000-0000-0000-000000000001';
\echo '--- T7 DELETE debe fallar'
delete from eventos_jornada where id='cccccccc-0000-0000-0000-000000000001';
\echo '--- T8 insertar evento a nombre de otro debe fallar'
insert into eventos_jornada(id,miembro_id,tipo,bloque,hora_dispositivo) values (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000003','inicio_bloque','campo',now());
\echo '--- T9 duplicado idempotente (on conflict do nothing)'
insert into eventos_jornada(id,miembro_id,tipo,bloque,hora_dispositivo) values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','inicio_bloque','campo',now()) on conflict (id) do nothing;
\echo '--- T10 incidencia y autoaprobacion'
insert into incidencias(id,miembro_id,tipo,tipo_evento_propuesto,hora_propuesta,motivo) values ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','omision','fin_pausa',now()-interval '10 min','Olvidé checar regreso de comida');
update incidencias set estado='aprobada' where id='dddddddd-0000-0000-0000-000000000001';
select count(*) as filas_afectadas_asesor from incidencias where estado='aprobada';
\echo '--- T11 org demo no ve nada de PA'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select count(*) eventos_visibles_demo from eventos_jornada;
select count(*) sitios_visibles_demo from sitios;
\echo '--- T12 coordinador PA aprueba'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select count(*) eventos_visibles_coord from eventos_jornada;
update incidencias set estado='aprobada', comentario_resolucion='ok' where id='dddddddd-0000-0000-0000-000000000001';
select tipo, origen, estado_revision, incidencia_id is not null from eventos_jornada where origen='incidencia';
\echo '--- T13 resolver dos veces falla'
update incidencias set estado='rechazada' where id='dddddddd-0000-0000-0000-000000000001';
\echo '--- T14 vista jornada'
select nombre_completo, fecha, minutos_pausa, minutos_efectivos, jornada_abierta, con_revision, bloques from v_jornada_diaria;
\echo '--- T15 asesor no ve bitacora; storage path'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select count(*) bitacora_asesor from bitacora;
insert into storage.objects(bucket_id,name) values ('selfies','11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/2026/10/x.webp');
insert into storage.objects(bucket_id,name) values ('selfies','22222222-2222-2222-2222-222222222222/aaaaaaaa-0000-0000-0000-000000000003/2026/10/x.webp');
reset role;
select count(*) bitacora_total from bitacora;
