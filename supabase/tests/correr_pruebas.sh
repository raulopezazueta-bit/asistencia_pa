#!/usr/bin/env bash
# Prueba las migraciones en un Postgres 16 + PostGIS local (sin tocar Supabase).
# Requisitos: apt-get install -y postgresql postgis
set -euo pipefail
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
DIR=$(mktemp -d); chown postgres "$DIR"
su postgres -c "$PGBIN/initdb -D $DIR -A trust >/dev/null && $PGBIN/pg_ctl -D $DIR -l $DIR/log -o '-p 5499 -k /tmp' start >/dev/null"
sleep 2
P="psql -h /tmp -p 5499 -U postgres -q"
$P -c "create database t"
$P -d t -v ON_ERROR_STOP=1 -f "$(dirname "$0")/stub_supabase.sql"
for f in "$(dirname "$0")"/../migrations/*.sql; do $P -d t -v ON_ERROR_STOP=1 -f "$f"; echo "OK migración $(basename "$f")"; done
ERR=$($P -d t -f "$(dirname "$0")/pruebas_esquema.sql" 2>&1 | grep -c ERROR || true)
echo "Errores en pruebas_esquema.sql: $ERR (esperados: 5)"
$P -d t -f "$(dirname "$0")/pruebas_jornada_partida.sql"
R0002=$($P -d t -v ON_ERROR_STOP=1 -f "$(dirname "$0")/pruebas_0002.sql" 2>&1 || true)
echo "$R0002" | grep -q "PRUEBAS 0002: OK" && echo "PRUEBAS 0002: OK" || { echo "$R0002" | grep -E "ERROR|assert" ; echo "PRUEBAS 0002: FALLA"; su postgres -c "$PGBIN/pg_ctl -D $DIR stop >/dev/null"; exit 1; }
RINA=$($P -d t -v ON_ERROR_STOP=1 -f "$(dirname "$0")/pruebas_inalterabilidad.sql" 2>&1 || true)
echo "$RINA" | grep -q "PRUEBAS INALTERABILIDAD: OK" && ! echo "$RINA" | grep -q ERROR && echo "PRUEBAS INALTERABILIDAD: OK" || { echo "$RINA" | grep -E "ERROR" ; echo "PRUEBAS INALTERABILIDAD: FALLA"; su postgres -c "$PGBIN/pg_ctl -D $DIR stop >/dev/null"; exit 1; }
R0003=$($P -d t -v ON_ERROR_STOP=1 -f "$(dirname "$0")/pruebas_0003.sql" 2>&1 || true)
echo "$R0003" | grep -q "PRUEBAS 0003: OK" && echo "PRUEBAS 0003: OK" || { echo "$R0003" | grep -E "ERROR|assert" ; echo "PRUEBAS 0003: FALLA"; su postgres -c "$PGBIN/pg_ctl -D $DIR stop >/dev/null"; exit 1; }
su postgres -c "$PGBIN/pg_ctl -D $DIR stop >/dev/null"
[ "$ERR" = "5" ] && echo "PRUEBAS SQL: OK" || { echo "PRUEBAS SQL: REVISAR"; exit 1; }
