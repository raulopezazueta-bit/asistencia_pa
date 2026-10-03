#!/usr/bin/env bash
# Levanta una "API local" que se comporta como la de Supabase para probar RLS de punta a punta (HU-07):
#   Postgres 16 + PostGIS (puerto 5498) con stub + migraciones + datos ficticios
#   PostgREST 12.2 (puerto 3001), el mismo componente que atiende /rest/v1 en Supabase.
# Requisitos: postgresql, postgresql-16-postgis-3 y salida a github.com para descargar PostgREST la primera vez.
# Uso: bash supabase/tests/e2e/levantar_api_local.sh   ·   detener: bash supabase/tests/e2e/bajar_api_local.sh
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
HERR="$RAIZ/.herramientas"
ESTADO="$HERR/api_local"
VERSION_PGRST=v12.2.3
SECRETO="secreto-local-de-pruebas-hu07-no-es-de-supabase-000"   # solo para esta API local

mkdir -p "$HERR"
if [ ! -x "$HERR/postgrest" ]; then
  curl -sSL -o "$HERR/postgrest.tar.xz" "https://github.com/PostgREST/postgrest/releases/download/$VERSION_PGRST/postgrest-$VERSION_PGRST-linux-static-x64.tar.xz"
  tar xJf "$HERR/postgrest.tar.xz" -C "$HERR" && rm "$HERR/postgrest.tar.xz"
fi

bash "$AQUI/bajar_api_local.sh" >/dev/null 2>&1 || true
rm -rf "$ESTADO"; mkdir -p "$ESTADO"; chown postgres "$ESTADO"
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
su postgres -c "$PGBIN/initdb -D $ESTADO/pg -A trust >/dev/null && $PGBIN/pg_ctl -D $ESTADO/pg -l $ESTADO/pg.log -o '-p 5498 -k /tmp' start >/dev/null"
for _ in $(seq 1 20); do psql -h /tmp -p 5498 -U postgres -qtAc 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done
P="psql -h /tmp -p 5498 -U postgres -q -v ON_ERROR_STOP=1"
$P -c "create database t"
$P -d t -f "$RAIZ/supabase/tests/stub_supabase.sql"
for f in "$RAIZ"/supabase/migrations/*.sql; do $P -d t -f "$f"; done
$P -d t -f "$AQUI/datos_ficticios.sql"
# Rol con el que entra PostgREST (en Supabase se llama igual) y que cambia a anon/authenticated según el JWT
$P -d t -c "create role authenticator login noinherit; grant anon, authenticated to authenticator;"

cat > "$ESTADO/postgrest.conf" <<CONF
db-uri = "postgres://authenticator@/t?host=/tmp&port=5498"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
jwt-secret = "$SECRETO"
server-port = 3001
CONF
nohup "$HERR/postgrest" "$ESTADO/postgrest.conf" >"$ESTADO/postgrest.log" 2>&1 &
echo $! > "$ESTADO/postgrest.pid"
for _ in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3001/ && break; sleep 0.5; done
curl -s -o /dev/null -w "API local lista en http://localhost:3001 (HTTP %{http_code})\n" http://localhost:3001/
