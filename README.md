# Printoria International Pvt Ltd — B2B Order Workflow Portal

A portal connecting Printoria (a printing & packaging manufacturer) with its corporate
clients: regional offices raise requirements, head offices approve them and issue POs,
Printoria quotes, verifies and fulfils the orders. Full audit trail; pricing is
server-side redacted from regional users on **every** surface.

## One-time setup (local)

Prerequisites: **Node 20+**, **npm 10+**. Docker is optional (only for a local Postgres).

```powershell
npm install
Copy-Item env/.env.local.example apps/api/.env
npm run build -w @pintoria/shared

# Database: EITHER start the bundled Postgres...
npm run docker:up
# ...OR just edit apps/api/.env DATABASE_URL to a Neon/Supabase string.

npm run db:migrate     # creates the database + initial migration, runs the seed
```

## Run

```powershell
npm run dev            # API on http://localhost:3001 + shared package watch
# Swagger: http://localhost:3001/api/docs
# Health:  http://localhost:3001/health
# Web app arrives in checkpoint 1d (npm run dev:web)
```

## Demo personas (checkpoint 1a seeds 9 users; password `Printoria@2024` everywhere)

| Email | Role | Client |
|---|---|---|
| `pt.admin@printoria.example` | Printoria Admin | — |
| `pt.sales@printoria.example` | Printoria Sales | — |
| `pt.ops@printoria.example` | Printoria Operations (pricing **not** authorised) | — |
| `regional.west@sunlightfoods.example` | Client Regional (West) | Sunlight Foods |
| `regional.north@sunlightfoods.example` | Client Regional (North) | Sunlight Foods |
| `ho@sunlightfoods.example` | Client Head Office | Sunlight Foods |
| `regional.south@nimbusretail.example` | Client Regional (South) | Nimbus Retail |
| `ho@nimbusretail.example` | Client Head Office | Nimbus Retail |
| `ho2.pending@nimbusretail.example` | Head Office **invited**, must set password via invite flow | Nimbus Retail |

All persona emails end in `.example` — change the client emails/phones in the seed before
any external demo.

## Tests

```powershell
Copy-Item apps/api/.env.test.example apps/api/.env.test   # first time only
npm run test            # unit tests
npm run test:e2e        # resets the test DB (migrate+seed) then runs e2e with Jest
```

## Scripts

| Command | What it does |
|---|---|
| `npm run db:migrate` | Dev migration (`prisma migrate dev`, also creates DB + runs seed) |
| `npm run db:reset` | Drops and recreates the dev DB from migrations, re-seeds |
| `npm run db:test:reset` | Same for the test DB (`apps/api/.env.test`) |
| `npm run create-admin -- --email a@b.com --name "..."` | First-admin bootstrap (see below) |
| `npm run build` | Builds shared package + API (`dist/`) |

The **seed script refuses to run when `NODE_ENV=production`** — production data can only
come from real users or explicit ops actions. Note: staging also should not be seeded
from `seed.ts` beyond first bring-up.

## First admin (production bring-up)

```powershell
npm run create-admin -- --email admin@printoria.example --name "Printoria Admin" --password "<strong password>"
```

Idempotent: re-running updates the name/password of an existing user instead of failing.

## Deployment

- **API**: Render — import `render.yaml`; `prisma migrate deploy` runs in the build phase;
  health check at `/health`. Automatic deploy on push to the tracked branch.
- **Web**: Vercel — Root Directory `apps/web` (config in `apps/web/vercel.json`); set
  `VITE_API_URL` to the Render API URL in the Vercel dashboard.
- Environment matrix and the complete variable list: `env/README.md`.

## Repository layout

```
packages/shared   enums, permission catalog, status labels (used by API + web)
apps/api          NestJS API (Prisma, JWT auth, audit, settings-registry groundwork)
apps/web          React SPA (checkpoint 1d)
docs/             phase-0 architecture, phase setup notes, handover (1d)
env/              environment examples + the documented variable list
```
