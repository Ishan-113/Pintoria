# Environment variables

The API reads its configuration from `apps/api/.env` (loaded automatically by Prisma and `@nestjs/config`).
For tests it reads `apps/api/.env.test` (see "Testing" below). Staging/production values live in the
Render and Vercel dashboards — never in git.

## Full variable list

| Variable | Used by | Required | Local default | Notes |
|---|---|---|---|---|
| `NODE_ENV` | API | always | `local` | `local` \| `staging` \| `production`. Strict secrets/validation enforced unless `local`. Seed script refuses to run when `production`. |
| `PORT` | API | always | `3001` | HTTP port. Render injects its own — leave `3001` locally. |
| `WEB_ORIGIN` | API | always | `http://localhost:5173` | Comma-separated CORS allow-list. Requests from other origins are rejected. |
| `DATABASE_URL` | API, web (server calls) | always | local compose URL | Neon/Supabase/Render Postgres connection string. Add `?sslmode=require` for hosted DBs. |
| `DATABASE_URL_TEST` | tests | local only | `pintoria_test` | Used via `apps/api/.env.test` for the e2e suite. |
| `JWT_ACCESS_SECRET` | API | always (strong value outside `local`) | dev placeholder | 32+ random chars. |
| `JWT_REFRESH_SECRET` | API | always (strong value outside `local`) | dev placeholder | Must differ from the access secret. |
| `JWT_ACCESS_TTL` | API | always | `15m` | Access-token lifetime. |
| `JWT_REFRESH_TTL` | API | always | `7d` | Refresh-token lifetime. |
| `EMAIL_PROVIDER` | API | always | `log` | `log` (writes to server log; used by tests to capture mails) or `resend`. |
| `EMAIL_FROM` | API | always | `Printoria Portal <no-reply@printoria.example>` | Must be a verified Resend domain in staging/production. |
| `RESEND_API_KEY` | API | when `EMAIL_PROVIDER=resend` | — | Resend dashboard → API keys. |
| `STORAGE_DRIVER` | API (files, checkpoint 1c) | always | `local` | `local` (disk, dev) or `r2` (Cloudflare R2). |
| `STORAGE_LOCAL_PATH` | API | when driver=local | `./data/files` | Relative to `apps/api`. |
| `R2_ACCOUNT_ID` | API | when driver=r2 | — | Cloudflare account id. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | API | when driver=r2 | — | R2 API token credentials. |
| `R2_BUCKET` | API | when driver=r2 | — | e.g. `pintoria-files`. |
| `UPLOAD_MAX_MB` | API (1c) | always | `25` | Max upload size. |
| `UPLOAD_ALLOWED_EXT` | API (1c) | always | `pdf,jpg,jpeg,png,xlsx,docx,ai,cdr` | Comma list, lower-case. |

## Testing

```powershell
Copy-Item env/.env.local.example apps/api/.env
Copy-Item apps/api/.env.test.example apps/api/.env.test   # then adjust DATABASE_URL if needed
```

`.env.test` must point `DATABASE_URL` at a **test** database (e.g. `pintoria_test` on the same
Postgres server). Its secrets may stay local-dev values; `EMAIL_PROVIDER` must stay `log` so the
e2e suite can capture invitation/password-reset mails.

## Environments

| | Local | Staging | Production |
|---|---|---|---|
| Host API | your machine | Render (manual import of `render.yaml`, staging env group) | Render, GitHub auto-deploy on tag/main |
| Host web | Vite dev server :5173 | Vercel preview/domain | Vercel production |
| Database | compose Postgres or Neon branch | Neon staging branch | Neon production branch |
| Email | `EMAIL_PROVIDER=log` | Resend (staging domain) | Resend (production domain) |
| Files | `STORAGE_DRIVER=local` disk | R2 bucket `pintoria-staging-files` | R2 bucket `pintoria-files` |
| Seed | allowed | discouraged (data pollution) | **refused by the script** |
