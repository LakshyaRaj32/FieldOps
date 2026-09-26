# Roadmap

FieldOps is built in small, complete versions. Each version has a focused scope and does
**not** implement features from later versions.

| Version | Focus | Key outcomes |
| --- | --- | --- |
| **V0** | Architecture and repository foundation | Monorepo structure, architecture and decision docs, strict TS config, role vocabulary |
| V1 | React Native foundation | RN CLI app (New Architecture, Hermes), navigation shell, Redux store, design system basics, lint/format/test tooling |
| V2 | Authentication and sessions | Login, token rotation, secure token storage, session state, role-based navigation |
| V3 | Backend foundation, PostgreSQL, Prisma | NestJS app, config validation, Prisma schema and migrations, local Postgres in Docker, OpenAPI, health checks |
| V4 | Jobs / work orders | Job model, assignments, state machine, job events, manager and worker job screens, audit writer |
| V5 | Offline SQLite architecture | Local DB, migrations, repositories, reactive queries, local command handlers, outbox table |
| V6 | Custom synchronization engine | Push/pull protocol, idempotent mutation processing, change log, conflict policies, retry/backoff |
| V7 | Location tracking and native Kotlin subsystem | Foreground service, Fused Location Provider, native buffering, batched upload, WorkManager |
| V8 | Messaging and WebSockets | Socket.IO gateway, rooms and authorization, messaging, sync hints |
| V9 | Notifications and files/media | FCM, notification orchestration, presigned uploads, photo capture pipeline, MinIO locally |
| V10 | Redis and caching | Redis introduced, cache strategy, Socket.IO Redis adapter |
| V11 | Custom distributed rate limiter | Lua-scripted limiter, per-route policies, `429` handling on the client |
| V12 | BullMQ and background workers | Worker process, queues, move notifications and media processing to queues |
| V13 | Idempotency, distributed locks, reliability | `Idempotency-Key` support, transactional outbox, locks with leases, property-based sync tests |
| V14 | Advanced frontend performance | List virtualization, render profiling, startup optimization, Reanimated interactions |
| V15 | Observability | Structured logging, OpenTelemetry tracing, metrics, dashboards, crash reporting |
| V16 | Docker, CI/CD, DevOps | Production image, GitHub Actions pipeline, staging and production deploys, mobile release pipeline |
| V17 | AI capabilities | AI module, tool registry, job summaries, natural-language operations queries |
| V18 | Security hardening and production readiness | Threat model review, RLS evaluation, local DB encryption, pinning, dependency audit |
| V19 | Load/performance testing and final polish | k6 load tests, HTTP adapter re-evaluation, tuning, documentation polish |

## Sequencing notes

- **V2 before V3.** Authentication needs a server with a user store, but the full backend
  foundation (Prisma, Postgres) arrives in V3. Options when V2 starts:
  **(a)** swap V2 and V3 (recommended: auth then builds on real persistence), or
  **(b)** scope V2 to the mobile session architecture (secure storage, session state,
  navigation guards, token refresh flow) plus a minimal NestJS auth module, with the rest of
  the backend foundation following in V3.
  Either way, **no fake auth server**. This decision should be made at the start of V2.
- **Local Docker before V16.** Postgres runs in Docker Compose from V3 for development. V16 is
  about production images, CI/CD and deployment.
- **Notifications before queues.** V9 sends notifications from the API behind a service
  interface. V12 moves delivery onto BullMQ without changing callers.
- **Realtime before Redis.** V8 runs single-instance WebSockets. V10 adds the Redis adapter for
  multiple instances.
- **Security is continuous.** V18 is hardening and review. Every earlier version already
  includes security in its definition of done.

---

## Version 0 completion checklist

### Repository

- [x] Repository inspected. It was new and empty, so there was no existing work to preserve.
- [x] Monorepo structure: `apps/mobile`, `apps/api`, `packages/{shared,types,config}`,
      `infra/docker`, `docs/`
- [x] Root `package.json` with npm workspaces and `engines`, and no runtime dependencies
- [x] `.gitignore` (Node, React Native/Android, NestJS, Prisma, Docker, env and secrets,
      editors, OS)
- [x] `.gitattributes` (LF normalization; CRLF for Windows scripts; binary assets)
- [x] `.editorconfig` and `.nvmrc`
- [x] Shared strict TypeScript base config (`packages/config/tsconfig.base.json`)
- [x] Shared role vocabulary (`packages/types/src/role.ts`), type-checked with strict settings
- [x] Reserved directories carry READMEs explaining purpose and target version (no stub code)

### Documentation

- [x] `README.md`
- [x] `docs/architecture.md`, including the 14 explicit architectural decisions and the role
      model
- [x] `docs/technology-decisions.md` (React Native, TypeScript, NestJS, PostgreSQL, Prisma,
      Redis, BullMQ, SQLite, Redux Toolkit, WebSockets, Docker, Kotlin)
- [x] `docs/offline-first.md`
- [x] `docs/synchronization.md`
- [x] `docs/backend-architecture.md`
- [x] `docs/mobile-architecture.md`
- [x] `docs/devops.md`
- [x] `docs/ai-architecture.md`
- [x] `docs/engineering-principles.md`
- [x] `docs/development.md` (developer setup and workflow)
- [x] `docs/roadmap.md` (this file)

### Verification

- [x] `npm install` succeeds
- [x] `npm run typecheck` passes
- [x] All relative documentation links resolve
- [x] No future-version implementation: no RN app, no NestJS app, no Prisma schema, no Docker
      Compose, no planned-but-unused dependencies

### Handoff

- [ ] Initial commit created and tagged `v0.0.0` (done by the repository owner)
- [ ] V2/V3 sequencing decision made before starting V2
