# FieldOps

**Offline-first field workforce management platform.**

FieldOps lets organizations run field teams (technicians, delivery workers, sales
representatives, inspectors, maintenance crews) where connectivity cannot be relied on.
Workers receive jobs, capture evidence, share location while on duty and message managers,
all offline, with work synchronizing automatically when the connection returns. Managers
assign and monitor jobs and workers in real time.

## Project status

| | |
| --- | --- |
| **Current phase** | **Phase 3: Offline-First** (implemented; physical-device verification pending) |
| Completed | Phase 1: Foundation (V0 architecture, V1 mobile foundation, V2 backend and auth) · Phase 2: Core Product (implemented; device check pending) |
| Next | Phase 4: Field Operations (not started) |

The project is managed in six phases: [docs/master-development-plan.md](docs/master-development-plan.md),
current state in [docs/phase-status.md](docs/phase-status.md).

**Phase 3** makes the worker's app offline-first: jobs are downloaded into SQLite on the
phone, start / complete / field notes work without a connection and survive restarts, and a
sync engine delivers them when the connection returns, each exactly once (server-side
idempotency), retrying with backoff and letting the server win conflicts. See
[docs/offline-first.md](docs/offline-first.md) and
[docs/synchronization.md](docs/synchronization.md).

**Phase 2** turns the foundation into a field-work application: managers create jobs, assign
workers and monitor status; workers see their jobs, start them and complete them.

- a `jobs` module with an explicit state machine (`PENDING → ASSIGNED → IN_PROGRESS →
  COMPLETED`, cancellation, no reopening), append-only job history and optimistic concurrency;
- server-side authorization on every job operation (workers only ever see their own jobs), with
  the allowed actions for each job sent to the app;
- on the phone: job list, job details with Start/Complete, and the manager's create, edit and
  assign screens; see [docs/api.md](docs/api.md#jobs).

**Phase 1** delivered the first working end-to-end stack:

```text
React Native (Android) ──HTTP──▶ NestJS API ──Prisma──▶ PostgreSQL
```

- a NestJS 12 modular monolith (`apps/api`) with validated configuration, Prisma 7 and
  PostgreSQL 18, a consistent response envelope, Swagger and health checks;
- registration and sign-in with Argon2id, short-lived access tokens, rotating refresh tokens
  with reuse detection, server-side sessions and a role-based authorization foundation;
- on the phone: Login/Register screens, tokens in Android Keystore-backed storage, session
  restore (also offline), transparent token refresh and sign-out;
- unit and E2E tests (against a real database), a Postman collection.

Version 1 built the app's foundation (navigation, Redux Toolkit and RTK Query, connectivity,
API environments, theming, error handling). See [docs/roadmap.md](docs/roadmap.md).

## Architecture at a glance

```text
┌───────────────────────────────┐        HTTPS (REST · sync)        ┌──────────────────────────────┐
│  Mobile app (React Native)    │ ────────────────────────────────▶ │  API (NestJS modular         │
│  UI · Redux (UI state)        │ ◀──────────────────────────────── │  monolith)                   │
│  SQLite (offline truth)       │        WSS (realtime events)      │  api process + worker process│
│  Outbox + custom sync engine  │                                   └───┬──────────┬──────────┬────┘
│  Kotlin: location, background │ ◀────── FCM push ───────────────      │          │          │
└───────────────────────────────┘                                  PostgreSQL    Redis    Object storage
                                                                   (truth)     (cache,    (photos,
                                                                               limits,     files)
                                                                               queues)
```

- **Modular monolith** backend. It can be split into services later if measurements justify
  it.
- **PostgreSQL** is the server's source of truth. **SQLite** is the device's source of truth
  for offline work.
- **Outbox-based sync** with idempotent mutations and domain-specific conflict policies.
- **Security, tenancy and audit** are part of the design from the start.

The details are in [docs/architecture.md](docs/architecture.md).

## Repository layout

```text
FieldOps/
├── apps/
│   ├── mobile/        React Native + TypeScript (+ Kotlin)          → foundation built in V1
│   └── api/           NestJS + TypeScript + Prisma + PostgreSQL     → foundation and auth in V2
├── packages/
│   ├── config/        Shared strict tsconfig base
│   ├── types/         Shared domain and API contract types (Role, envelope, auth)
│   └── shared/        Shared runtime code: the job state machine (API and app)
├── infra/
│   └── docker/        Local infrastructure (Compose, later), images (V16)
└── docs/              Architecture, decisions, principles, roadmap
```

## Technology

| Layer | Technology |
| --- | --- |
| Mobile | React Native (New Architecture, Hermes), TypeScript, React Navigation, Redux Toolkit, RTK Query, SQLite, MMKV, NetInfo, Reanimated |
| Native | Kotlin Turbo Modules: foreground location service, WorkManager |
| Backend | Node.js, NestJS, TypeScript, Prisma, JWT, RBAC with resource policies, OpenAPI |
| Data | PostgreSQL (source of truth), Redis (cache, rate limiting, locks, realtime fan-out), S3-compatible object storage |
| Async and realtime | BullMQ, WebSockets (Socket.IO through Nest gateways), FCM |
| Operations | Docker, GitHub Actions, OpenTelemetry, structured logging |
| AI | Provider-neutral LLM gateway with allowlisted, permission-scoped tools |

Why each technology was chosen: [docs/technology-decisions.md](docs/technology-decisions.md).

## Development prerequisites

| Tool | Version |
| --- | --- |
| Node.js | 24 (see `.nvmrc`) |
| npm | 11 (bundled with Node 24; see the troubleshooting note in docs/backend-development.md) |
| PostgreSQL | 18 (native install for now) |
| JDK | 17 |
| Android SDK + platform-tools (adb) | Current, with `ANDROID_HOME` set |
| Android phone | USB debugging enabled (an emulator is optional) |

## Getting started

```bash
npm install          # from the repository root: installs and links all workspaces
npm run typecheck    # strict TypeScript, all workspaces
npm run lint         # ESLint, all workspaces
npm test             # unit tests, all workspaces (Jest for mobile, Vitest for the API)
npm run api:test:e2e # API end-to-end tests against the fieldops_test database
```

## Run the API

One-time PostgreSQL setup (role `fieldops`, databases `fieldops_dev` and `fieldops_test`) and
`apps/api/.env`: [docs/backend-development.md](docs/backend-development.md). Then:

```bash
npm run db:deploy    # apply migrations
npm run api:dev      # http://localhost:3000/api/v1, Swagger UI at /api/docs
```

## Run the mobile app

With the API running and the phone connected (`adb devices` shows it as `device`):

```bash
npm run mobile:reverse   # phone's localhost:3000 and :8081 → this computer

# terminal 2: Metro
npm run mobile:start

# terminal 3: build, install and launch on the phone
npm run mobile:android
```

The app appears as **FieldOps Dev**. Create an account or sign in. Self-registration creates
workers; to try the manager flow, grant a role with
`npm run user:set-role -w @fieldops/api -- <email> MANAGER`. The API URL for each build type is set in `apps/mobile/.env.*` files, so switching
from the local API to staging needs no code changes.

Building APKs, API environments, testing and troubleshooting:
[docs/mobile-development.md](docs/mobile-development.md). General repository setup:
[docs/development.md](docs/development.md).

## Documentation

| Document | Contents |
| --- | --- |
| [architecture.md](docs/architecture.md) | System overview, sources of truth, the 14 core decisions, domain and role model, security baseline |
| [technology-decisions.md](docs/technology-decisions.md) | Why each technology exists, alternatives, trade-offs, pending decisions |
| [engineering-principles.md](docs/engineering-principles.md) | Build-vs-adopt rule, failure design, security, typing, conventions, definition of done |
| [mobile-architecture.md](docs/mobile-architecture.md) | App structure, the six kinds of state, SQLite layer, navigation, Kotlin modules |
| [mobile-development.md](docs/mobile-development.md) | Install, run on the phone, build APKs, API environments, testing, troubleshooting |
| [backend-architecture.md](docs/backend-architecture.md) | Modules, layering, request lifecycle, data layer, auth, realtime, queues, Redis |
| [backend-development.md](docs/backend-development.md) | PostgreSQL setup, running and testing the API, connecting the phone, staging preparation |
| [authentication.md](docs/authentication.md) | Passwords, tokens, sessions, rotation and reuse detection, mobile token storage, security status |
| [api.md](docs/api.md) | Versioning, response envelope, error codes, Swagger and Postman |
| [database.md](docs/database.md) | Schema, indexing decisions, migrations |
| [offline-first.md](docs/offline-first.md) | Offline capability matrix, write and read paths, local data lifecycle |
| [synchronization.md](docs/synchronization.md) | Outbox, push/pull protocol, idempotency, conflict resolution, retry/backoff |
| [location.md](docs/location.md) | On-demand location, the Kotlin module, permissions, distance and trust boundary, privacy |
| [realtime.md](docs/realtime.md) | WebSocket gateway, authentication, rooms, event contract, reconnection, relationship with sync |
| [notifications.md](docs/notifications.md) | Notification rules, inbox, FCM, device tokens, payload security, app states, setup |
| [evidence.md](docs/evidence.md) | Photo pipeline, object storage, validation and metadata removal, offline uploads |
| [devops.md](docs/devops.md) | Environments, containers, CI/CD, releases, observability, scaling path |
| [ai-architecture.md](docs/ai-architecture.md) | Controlled AI tools, safety, evaluation |
| [development.md](docs/development.md) | Local setup, workspaces, git workflow, Windows notes |
| [master-development-plan.md](docs/master-development-plan.md) | The six-phase plan |
| [business-domain.md](docs/business-domain.md) | Organizations, roles and scopes, tenant isolation, money rules, operation types and state machine, audit |
| [phase-status.md](docs/phase-status.md) | Current phase, what was built, decisions, known issues, verification |
| [roadmap.md](docs/roadmap.md) | The former V0–V19 breakdown and the V0–V2 checklists |

## Roles

| Role | Summary |
| --- | --- |
| `WORKER` | Performs assigned operations (deliveries, collections, visits), captures evidence, works offline |
| `MANAGER` | Creates, assigns, verifies and monitors operations for their team and shops |
| `ORGANIZATION_ADMIN` | Runs one organization: members, teams, shops, products, settings, audit log |
| `SUPER_ADMIN` | Runs the platform: creates and suspends organizations; sees no tenant data |

See the capability matrix in [docs/architecture.md](docs/architecture.md#8-role-model).

## License

Not yet chosen.
