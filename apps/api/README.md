# apps/api

The FieldOps backend: a **NestJS 12 modular monolith** in TypeScript (ESM), backed by
**PostgreSQL** through **Prisma 7**.

**Status:** Phase 3 (Offline-First). Backend foundation, authentication and sessions (Phase 1),
jobs: model, assignment, history and authorization (Phase 2), and the server side of offline
sync: `Idempotency-Key` on device commands, field notes and the worker's working set (Phase 3).
The job state machine comes from `@fieldops/shared`, built automatically before `build` and
`start`. Redis,
BullMQ and WebSockets arrive in later phases ([phase status](../../docs/phase-status.md)).

## Quick start

```bash
cp apps/api/.env.example apps/api/.env   # then set two random JWT secrets
npm run db:deploy                        # apply migrations (from the repository root)
npm run api:dev                          # http://localhost:3000, Swagger at /api/docs
```

PostgreSQL setup, tests, the phone connection and staging preparation:
[docs/backend-development.md](../../docs/backend-development.md).

## Endpoints

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/v1/auth/register` | public |
| `POST` | `/api/v1/auth/login` | public |
| `POST` | `/api/v1/auth/refresh` | refresh token |
| `POST` | `/api/v1/auth/logout` | Bearer |
| `GET` | `/api/v1/auth/me` | Bearer |
| `GET` | `/api/v1/users` | Bearer, `ADMIN` |
| `GET` | `/api/v1/users/workers` | Bearer, `MANAGER`/`ADMIN` |
| `POST` | `/api/v1/jobs` | Bearer, `MANAGER`/`ADMIN` |
| `GET` | `/api/v1/jobs`, `/api/v1/jobs/:id` | Bearer (workers: own jobs only) |
| `PATCH`, `DELETE` | `/api/v1/jobs/:id` | Bearer, `MANAGER`/`ADMIN` |
| `POST` | `/api/v1/jobs/:id/assign`, `/cancel` | Bearer, `MANAGER`/`ADMIN` |
| `POST` | `/api/v1/jobs/:id/start`, `/complete`, `/notes` | Bearer, the assigned `WORKER` (optional `Idempotency-Key`) |
| `GET` | `/api/v1/jobs/working-set` | Bearer, `WORKER` |
| `GET` | `/health/live`, `/health/ready` | public |

## Source layout

```text
apps/api/
├── prisma/
│   ├── schema.prisma            users, sessions, jobs, job_checklist_items, job_events, job_notes, processed_mutations
│   └── migrations/              committed SQL migrations
├── prisma.config.ts             Prisma 7 CLI config (schema, migrations, DATABASE_URL)
├── scripts/set-role.mjs         operator tool: grant a role by email
├── src/
│   ├── main.ts                  bootstrap: config, pipeline, Swagger, listen
│   ├── app.module.ts            modules + global guards (JWT, then roles)
│   ├── app.setup.ts             HTTP pipeline shared with E2E tests
│   ├── swagger.setup.ts         OpenAPI + Swagger UI with bearer auth
│   ├── config/                  validated, typed configuration from the environment
│   ├── database/                PrismaService (pg driver adapter)
│   ├── common/
│   │   ├── decorators/          @Public, @Roles, @CurrentUser
│   │   ├── errors/              error codes (checked against @fieldops/types), AppException
│   │   ├── filters/             every exception → error envelope
│   │   ├── guards/              RolesGuard
│   │   ├── interceptors/        success envelope
│   │   ├── middleware/          request ID + access log
│   │   ├── pipes/               global ValidationPipe
│   │   ├── swagger/             envelope schemas for OpenAPI
│   │   └── types/               AuthenticatedUser, Express augmentation
│   ├── auth/
│   │   ├── auth.controller.ts   /auth endpoints
│   │   ├── auth.service.ts      register, login, refresh (rotation + reuse detection), logout
│   │   ├── password.service.ts  Argon2id
│   │   ├── tokens.service.ts    JWT issue/verify, refresh token hashing
│   │   ├── sessions.service.ts  sessions table (create, rotate, revoke)
│   │   ├── dto/  guards/  strategies/  types/
│   ├── users/                   users table, profile DTO, admin list, Role
│   ├── jobs/                    jobs module: domain/ (state machine, policy), data/ (repository), DTOs
│   ├── health/                  liveness and readiness
│   └── generated/prisma/        generated client (gitignored)
└── test/                        E2E tests (Vitest + Supertest, real PostgreSQL)
```

Modules are created in the version that needs them, never earlier. The module rules
(controllers → services → data, module-owned tables) are in
[docs/backend-architecture.md](../../docs/backend-architecture.md#4-inside-a-module).

## Scripts

| Script | What it does |
| --- | --- |
| `start:dev` | Watch mode |
| `build` / `start:prod` | Generate the Prisma client and compile to `dist/`, then run `node dist/main.js` |
| `test` | Unit tests (Vitest) |
| `test:e2e` | E2E tests against `fieldops_test` |
| `typecheck` / `lint` / `format` | `tsc --noEmit`, oxlint (type-aware), Prettier |
| `db:migrate` / `db:deploy` / `db:status` / `db:studio` | Prisma Migrate and Studio |
| `user:set-role -- <email> <ROLE>` | Grant WORKER, MANAGER or ADMIN |
