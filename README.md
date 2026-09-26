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
| **Current version** | **Version 2: backend foundation and authentication** |
| Completed | V0: architecture and repository foundation · V1: mobile foundation · V2: backend and auth |
| Next | Version 3: organizations and user administration (not started) |

Version 2 delivers the first working end-to-end stack:

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
│   └── shared/        Reserved: shared runtime code (schemas, state machines, sync protocol)
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

The app appears as **FieldOps Dev**. Create an account or sign in. The API URL for each build type is set in `apps/mobile/.env.*` files, so switching
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
| [devops.md](docs/devops.md) | Environments, containers, CI/CD, releases, observability, scaling path |
| [ai-architecture.md](docs/ai-architecture.md) | Controlled AI tools, safety, evaluation |
| [development.md](docs/development.md) | Local setup, workspaces, git workflow, Windows notes |
| [roadmap.md](docs/roadmap.md) | Versions 0–19 and the completion checklists |

## Roles

| Role | Summary |
| --- | --- |
| `WORKER` | Performs assigned jobs, captures evidence, shares location while on duty |
| `MANAGER` | Creates, assigns and monitors jobs; communicates with workers |
| `ADMIN` | Manages users, roles, organization settings and audit history |

See the capability matrix in [docs/architecture.md](docs/architecture.md#8-role-model).

## License

Not yet chosen.
