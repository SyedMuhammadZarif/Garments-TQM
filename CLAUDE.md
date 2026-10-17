# CLAUDE.md — Novabe Garments TQM

This repository builds a Total Quality Management (TQM) platform for garment factories.
The complete product and technical specification lives in `docs/SPEC.md`. It is the source of truth.
Read it fully before writing any code, and re-read the relevant section before starting each milestone.

## How to work in this repo

1. Work strictly milestone by milestone, in the order given in `docs/SPEC.md` §21.
   Do not start a milestone until the previous one meets its acceptance criteria.
2. At the start of a milestone, write a short plan (files to create/change, migrations, endpoints, screens)
   and show it to the user before implementing.
3. At the end of a milestone:
   - run `npm run typecheck`, `npm run lint`, `npm test` — all must pass with zero errors;
   - run the app and manually verify every acceptance criterion listed for that milestone;
   - update `docs/PROGRESS.md` (what was built, decisions taken, known gaps);
   - stop and report to the user. Do not roll into the next milestone without a go-ahead.
4. If the spec is ambiguous or contradicts itself, STOP and ask. Never silently guess business rules
   (AQL values, KPI formulas, permissions, workflow states). If a value is factory-specific, make it configurable
   and seed a sensible, clearly-labelled default.
5. Never mark something done that is stubbed, mocked or partially implemented. If you must leave a gap,
   record it in `docs/PROGRESS.md` under "Known gaps" and tell the user.

## Hard constraints (non-negotiable)

- Stack ONLY: PostgreSQL, Node.js 22 LTS, Express, TypeScript, React, Vite, Tailwind CSS.
- Runtime dependencies are limited to the allowlist in `docs/SPEC.md` §2.2.
  Adding ANY other runtime dependency (ORM, state library, UI kit, chart library, date library, validation library,
  Redis, queue library, image library, helmet, cors, dotenv, axios, etc.) is forbidden unless the user explicitly approves it.
  If you think a package is needed, ask first and explain why it cannot reasonably be written in-house.
- Raw SQL through `pg` only. Migrations are plain `.sql` files. No ORM, no query builder.
- TypeScript `strict: true` everywhere. No `any` unless commented with a reason. No `@ts-ignore`.
- All IDs are UUIDs generated on the CLIENT for client-created records (`crypto.randomUUID()`).
- All mutating endpoints accept an `Idempotency-Key` header and are safe to retry.
- Every business table has `version`, `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at`.
- Frontend components never call `fetch` directly. All data access goes through `apps/web/src/data/`.
- Business calculations (AQL verdict, DHU, FPY, 4-point score, tolerance checks) live in `packages/shared`
  and are executed authoritatively on the server. The client may preview them; the server decides.
- The app is English only (Bengali may be added later). Every user-visible string still goes through `t()` with keys
  in `apps/web/src/i18n/en.json`. No hard-coded UI text, no `bn` catalogs or `*_bn` columns.
- Do not build offline mode, Capacitor packaging, ERP connectors, buyer portal or S3 archiving now.
  They are explicitly out of scope (`docs/SPEC.md` §23). Only follow the "offline-ready" rules.
- Never use real brand names, real buyer names or real people in seed/demo data.

## Commands (must exist and work after Milestone 0)

```
npm install                 # install all workspaces
npm run dev                 # api (tsx watch) + web (vite) together
npm run db:migrate          # apply pending migrations
npm run db:reset            # drop, recreate, migrate, seed base data (dev only)
npm run seed:base           # roles, permissions, defect library, AQL tables, garment templates
npm run seed:demo           # demo factory with 60 days of realistic data (for screenshots)
npm run typecheck
npm run lint
npm test
npm run build
docker compose up -d        # production-like stack: postgres, api(+worker), nginx
```

## Repo map

```
apps/api        Express + TypeScript API and background worker
apps/web        React + Vite + Tailwind web app (Floor shell + Desk shell)
packages/shared Types, validators, calculations, constants shared by api and web
db/migrations   Plain SQL migrations, numbered 0001_*.sql
db/seed         Seed scripts and seed data files
deploy          docker-compose.yml, nginx.conf, backup scripts
docs            SPEC.md (source of truth), PROGRESS.md, DECISIONS.md
```

## Style

- Small, focused files. Routes are thin; logic lives in services; SQL lives in repos.
- Name things after the domain (inspection, defect, capa), not after technology.
- Prefer clarity over cleverness. Comment the "why", not the "what".
- When you make a non-obvious technical decision, append it to `docs/DECISIONS.md` (date, decision, reason).
