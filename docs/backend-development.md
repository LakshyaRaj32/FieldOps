# Backend Development

How to run, test and prepare the FieldOps API (`apps/api`) for deployment. Architecture:
[backend-architecture.md](backend-architecture.md). Auth design:
[authentication.md](authentication.md).

```text
React Native app ──HTTP──▶ NestJS API (apps/api) ──Prisma──▶ PostgreSQL 18
   (phone, adb reverse)       localhost:3000                   localhost:5432
```

## Stack

| Piece | Version | Notes |
| --- | --- | --- |
| Node.js | 24 | ESM (`"type": "module"`), `process.loadEnvFile` for `.env` |
| NestJS | 12 | ESM-only; Express 5 adapter |
| Prisma | 7 | `prisma-client` generator (TypeScript output in `src/generated/`, gitignored), `@prisma/adapter-pg` driver adapter, `prisma.config.ts` |
| PostgreSQL | 18 | Installed natively for local development (Docker comes later) |
| Tests | Vitest 4 + Supertest | Unit tests next to the code; E2E against a real test database |
| Lint | oxlint (type-aware) | The Nest 12 default |

## 1. PostgreSQL

Local development uses a **native PostgreSQL 18 install**. Docker Compose is intentionally
deferred (see [infra/docker/README.md](../infra/docker/README.md)).

### Install (Windows)

```powershell
winget install --id PostgreSQL.PostgreSQL.18 --exact
```

The installer asks for a password for the `postgres` superuser and registers the Windows service
`postgresql-x64-18`, which starts automatically. Stop and start it with:

```powershell
Stop-Service postgresql-x64-18     # (administrator)
Start-Service postgresql-x64-18
```

On macOS or Linux, install PostgreSQL 18 from your package manager.

### Create the application role and databases

The API never connects as the superuser. Run this once with `psql` (on Windows:
`"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U postgres`):

```sql
CREATE ROLE fieldops LOGIN PASSWORD 'fieldops' CREATEDB;
CREATE DATABASE fieldops_dev  OWNER fieldops;
CREATE DATABASE fieldops_test OWNER fieldops;
```

`CREATEDB` is needed because `prisma migrate dev` creates a temporary "shadow" database to
detect schema drift. The `fieldops`/`fieldops` credentials are for a local, localhost-only
database; never reuse them anywhere else.

## 2. Configure

```bash
cp apps/api/.env.example apps/api/.env
```

Then replace both JWT secrets with random values (they must differ):

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

| Variable | Default | Notes |
| --- | --- | --- |
| `APP_ENV` | `development` | `development`, `staging` or `production` |
| `HOST` | `0.0.0.0` | Listen on all interfaces (phones, containers) |
| `PORT` | `3000` | Hosting platforms inject it |
| `DATABASE_URL` | none | `postgresql://user:pass@host:5432/db` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | none | At least 32 characters, different; placeholders are refused outside development |
| `ACCESS_TOKEN_EXPIRATION` | `15m` | `<number><s|m|h|d>`, shorter than the refresh lifetime |
| `REFRESH_TOKEN_EXPIRATION` | `30d` | Sliding session lifetime |
| `CORS_ORIGINS` | empty (CORS off) | Comma-separated browser origins; `*` is refused |
| `SWAGGER_ENABLED` | `true` (`false` in production) | |
| `STORAGE_DIR` | `./storage` | Job evidence files (Phase 4); gitignored. A deployment points it at a persistent volume |
| `FCM_SERVICE_ACCOUNT_FILE` | empty (push disabled) | Path of the Firebase service-account JSON (a secret, gitignored); see [notifications.md](notifications.md#setup-push) |

Configuration is validated at start-up (`src/config/app-config.ts`). An invalid value stops
the process with a list of every problem. Secret values are never printed.

## 3. Migrate and run

```bash
npm run db:deploy      # apply committed migrations to fieldops_dev
npm run api:dev        # watch mode on http://localhost:3000
```

- API: `http://localhost:3000/api/v1`
- Swagger UI: <http://localhost:3000/api/docs> (how to authorize: [api.md](api.md#swagger))
- Health: `/health/live` (process up), `/health/ready` (database reachable)

Changing the schema: edit `prisma/schema.prisma`, then `npm run db:migrate -- --name <change>`
creates and applies a migration. Commit the generated SQL. `npm run db:studio -w @fieldops/api`
opens Prisma Studio for browsing data.

After pulling the multi-tenant phase, run `npm run db:deploy` once: it renames `ADMIN` to
`ORGANIZATION_ADMIN` and moves existing users and jobs into a "Default organization".

Roles are managed through the API (super admins create organizations and their admins,
organization admins create members). The one exception is the first platform admin, which no
API can create by design:

```bash
npm run user:set-role -w @fieldops/api -- root@example.com SUPER_ADMIN
# development shortcuts: a role in an organization (created if missing), optionally org-wide
npm run user:set-role -w @fieldops/api -- raj@example.com MANAGER "Nike Operations"
npm run user:set-role -w @fieldops/api -- raj@example.com MANAGER "Nike Operations" --org-wide
```

`OVERDUE_SCAN_INTERVAL` (default `1h`, `off` to disable) sets how often overdue payments are
checked; the E2E setup turns it off.

## 4. Test

```bash
npm test -w @fieldops/api           # unit tests (no database)
npm run api:test:e2e                # E2E: real HTTP pipeline + fieldops_test
npm run typecheck -w @fieldops/api
npm run lint -w @fieldops/api
```

- E2E tests boot the real `AppModule` with the same HTTP pipeline as `main.ts`
  (`src/app.setup.ts`), apply migrations to `fieldops_test` with `prisma migrate deploy`, and
  truncate every table between tests.
- The test database URL defaults to `postgresql://fieldops:fieldops@localhost:5432/fieldops_test`.
  Override it with `TEST_DATABASE_URL`. The setup refuses to run against a database whose name
  does not end in `_test`.
- The E2E environment (test-only secrets) is in `test/test-env.ts`. It never reads
  `apps/api/.env`.

## 5. Connect the phone

The debug app calls `API_BASE_URL=http://localhost:3000` (`apps/mobile/.env.development`). Over
USB, forward the phone's port 3000 to the computer:

```bash
npm run mobile:reverse   # adb reverse for the API (3000) and Metro (8081)
```

Re-run it after reconnecting the phone. Alternatively, put the computer's LAN IP in
`apps/mobile/.env.development` (for example `http://192.168.1.20:3000`) and rebuild; the API
already listens on `0.0.0.0`. The **Check API connection** button on the Profile tab confirms
reachability.

## 6. Logs

- One access-log line per request: method, path (no query string), status, duration and request
  ID.
- Auth events are logged with IDs only: `User registered (userId=…)`, `Session started (…)`,
  `Session signed out (…)`, and a warning on `Refresh token reuse detected`.
- Never logged: request bodies, headers, passwords, password hashes, tokens, emails. Prisma
  query logging is off, because it would print parameter values.

To check a run for leaks, search the log for `eyJ` (the start of every JWT), `$argon2` and a
password you used. None should appear.

## 7. Staging preparation

The API is ready for a container or PaaS host (for example Render). Nothing assumes localhost:

- `PORT` and `HOST` come from the environment (`0.0.0.0` by default).
- `DATABASE_URL` and the secrets come from the environment; there is no `.env` file in a
  deployment (`process.loadEnvFile` is skipped when the file is missing).
- Placeholder or short secrets make `APP_ENV=staging|production` refuse to start.
- Swagger is off in production by default.
- `SIGTERM` closes the HTTP server and the database pool (`enableShutdownHooks`).
- `/health/ready` is the platform health check.

A typical Render web service (not created yet; deployment is part of a later version):

| Setting | Value |
| --- | --- |
| Build command | `npm ci && npm run api:build && npm run db:deploy` |
| Start command | `npm run api:start` |
| Health check path | `/health/ready` |
| Environment | `APP_ENV=staging`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, optionally `CORS_ORIGINS`, `SWAGGER_ENABLED`, `STORAGE_DIR` (on a persistent disk), `FCM_SERVICE_ACCOUNT_FILE` |

The mobile staging build then points `API_BASE_URL` at the service's `https://` URL.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `npm install` fails with `Cannot set properties of null (setting 'peer')` | An old global npm (10.4.x) is shadowing the npm bundled with Node 24. Run `npm install -g npm@11` or call the bundled npm directly: `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install` |
| `Invalid configuration: DATABASE_URL is missing` | Create `apps/api/.env` (section 2) |
| `P1001: Can't reach database server` | The PostgreSQL service is stopped: `Start-Service postgresql-x64-18` |
| `P3014` / permission denied to create database | The `fieldops` role needs `CREATEDB` (only for `migrate dev`) |
| `Cannot find module '../generated/prisma/client.js'` | Run `npm exec -w @fieldops/api -- prisma generate` (it normally runs on `npm install`) |
| Phone shows "Can't reach the FieldOps server" | API not running, or `adb reverse` missing (re-run `npm run mobile:reverse`) |
| Every request after a while returns `REFRESH_TOKEN_REUSED` | Two refreshes raced with the same token (for example from Postman plus the app). Sign in again |
