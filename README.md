# PROMPTHON server

Production-oriented Express + TypeScript API for PROMPTHON 2026. The server is a modular monolith backed by Prisma ORM and PostgreSQL/Supabase.

## Safe local setup

1. Copy `.env.example` to `.env` and provide local values. Never commit `.env`.
2. Use a pooled Supabase URL for `DATABASE_URL` and a direct URL for `DIRECT_URL`.
3. Optionally set `ADMIN_EMAIL` and a one-time `ADMIN_PASSWORD` (minimum 12 characters) for the seed.
4. Run:

```powershell
npm install
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run dev
```

`prisma:migrate:deploy` changes the configured database. Review the migration and confirm the target before running it.

## Quality commands

```powershell
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

## API

- Base path: `/api/v1`
- Session: opaque token in an HttpOnly, SameSite=Strict cookie
- Success envelope: `{ "data": ... }`
- Error envelope: `{ "error": { "code", "message", "details?", "requestId" } }`
- Health: `GET /api/v1/health/live` and `GET /api/v1/health/ready`
- Admin round participation export: `GET /api/v1/admin/reports/round-participation.xlsx`

See [docs/architecture-audit.md](docs/architecture-audit.md) for the complete audit, ER model, API contract, security model, transaction boundaries, migration strategy, and deployment checklist.
See [docs/round-participation-export-audit.md](docs/round-participation-export-audit.md) for the participation definition, XLSX architecture, security review, tests, and production-readiness assessment.
