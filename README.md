# App de Asistencia

Registro electrónico de jornada laboral (LFT art. 132, fr. XXXIV) para personal de campo de instituciones de asistencia privada.
PWA en JavaScript puro con Supabase (Postgres + PostGIS, Auth, Storage y RLS).

- Contexto técnico y reglas: [`CLAUDE.md`](CLAUDE.md)
- Especificación funcional: [`docs/ESPECIFICACION.md`](docs/ESPECIFICACION.md)
- Backlog técnico: [`docs/BACKLOG_TECNICO.md`](docs/BACKLOG_TECNICO.md)
- Esquema de base de datos: [`supabase/migrations/`](supabase/migrations/) · pruebas: [`supabase/tests/`](supabase/tests/)

Desarrollado por Ecosistémica – Consultoría Ambiental Integral.

## Pruebas locales

- SQL: `bash supabase/tests/correr_pruebas.sh` (requiere `postgresql` y `postgresql-16-postgis-3`).
- App (Playwright, solo desarrollo): `npm ci` y luego `npm test`. Dependencias y huellas: [`docs/DEPENDENCIAS.md`](docs/DEPENDENCIAS.md). La app publicada no usa npm.
  Las pruebas usan un Supabase simulado con usuarios ficticios (`tests/simulador.js`).
- Separación entre organizaciones de punta a punta (HU-07): `npm run prueba:separacion`.
  Levanta Postgres + PostGIS + PostgREST locales con la migración real y datos ficticios
  (`supabase/tests/e2e/`), corre la prueba y los apaga.
- Todo junto (simulador + API local): `npm run prueba:completa`.
