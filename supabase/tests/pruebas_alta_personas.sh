#!/usr/bin/env bash
# Prueba que los bloques SQL de docs/ALTA_PERSONAS.md funcionan tal cual (HU-09a).
# Los extrae del documento, sustituye los valores de ejemplo y los corre en un Postgres 16 + PostGIS local.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
DOC="$RAIZ/docs/ALTA_PERSONAS.md"
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
DIR=$(mktemp -d); chown postgres "$DIR"
su postgres -c "$PGBIN/initdb -D $DIR -A trust >/dev/null && $PGBIN/pg_ctl -D $DIR -l $DIR/log -o '-p 5497 -k /tmp' start >/dev/null"
trap 'su postgres -c "$PGBIN/pg_ctl -D $DIR stop -m fast" >/dev/null; rm -rf "$DIR"' EXIT
for _ in $(seq 1 20); do psql -h /tmp -p 5497 -U postgres -qtAc 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done
P="psql -h /tmp -p 5497 -U postgres -q -v ON_ERROR_STOP=1 -d t"
psql -h /tmp -p 5497 -U postgres -qc "create database t"
$P -f "$AQUI/stub_supabase.sql"
for f in "$RAIZ"/supabase/migrations/*.sql; do $P -f "$f"; done
# En Supabase, auth.users tiene correo; el stub no: se agrega para la prueba.
$P -c "alter table auth.users add column email text, add column email_confirmed_at timestamptz;
       insert into auth.users values ('00000000-0000-0000-0000-0000000000aa', 'nueva@prueba.test', now());
       insert into organizaciones(slug, nombre) values ('parques-alegres', 'Parques Alegres IAP'), ('iap-demo', 'IAP Demo');"

UID_PRUEBA=00000000-0000-0000-0000-0000000000aa
bloque() {   # n-ésimo bloque ```sql del documento, con los valores de ejemplo sustituidos
  awk -v n="$1" '/^```sql/{c++; dentro=(c==n); next} /^```/{dentro=0} dentro' "$DOC" \
    | sed -e "s/PEGA-AQUI-EL-USER-UID/$UID_PRUEBA/g" -e "s/correo@de.la.persona/nueva@prueba.test/g"
}
cuenta() { $P -tAc "$1"; }
falla() { echo "ALTA_PERSONAS: FALLA — $1"; exit 1; }

bloque 1 | $P >/dev/null                                            # paso 2: miembro
[ "$(cuenta "select count(*) from miembros where user_id = '$UID_PRUEBA' and activo")" = 1 ] || falla "paso 2"
bloque 2 | $P >/dev/null                                            # paso 3: horario
[ "$(cuenta "select count(*) from horarios")" = 10 ] || falla "paso 3 (se esperaban 10 bloques)"
[ "$(bloque 3 | $P -tA | cut -d'|' -f7)" = 10 ] || falla "paso 4 (revisión)"
bloque 4 | $P >/dev/null                                            # cerrar horario
[ "$(cuenta "select count(*) from horarios where vigente_hasta = current_date")" = 10 ] || falla "cerrar horario"
bloque 2 | sed "s/current_date             as vigente_desde/current_date + 1 as vigente_desde/" | $P >/dev/null
[ "$(cuenta "select count(*) from horarios")" = 20 ] || falla "horario nuevo"
bloque 5 | $P >/dev/null                                            # baja lógica
[ "$(cuenta "select count(*) from miembros where activo = false and fecha_baja = current_date")" = 1 ] || falla "baja"
# Alta en una segunda organización con el mismo usuario
bloque 1 | sed "s/'parques-alegres'                        as organizacion/'iap-demo' as organizacion/" | $P >/dev/null
[ "$(cuenta "select count(*) from miembros where user_id = '$UID_PRUEBA'")" = 2 ] || falla "segunda organización"
# Primera persona de administración (HU-09)
bloque 6 | $P >/dev/null
[ "$(cuenta "select count(*) from miembros where user_id = '$UID_PRUEBA' and rol = 'admin' and organizacion_id = (select id from organizaciones where slug = 'parques-alegres')")" = 1 ] || falla "primera administración"
[ "$(cuenta "select count(*) from miembros where user_id = '$UID_PRUEBA' and rol = 'admin'")" = 1 ] || falla "administración solo en parques-alegres"
echo "ALTA_PERSONAS: OK (6 bloques SQL de docs/ALTA_PERSONAS.md probados)"
