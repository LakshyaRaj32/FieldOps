# Technology Decisions

Each major technology in FieldOps is listed here with the reason it exists, the alternatives
considered, the trade-offs accepted and the version that introduces it. A technology is added
**in the version that first needs it**, never earlier.

Guiding rule (from [engineering-principles.md](engineering-principles.md)): **use mature tools
for infrastructure. Build the FieldOps-specific systems ourselves.**

| We use (not reinvent) | We build (FieldOps-specific) |
| --- | --- |
| PostgreSQL, SQLite, Redis | Offline sync engine, outbox, conflict policies |
| NestJS on Express/Fastify | Idempotency handling, retry/backoff strategy |
| Prisma | Distributed rate limiter (on Redis primitives) |
| BullMQ | Job orchestration and notification orchestration |
| Socket.IO / WebSockets | Realtime event architecture (event names, envelopes, rooms) |
| JWT libraries, Argon2 | Permission architecture, application-level authorization |
| FCM | Location batching pipeline |
| Android Fused Location Provider, WorkManager | Cache strategy, audit logging |
| Docker, GitHub Actions | |

---

## Summary

| Area | Choice | Introduced |
| --- | --- | --- |
| Language | TypeScript (strict) everywhere, Kotlin for Android native code | V0 / V7 |
| Monorepo | npm workspaces | V0 |
| Mobile framework | React Native 0.87 (Community CLI, New Architecture, Hermes) | V1 |
| Navigation | React Navigation 7 (native stack + bottom tabs) | V1 |
| UI / session state | Redux Toolkit | V1 |
| Server state (online-only) | RTK Query (base API in V1, first real endpoints from V2) | V1 |
| Mobile environment config | react-native-config (per-build-type dotenv files) | V1 |
| Local database | SQLite (library selected in V5) | V5 |
| Key-value storage | MMKV 4 (on Nitro Modules) | V1 |
| Connectivity signal | NetInfo | V1 |
| Animations | React Native Reanimated 4 (with react-native-worklets) | V1 / V14 |
| Mobile quality tooling | TypeScript 6.0, ESLint 9 (flat config), Prettier, Jest | V1 |
| Native modules | Kotlin Turbo Modules | V7 |
| Backend framework | NestJS | V3 (auth endpoints in V2; see roadmap note) |
| Database | PostgreSQL | V3 |
| ORM / migrations | Prisma | V3 |
| Realtime | WebSockets through Socket.IO and Nest gateways | V8 |
| Push | Firebase Cloud Messaging | V9 |
| File storage | S3-compatible object storage (MinIO locally) | V9 |
| Distributed state | Redis | V10 |
| Queues | BullMQ | V12 |
| Observability | Structured logs (pino), OpenTelemetry, Prometheus/Grafana | V15 |
| Containers / CI | Docker, GitHub Actions | V3 (local infra), V16 |

---

## React Native

**Why.** FieldOps needs a real mobile app, not a web page. It needs background location,
local databases, push notifications, camera access and a native feel. React Native provides:

- One TypeScript codebase shared with the backend's language, types and tooling.
- Genuinely native UI and full access to native APIs. The New Architecture (JSI, Turbo
  Modules, Fabric) makes calls between JavaScript and native code synchronous and typed, which
  matters for our Kotlin subsystems.
- A mature ecosystem for everything FieldOps needs: navigation, SQLite, MMKV, NetInfo,
  Reanimated, FCM.

**Why the Community CLI instead of Expo.** Expo is excellent, and its dev builds and Expo
Modules can host native code. FieldOps deliberately exercises Android internals: foreground
services, WorkManager, manifest permissions, Gradle configuration and Kotlin Turbo Modules.
The bare Community CLI project keeps that surface explicit and fully under our control. If
this trade-off stops being worth it, Expo modules can still be added to a bare project.

**Alternatives.** Flutter (Dart, no shared language or types with the backend). Native Kotlin
only (strongest Android fit, but no code or type sharing and more UI work). A PWA (cannot
reliably run background location or deep native integration on Android).

**Trade-offs.** A dependency on the React Native release cadence and upgrade effort. Some
subsystems (location) must be native anyway, which is why Kotlin appears below.

## TypeScript

**Why.** One language across mobile, backend and shared packages. Strict typing catches whole
classes of bugs, such as nullability, exhaustiveness and wrong payload shapes, before runtime.
It lets the sync protocol, the job state machine and API contracts be shared by client and
server.

**Configuration.** `packages/config/tsconfig.base.json` enables `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` and related
flags. Workspaces may add strictness but may not weaken it. The mobile app extends this base
**and** `@react-native/typescript-config`, in that order: React Native controls runtime options
(`lib`, `jsx`, module resolution) and FieldOps' extra strictness flags are kept.

**Version: TypeScript 6.0** (decided in V1). V0 installed TypeScript 7 (the native compiler),
but typescript-eslint supports only TypeScript below 6.1, and linting is required. The whole
repository uses one version (`~6.0.3` at the root), so npm installs a single copy. Revisit when
typescript-eslint supports TypeScript 7.

**Limitation.** Types disappear at runtime. External data is always validated with runtime
schemas at trust boundaries.

## NestJS

**Why.** A structured, modular server framework for TypeScript:

- A module system that maps directly onto our modular-monolith boundaries.
- Dependency injection, which makes services testable and infrastructure swappable.
- First-class guards (authentication and authorization), pipes (validation), interceptors
  (logging, idempotency, timing), WebSocket gateways, OpenAPI generation, and BullMQ
  integration.
- Conventions that keep a growing codebase consistent.

**NestJS vs Express.** These are not competing choices. NestJS is the application framework;
it runs **on top of** an HTTP adapter, Express (the default) or Fastify. FieldOps starts
on the **Express adapter** for maximum ecosystem compatibility (Passport strategies,
middleware, Swagger). Application code must not touch adapter-specific request or response
objects, so switching to Fastify is a contained change if load tests in V19 show a meaningful
benefit.

**Alternatives.** Plain Express or Fastify (we would end up rebuilding module structure,
dependency injection, guards and conventions by hand), Hono, tRPC (tightly couples client and
server and fits OpenAPI and non-TypeScript clients less well), Spring Boot or Ktor (strong
options, but give up the shared-TypeScript advantage).

**Trade-offs.** Decorator-heavy code and some framework "magic". We limit that by keeping
domain logic in plain TypeScript functions and classes that do not depend on Nest.

## PostgreSQL

**Why.** FieldOps data is relational and needs strong guarantees: organizations → users →
jobs → assignments → events, with constraints and transactions. PostgreSQL provides:

- ACID transactions, needed to apply a sync mutation, record its idempotency key and append
  a change-log entry atomically.
- Foreign keys, unique and partial indexes, and check constraints that enforce invariants
  even when application code has bugs.
- `JSONB` for semi-structured data such as checklist results and custom fields, without
  giving up relational integrity.
- A mature path for scale features when needed: table partitioning for location history,
  PostGIS for geo queries and geofencing, Row-Level Security for defense-in-depth tenant
  isolation, logical replication.

**Alternatives.** MySQL (viable, but weaker on JSONB, partial indexes and PostGIS). MongoDB
(document model fits our relational domain poorly). DynamoDB (vendor lock-in, and awkward for
ad hoc relational queries).

## Prisma

**Why.** Type-safe database access generated from a single schema, plus a solid migration
workflow (`prisma migrate`). It fits a strict-TypeScript codebase and keeps routine database
access boilerplate-free.

**How we use it.**

- `schema.prisma` is the source of truth for database structure. Migrations are committed and
  reviewed.
- Interactive transactions for sync and other multi-step operations.
- Raw SQL (`$queryRaw` with parameters, never string concatenation) is allowed where Prisma is
  a poor fit: partitioned tables, advisory locks, bulk location inserts, complex reporting
  queries. Such queries live in module-owned data access code and are covered by tests.

**Alternatives.** Drizzle (closer to SQL; a strong option), TypeORM (weaker type safety),
Kysely (a query builder with excellent types, but no migration story of its own), raw `pg`
(maximum control, most boilerplate).

**Trade-offs.** Some advanced Postgres features need raw SQL. The Prisma schema language
can't express everything, such as partitioning or some index types, so those go in hand-edited
migration SQL.

## Redis

**Why.** Several FieldOps concerns need fast, shared, ephemeral state across API instances:

| Use | Version | Failure mode if Redis is down |
| --- | --- | --- |
| Caching (read-through, explicit invalidation) | V10 | Fall back to Postgres (slower, still correct) |
| Distributed rate limiting (custom, Lua-scripted) | V11 | Fail open for most routes, fail closed for auth (documented per route) |
| BullMQ queue backend | V12 | Jobs cannot be enqueued; the transactional outbox in Postgres keeps pending events (V13) |
| Distributed locks (efficiency, not correctness) | V13 | Duplicate work possible; correctness still guaranteed by Postgres constraints and idempotency |
| Socket.IO adapter (cross-instance fan-out) | V10 | Realtime degrades to single-instance; clients still converge through sync |

**Redis is not the primary database.** Nothing lives only in Redis if its loss would lose
business data.

**Alternatives.** Memcached (caching only, no data structures or scripting). An in-process
memory store (does not work across instances). Postgres-only for everything (possible for
queues, for example with pg-boss, but Redis is the natural fit for rate limiting, pub/sub and
BullMQ).

## BullMQ

**Why.** Work that is slow, retryable or fan-out must not run inside an HTTP request: push
notifications, thumbnail generation, AI summarization, exports, location aggregation, cleanup.
BullMQ provides durable Redis-backed queues with retries, backoff, delayed and repeatable jobs,
concurrency control, rate-limited queues and good NestJS integration.

**What we build on top.** Job orchestration (which jobs, which queues, what depends on what),
idempotent job handlers, a server-side transactional outbox that feeds queues reliably (V13),
and notification orchestration (preferences, deduplication, channel selection).

**Alternatives.** RabbitMQ (another piece of infrastructure to run), Kafka (built for event
streaming at a scale we do not have), pg-boss (Postgres-based and viable, but we already need
Redis), cloud queues such as SQS (vendor lock-in and harder local development).

## SQLite (mobile)

**Why.** SQLite is the offline source of truth on the device. We need:

- Relational queries over the working set (jobs by status or date, events per job, pending
  outbox entries in order).
- **Transactions**, so a domain change and its outbox entry are written atomically. This is
  the foundation of the outbox pattern.
- Durability across app kills, OS memory pressure and reboots.
- Enough performance for thousands of jobs and tens of thousands of location points.

**Library.** Chosen in V5 after a short evaluation of transaction API, JSI performance,
New Architecture support, maintenance activity and encryption support (SQLCipher). The
leading candidates are **op-sqlite** and **expo-sqlite**. The choice will be recorded here.

**Alternatives.** WatermelonDB (includes its own sync model, and we are building our own sync
engine deliberately), Realm (deprecated device sync, proprietary format), AsyncStorage or MMKV
for domain data (not relational, no transactions, no queries).

## MMKV

**Why.** Fast, synchronous key-value storage for small, non-relational data: feature flags,
last-used filters, onboarding completion, the device ID, UI preferences. It is not a database.
Domain data never goes into MMKV, and neither do secrets unless they are encrypted with a key
held in the Android Keystore.

**V1 use.** The theme preference. Because MMKV reads synchronously, the first frame already
renders in the user's chosen theme, with no flash of the wrong theme.

**Version.** MMKV 4, which is built on **react-native-nitro-modules** (a required peer
dependency). MMKV 3 is no longer the maintained line. Only `src/services/storage` may import
MMKV (enforced by ESLint), and every key is declared in one typed list.

**Alternatives.** AsyncStorage (asynchronous, so the first render would need a loading state,
and slower), SharedPreferences through a custom native module (reinventing a solved problem).

## Mobile environment configuration (react-native-config)

**Why.** The app must switch between the local, staging and production APIs **without code
changes**. Each Android build type reads its own dotenv file from `apps/mobile/`:

| Build type | File | Use |
| --- | --- | --- |
| `debug` (and `debugOptimized`) | `.env.development` | Daily development with Metro |
| `staging` | `.env.staging` | Release-like build against the staging API; installs next to the dev build |
| `release` | `.env.production` | Production |

A single build can be pointed elsewhere with the `ENVFILE` environment variable, for example a
debug build against staging.

react-native-config compiles the values into the APK's `BuildConfig` and exposes them to
JavaScript. The environment therefore belongs to the binary: a given APK cannot pick up another
build's JS configuration by accident. Values are validated at startup (`src/app/config/env.ts`).
Invalid configuration shows an explanatory error screen, and `https` is required outside
development.

**Security.** Environment configuration is **not** a security boundary. Everything in these
files is readable by anyone with the APK, so they contain public settings only (they are
committed for that reason) and never secrets.

**Alternatives.** Babel inlining of environment variables (values baked into the JS bundle, so
build type and bundle can disagree, and Metro's cache must be reset on every change), Android
product flavors (would stop the plain `npx react-native run-android` from working, because Gradle
task names become ambiguous), a custom Kotlin module reading `BuildConfig` (reinventing
react-native-config; Kotlin modules start in V7).

## Mobile quality tooling

| Tool | Version | Notes |
| --- | --- | --- |
| TypeScript | 6.0 | See the TypeScript section |
| ESLint | 9, flat config (`eslint.config.js`) | `@react-native/eslint-config` supports ESLint 8 and 9, not 10. ESLint 8 is end-of-life, so 9 is the newest supported option (npm reports 9 as deprecated too; revisit when React Native supports ESLint 10). ESLint is declared at the root as well as in the app, because npm otherwise installs ESLint 8 at the root to satisfy the hoisted plugins' peer dependencies |
| Prettier | 2.8.8 | Version pinned by the React Native template |
| Jest | 29 with `@react-native/jest-preset` | Version pinned by the React Native template |

Known upstream issues, and how they are handled:

- `@react-native/eslint-config` 0.87 bundles `eslint-plugin-ft-flow` 2.x, which crashes on
  ESLint 9. FieldOps has no Flow code, so `eslint.config.js` drops only the Flow block.
- Redux Toolkit's packages resolve to ES-module builds under Jest's `react-native` export
  condition, so they are added to `transformIgnorePatterns`.
- `fetchBaseQuery`'s timeout helper leaves a timer running after each request (harmless in the
  app). The one test file that exercises it uses fake timers so Jest exits cleanly.

## Redux Toolkit

**Why.** Predictable, debuggable state for things that genuinely belong to the app session:
authentication state, UI state shared across screens, the sync status summary shown in the
UI, and connectivity status. Redux Toolkit removes the classic Redux boilerplate and comes with
RTK Query.

**Strict limits** (see [mobile-architecture.md](mobile-architecture.md)):

- Redux is **not** a replacement for SQLite. Domain entities do not live in Redux as their
  source of truth.
- Redux holds **no location history**, only the latest position, and only when a screen needs
  it.
- We do not persist the whole Redux store to disk (no blanket `redux-persist`). Durable data
  goes to SQLite or MMKV on purpose.

**RTK Query** handles **online-only server state**, such as manager dashboards and admin
lists, where caching, deduplication and invalidation are valuable and offline access is not
required. Offline-critical entities (the worker's jobs) come from SQLite, filled by the sync
engine.

**Alternatives.** Zustand or Jotai (lighter, but less structure and tooling for a large app;
viable), TanStack Query (excellent for server state; RTK Query was chosen to keep one
integrated toolkit), MobX.

## WebSockets (Socket.IO through NestJS gateways)

**Why.** Managers need to see job status changes and messages as they happen. Workers need to
receive new assignments and "sync now" hints without polling. WebSockets give a persistent,
low-latency, bidirectional channel.

**Why Socket.IO specifically.** It is mature, runs on top of WebSockets and has first-class
NestJS gateway support. It provides rooms (per organization, per job, per user), acknowledgements,
automatic reconnection with backoff and an official Redis adapter for scaling across
instances. We configure the **websocket-only transport**, with no HTTP long-polling fallback,
which removes the need for sticky sessions behind a load balancer.

**What we build.** The realtime event architecture: event naming, versioned payload schemas,
room and authorization rules, and the rule that **events are hints and sync is the truth**.

**Not building:** a custom WebSocket protocol.

**Alternatives.** The raw `ws` library (we would rebuild rooms, acks and reconnection), SSE
(one-way only), polling (wasteful on battery and data, and slow).

## Docker

**Why.** Reproducible infrastructure. From V3, local PostgreSQL (and later Redis and MinIO)
run in Docker Compose, so every developer and CI run uses identical versions. From V16, the API
and worker are built into a single multi-stage image that runs identically in CI, staging and
production.

**Not using:** Kubernetes, Helm or a service mesh. At our scale, a container platform or a VM
with Compose is enough. See [devops.md](devops.md).

## Kotlin and native Android modules

**Why.** Some FieldOps capabilities cannot be done reliably from JavaScript:

- **Background location.** A foreground service with the Fused Location Provider must keep
  capturing points while the app is backgrounded, the screen is off, or the JavaScript runtime
  is not running. Points are buffered natively and persisted without depending on the JS thread.
- **Background work.** WorkManager schedules sync and upload attempts under OS constraints
  (network available, battery not low) that survive process death.
- **Battery and Doze behavior,** permission flows (including the background location
  permission rules), and device state.

Kotlin is the modern, officially preferred language for Android. Modules are exposed to
JavaScript as **Turbo Modules** with typed specs (codegen), so the TypeScript side stays
strictly typed.

**Rule.** We use the established Android APIs (Fused Location Provider, WorkManager,
foreground services). We write the FieldOps-specific parts: batching, buffering, adaptive
sampling policy and handoff to the sync engine.

## Supporting choices (brief)

| Choice | Reason |
| --- | --- |
| **npm workspaces** | Already bundled with Node, and hoisting works smoothly with Metro in monorepos. pnpm's symlinked layout needs extra Metro configuration. Turborepo or Nx can be added later if build times justify it. |
| **React Navigation** | The standard, well-maintained navigation library for React Native. Supports nested role-based navigators and deep links. |
| **NetInfo** | Standard connectivity signal. Used only as a *hint*: the real signal is whether requests succeed. |
| **Reanimated** | Animations and gestures run on the UI thread, keeping list and interaction performance smooth on mid-range Android devices. Reanimated 4 needs `react-native-worklets` and its Babel plugin. V1 uses it for the connectivity banner, which also proves the native setup early. |
| **react-native-screens, react-native-safe-area-context** | Required by React Navigation's native stack and by edge-to-edge layouts (Android 15+ draws behind system bars). |
| **FCM** | The standard Android push channel. Delivery is not guaranteed, so push is a hint and sync is the truth. |
| **S3-compatible object storage** | Binary media does not belong in Postgres. Presigned uploads keep large bodies off the API. MinIO locally, a managed S3-compatible store in production. |
| **Argon2id and a standard JWT library** | Proven cryptography. We never implement crypto primitives. |

## Pending decisions

These are deliberately deferred to the version where the information to decide exists.

| Decision | Decide in | Leading option |
| --- | --- | --- |
| SQLite library | V5 | op-sqlite or expo-sqlite |
| Runtime schema library for shared contracts | V3 | Zod schemas in `@fieldops/shared`, integrated with Nest validation and OpenAPI |
| How the API consumes workspace packages (compiled vs source) | V3 | Compile shared packages with `tsc` project references |
| HTTP adapter | V19 (re-evaluate) | Express (default) unless benchmarks favor Fastify |
| Local database encryption | V5 / V18 | SQLCipher-capable SQLite build with a Keystore-held key |
| Hosting target | V16 | A managed container platform or a single VM with Compose; managed Postgres and Redis |
| LLM provider | V17 | Behind a provider-neutral interface. Anthropic Claude is the initial candidate |
| Crash reporting | V15 | Sentry or an equivalent |
| Tab icons / icon library | V14 | react-native-svg with a small icon set. V1 uses a text label with an active indicator to avoid an extra native dependency |

## Resolved decisions

| Decision | Resolved in | Outcome |
| --- | --- | --- |
| TypeScript major version | V1 | TypeScript 6.0 across the repository (typescript-eslint requires < 6.1) |
| ESLint version and config format | V1 | ESLint 9 with flat config (the newest version React Native's config supports) |
| Mobile environment configuration | V1 | react-native-config with per-build-type dotenv files |
