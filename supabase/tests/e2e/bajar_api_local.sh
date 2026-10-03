#!/usr/bin/env bash
# Detiene la API local de la prueba e2e (PostgREST + Postgres) y borra sus datos.
RAIZ="$(cd "$(dirname "$0")/../../.." && pwd)"
ESTADO="$RAIZ/.herramientas/api_local"
[ -f "$ESTADO/postgrest.pid" ] && kill "$(cat "$ESTADO/postgrest.pid")" 2>/dev/null
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
[ -d "$ESTADO/pg" ] && su postgres -c "$PGBIN/pg_ctl -D $ESTADO/pg stop -m fast" >/dev/null 2>&1
rm -rf "$ESTADO"
echo "API local detenida"
