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
| **Current version** | **Version 1: React Native mobile foundation** |
| Completed | V0: architecture and repository foundation · V1: mobile foundation |
| Next | Version 2: authentication and sessions (not started) |

Version 1 delivers the Android app's foundation:
- navigation (sign-in flow and the main tabs: Dashboard, Jobs, Notifications, Profile);
- Redux Toolkit state and the RTK Query API layer;
- a NetInfo connectivity service;
- per-build-type API environments;
- a light/dark UI foundation and application-level error handling;
- linting and tests.

Sign-in is a clearly labeled **development entry** until real authentication arrives in V2.
There is no backend yet (V3). See [docs/roadmap.md](docs/roadmap.md).

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
│   └── api/           NestJS + TypeScript + Prisma                  → generated in V3 (reserved)
├── packages/
│   ├── config/        Shared strict tsconfig base
│   ├── types/         Shared domain types (Role)
│   └── shared/        Reserved: shared runtime code (schemas, state machines, sync protocol)
├── infra/
│   └── docker/        Local infrastructure (Compose from V3), images (V16)
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
| npm | 10+ |
| JDK | 17 |
| Android SDK + platform-tools (adb) | Current, with `ANDROID_HOME` set |
| Android phone | USB debugging enabled (an emulator is optional) |
| Docker | From Version 3 |

## Getting started

```bash
npm install          # from the repository root: installs and links all workspaces
npm run typecheck    # strict TypeScript, all workspaces
npm run lint         # ESLint, all workspaces
npm test             # Jest, all workspaces
```

## Run the mobile app

With the phone connected (`adb devices` shows it as `device`):

```bash
# terminal 1: Metro
npm run mobile:start

# terminal 2: build, install and launch on the phone
npm run mobile:android
```

The app appears as **FieldOps Dev**. Choose a development role on the login screen to explore
the tabs. The API URL for each build type is set in `apps/mobile/.env.*` files, so switching
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
