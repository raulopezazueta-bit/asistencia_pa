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
- App (Playwright, solo desarrollo): `npm install` y luego `npm test`. La app publicada no usa npm.
