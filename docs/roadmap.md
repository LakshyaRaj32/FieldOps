# Roadmap

FieldOps is built in small, complete versions. Each version has a focused scope and does
**not** implement features from later versions.

| Version | Focus | Key outcomes |
| --- | --- | --- |
| **V0** | Architecture and repository foundation | Monorepo structure, architecture and decision docs, strict TS config, role vocabulary |
| V1 | React Native foundation | RN CLI app (New Architecture, Hermes), navigation shell, Redux store, design system basics, lint/format/test tooling |
| V2 | Backend foundation and authentication | NestJS app, config validation, Prisma schema and migrations, local PostgreSQL, OpenAPI, health checks; register/login, token rotation with reuse detection, server-side sessions, role guard; secure token storage, session state and auth navigation on mobile |
| V3 | Organizations and user administration | Organizations and tenancy, org-scoped users and tokens, role administration API (remaining V3 scope after the V2 resequencing; Docker Compose for PostgreSQL when adopted) |
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

- **V2 and V3 (decided at the start of V2).** Authentication needs a server with a user
  store, so V2 builds the backend foundation (NestJS, Prisma, PostgreSQL, configuration,
  OpenAPI, health checks) together with real authentication. No fake auth server was ever
  used. V3 keeps the remaining backend work: organizations, tenancy and user administration.
- **Local PostgreSQL.** By the repository owner's decision, V2 uses a native PostgreSQL 18
  install instead of Docker. Compose is adopted later; the API needs no changes for it. V16 is
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

- [x] Initial commit created and tagged `v0.0.0` (done by the repository owner)
- [x] V2/V3 sequencing decision made before starting V2 (V2 = backend foundation + auth)

---

## Version 1 completion checklist

Project location: `L:\Projects\FieldOps` (a clone of the V0 repository; same GitHub remote).

### Implementation

- [x] React Native 0.87.1 project under `apps/mobile` (Community CLI template, New
      Architecture, Hermes; iOS project removed, since Android is the target platform)
- [x] Monorepo integration: Gradle and Metro resolve hoisted packages; `@fieldops/types` is
      consumed by the app
- [x] TypeScript configured (FieldOps strict base + React Native config)
- [x] Feature-based architecture (`app`, `components`, `features`, `hooks`, `services`,
      `store`, `theme`, `utils`); deviations documented in
      [mobile-architecture.md](mobile-architecture.md#deviations-from-the-version-1-brief-and-why)
- [x] Navigation foundation: `RootNavigator` → `AuthNavigator` (Login) / `AppNavigator`
      (Dashboard, Jobs, Notifications, Profile); temporary development entry
- [x] Redux Toolkit store with application state (session, connectivity)
- [x] RTK Query foundation (empty base API, central base query, RN focus/reconnect listeners)
- [x] Network connectivity state (online / offline / checking / unknown, with recovery
      tracking and banner)
- [x] Environment/API configuration (react-native-config; debug/staging/release; validated
      at startup; no secrets)
- [x] Basic reusable UI components (Screen, AppText, Button, Card, Badge, SegmentedControl,
      Loading/Error/Empty states)
- [x] Theme foundation (tokens, light/dark, persisted preference in MMKV)
- [x] Error handling foundation (AppError model, error boundary, global handler, logger)
- [x] No future features implemented (no real auth, SQLite, sync, location, WebSockets,
      push, uploads, backend)

### Verification

- [x] `npm run typecheck` passes
- [x] `npm run lint` passes with 0 warnings
- [x] `npm test` passes (7 suites, 55 tests)
- [x] Prettier check passes
- [ ] Android build succeeds (`npm run mobile:android`), run by the repository owner
- [ ] App installs and launches on the physical phone
- [ ] Navigation and basic UI verified on the phone (see the manual test list in
      [mobile-development.md](mobile-development.md))

### Documentation

- [x] `docs/mobile-development.md` created
- [x] `README.md` updated (status, current version, prerequisites, running the app)
- [x] `docs/mobile-architecture.md`, `docs/technology-decisions.md`, `docs/development.md`,
      `apps/mobile/README.md` updated

### Handoff

- [ ] Version 1 committed and pushed; working tree clean
- [ ] Tagged `v0.1.0`

---

## Version 2 completion checklist

Scope: backend foundation and real authentication, connected to the mobile app.

### Backend

- [x] NestJS 12 modular monolith under `apps/api` (`config`, `database`, `common`, `auth`,
      `users`, `health`)
- [x] PostgreSQL 18 locally (native install; Docker deferred by decision)
- [x] Prisma 7 configured (`prisma.config.ts`, pg driver adapter, generated client gitignored)
- [x] Initial migration: `users`, `sessions`, `Role`, `SessionRevocationReason`, email check
      constraint; indexing decisions documented in [database.md](database.md)
- [x] Register, login, refresh (rotation + reuse detection), logout, me under `/api/v1/auth`
- [x] Argon2id password hashing; refresh tokens stored as SHA-256 hashes
- [x] Global JWT guard (`@Public()` opt-out) with session check; `@Roles()` + `RolesGuard`;
      ADMIN-only `GET /api/v1/users`
- [x] Validated, typed environment configuration; `.env.example`; no committed secrets
- [x] Consistent `{ success, data }` / `{ success: false, error }` envelope; safe errors
- [x] Swagger at `/api/docs` with bearer auth; Postman collection in `docs/postman/`
- [x] helmet, CORS allow-list, request IDs, access log without sensitive values
- [x] Health checks `/health/live` and `/health/ready`; deployable configuration (PORT, HOST,
      DATABASE_URL and secrets from the environment)

### Mobile

- [x] Development entry removed; Login and Register screens against the real API
- [x] Tokens in Android Keystore-backed storage (`react-native-keychain`), never in Redux
- [x] Session restore at start-up (works offline), revalidation with `/auth/me`
- [x] Authorization header and single-flight refresh with one retry in the base query
- [x] Refresh rejection clears credentials and returns to sign-in with a message
- [x] Sign-out revokes the server session and always clears local state
- [x] User information on Dashboard and Profile
- [x] User-friendly messages per error code; server text never shown for `5xx`

### Tests

- [x] API unit tests: config, durations, password hashing, tokens, role guard, exception filter
- [x] API E2E tests (real PostgreSQL): registration, duplicate email, hashing, login success
      and failure, token issuance, protected endpoint, invalid/expired tokens, refresh, rotation,
      reuse detection, concurrent refresh, revoked/expired sessions, logout, multi-device, role
      guard, disabled accounts, error envelope, health, request IDs
- [x] Mobile tests: session slice, credential store, base query auth and refresh, error model,
      form validation, sign-in/restore/sign-out flows (tokens never in Redux)

### Verification

- [x] `npm run typecheck` and `npm run lint` pass in all workspaces (0 warnings); unit tests
      pass (API 48, mobile 83)
- [x] `npm run api:test:e2e` passes against `fieldops_test` (33 tests)
- [x] Compiled API (`node dist/main.js`) starts; health, Swagger UI/OpenAPI and the full auth
      flow verified over HTTP
- [ ] Postman collection run by the repository owner
- [ ] Android build succeeds with `react-native-keychain` (run by the repository owner)
- [ ] Register, login, token refresh and logout verified on the physical phone
- [x] Database records verified (Argon2id hashes, SHA-256 refresh token hashes, `LOGOUT`
      revocation reason, indexes and foreign key)
- [x] API log checked: no JWTs, password hashes, passwords or emails

### Documentation

- [x] New: [authentication.md](authentication.md), [api.md](api.md), [database.md](database.md),
      [backend-development.md](backend-development.md), Postman collection
- [x] Updated: README, architecture, backend architecture, technology decisions, mobile
      architecture, mobile development, development, DevOps, roadmap, app READMEs

### Handoff

- [ ] Committed (`feat: implement backend foundation and authentication`) and tagged `v2.0.0`
      by the repository owner
