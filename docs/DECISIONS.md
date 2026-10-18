# Decisions

Non-obvious technical and product decisions, newest last. Format: date — decision — reason.

## 2026-10-17

- **Spec 1.1 changes agreed with the client** — English only (Bengali later via a new catalog); product name
  "Novabe Garments TQM"; cost per piece entered when each QC check is created; AI Quality Report via DeepSeek
  (new §18.9, Milestone 10b); Command Center adds Rejection Rate, Worst Buyers, On-Time Delivery. — Client decisions;
  recorded in `docs/SPEC.md` "Changes in 1.1".
- **TypeScript 5.9.3, not 7.x** — `typescript-eslint` 8.x supports TypeScript < 6.1. Revisit when it supports 7.
- **`@vitejs/plugin-react` 4.7.0** — newest line that declares Vite 6 support cleanly; spec pins Vite 6.
- **`@tqm/shared` uses a custom `source` export condition** — dev (`tsx --conditions=source`), tests and Vite resolve
  the TypeScript sources directly, so no build step is needed while developing. Production Node resolves the
  `default` condition (`dist/`), built by `npm run build -w @tqm/shared`. The API's `tsconfig.build.json` sets
  `customConditions: []` so `tsc` emits against `dist/*.d.ts` and never compiles shared sources into `apps/api/dist`.
- **Env files loaded with `--env-file-if-exists`** (Node ≥ 22.9) — no dotenv; a missing `.env` is fine in containers
  where variables come from Compose.
- **Migration runner** — one transaction per file, sha256 checksum stored in `schema_migrations`; refuses to run if an
  applied file was edited or is missing on disk; takes a Postgres advisory lock so parallel api starts are safe.
  `schema_migrations` also stores the file name (in addition to the spec's `version, applied_at, checksum`) for clearer
  error messages.
- **The api container runs migrations on every start**, then the server (SPEC §22.4).
- **Root `compose.yaml` includes `deploy/docker-compose.yml`** — keeps the spec's file location while making
  `docker compose up -d` work from the repo root, as CLAUDE.md lists it. Root `.env` provides `JWT_SECRET` etc.
- **Integration tests use a throwaway schema per test** inside `DATABASE_URL_TEST` (SPEC §22.1 allows "fresh schema
  per run"), so tests never touch the dev database and can run in parallel.
- **ESLint `no-restricted-globals: fetch` for `apps/web/src/**` except `src/data/**`** — enforces "components never
  call fetch directly" mechanically.
- **`/health` returns 503 with the normal data envelope when the DB is down** — load balancers see the failure, the
  UI can still show which part is down.
- **DeepSeek settings (`DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`) validated from M0** — empty key means
  AI features are disabled, nothing else breaks. Called later with Node's built-in `fetch` (no SDK dependency).
