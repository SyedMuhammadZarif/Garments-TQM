# Progress

## Milestone 0 — Foundation ✅ (2026-10-18, awaiting review)

### Built
- npm workspaces: `packages/shared`, `apps/api`, `apps/web`; strict `tsconfig.base.json` (all §4 flags);
  ESLint (type-checked) + Prettier; `.env.example` (all of §22.3 + DeepSeek vars).
- **API:** Express 5 app factory (`app.ts`) + server with graceful shutdown; `config.ts` validates every env var and
  reports all problems at once; pg pool with §22.2 timeouts; `GET /api/v1/health` → `{ status, db, time }`;
  JSON 404 envelope for unknown API routes.
- **Database:** plain-SQL migration runner with checksums and advisory lock; `0001_extensions_enums.sql`
  (pgcrypto, citext, pg_trgm + all 15 enums of §7.2).
- **Commands:** `dev`, `db:migrate`, `db:reset`, `seed:base`, `seed:demo`, `typecheck`, `lint`, `test`, `build`,
  `docker compose up -d`.
- **Web:** Vite 6 + React 19 + Tailwind 4 hello page showing API and database status; data access only via
  `src/data/` (lint-enforced); English text via `i18n/en.json`; PWA manifest; Novabe logo.
- **Deploy:** `deploy/docker-compose.yml` (postgres 16, api running migrations then server, nginx web),
  `api.Dockerfile`, `web.Dockerfile`, `nginx.conf` (SPA fallback, `/api` proxy, SSE locations unbuffered,
  internal `/_protected/uploads/`, gzip, immutable asset caching, security headers).
- **Tests (17, node:test):** config validation (6), migration runner against real Postgres (5: order/skip, edited
  file refused, failed migration rolled back, bad/duplicate names, real migrations apply), health endpoint (3: ok,
  DB down → 503, 404 envelope), error codes (2), i18n catalog (1).

### Verified manually
- `npm run typecheck`, `npm run lint`, `npm test` — zero errors, 17/17 pass.
- `npm run db:migrate` applies 0001, second run reports up to date; `npm run db:reset` drops, recreates, migrates, seeds.
- `npm run dev`: web on :5173 proxies `/api` to :4000; editing API, shared or web code reloads automatically.
- `npm run build`; compiled API (`node apps/api/dist/server.js`) serves health without the dev-only `source` condition.
- Compose stack (see gap below): web on :8080, `/api/v1/health` → db ok through nginx, deep links fall back to the SPA,
  security headers present, hashed assets cached immutable + gzip, `/_protected/uploads/` not publicly reachable,
  migrations applied on api start and skipped on restart.

### Decisions
See `docs/DECISIONS.md` (2026-10-17 entries) and `docs/SPEC.md` "Changes in 1.1".

### Known gaps
- **Docker images not built end-to-end in the dev sandbox.** The cloud sandbox blocks package downloads inside
  containers, so `npm ci` in `api.Dockerfile` / `web.Dockerfile` could not run here. The stack was verified with the
  same base images, compose file and nginx config, using artifacts built on the host. **Action:** run
  `docker compose up -d --build` once on a normal machine (needs `JWT_SECRET` in `.env`, ≥ 32 bytes, not the
  example value) and open http://localhost:8080.
- `seed:base` seeds nothing yet — roles/permissions arrive in M1, defects/AQL/garments/templates in M3.
- `seed:demo` is a placeholder until M15.
- Hello page only; i18n is a minimal `translate()` until M1's `useT()`.
