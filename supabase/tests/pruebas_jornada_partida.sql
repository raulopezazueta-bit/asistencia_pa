-- Requiere haber corrido pruebas_esquema.sql. Resultado esperado: 460 minutos efectivos (480 - 20 de pausa dentro del bloque de campo; la comida entre bloques no resta).
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
insert into eventos_jornada(id,miembro_id,tipo,bloque,hora_dispositivo,capturado_sin_conexion,modalidad) values
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000003','inicio_bloque','escritorio','2026-10-01 09:00-07',true,'teletrabajo'),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000003','fin_bloque','escritorio','2026-10-01 13:00-07',true,'teletrabajo'),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000003','inicio_pausa',null,'2026-10-01 13:05-07',true,'teletrabajo'),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000003','fin_pausa',null,'2026-10-01 13:55-07',true,'teletrabajo'),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000003','inicio_bloque','campo','2026-10-01 16:00-07',true,'presencial'),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000003','inicio_pausa',null,'2026-10-01 18:00-07',true,'presencial'),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000003','fin_pausa',null,'2026-10-01 18:20-07',true,'presencial'),
 (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000003','fin_bloque','campo','2026-10-01 20:00-07',true,'presencial');
select nombre_completo, fecha, inicio_jornada, fin_jornada, minutos_pausa, minutos_efectivos, jornada_abierta from v_jornada_diaria where fecha='2026-10-01';
