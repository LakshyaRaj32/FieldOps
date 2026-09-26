# FieldOps Architecture

> Status: **target architecture; built through Version 1** (repository foundation and mobile
> app foundation). Anything not yet built is labeled with the version that introduces it. For
> the reasoning behind each technology, see [technology-decisions.md](technology-decisions.md).

## 1. Purpose

FieldOps is an offline-first platform for managing field workers (technicians, delivery
workers, sales representatives, inspectors, maintenance crews).

- **Workers** receive jobs, work where connectivity is unreliable, capture evidence (notes,
  photos, signatures, readings), share their location while on duty, message managers, and
  have their work synchronize automatically when connectivity returns.
- **Managers** create and assign jobs, see job status and worker positions, message workers,
  and receive operational notifications.
- **Admins** manage the organization: users, roles, configuration and audit history.

The defining constraint is that **the worker's device must stay fully useful without a
network connection**, and no work captured offline may be lost or silently duplicated.

## 2. System context

```text
                ┌──────────────────────────────┐
                │        FieldOps mobile        │  React Native + Kotlin (Android)
   Worker ────▶ │  role-based UI (worker/mgr)   │
   Manager ───▶ │  SQLite · outbox · sync engine │
                └──────┬───────────────┬────────┘
          HTTPS (REST, │               │ WSS (realtime events)
          sync, auth)  │               │
                ┌──────▼───────────────▼────────┐        ┌──────────────┐
                │        FieldOps API            │ ─────▶ │ FCM (push)   │
                │   NestJS modular monolith      │        └──────────────┘
                │   api process  +  worker proc. │        ┌──────────────┐
                └──┬─────────┬─────────┬─────────┘ ─────▶ │ LLM provider │ (V17)
                   │         │         │                  └──────────────┘
            ┌──────▼──┐ ┌────▼────┐ ┌──▼──────────────┐
            │Postgres │ │  Redis  │ │ Object storage  │
            │ (truth) │ │ (dist.  │ │ (S3-compatible, │
            │         │ │  state) │ │  photos/files)  │
            └─────────┘ └─────────┘ └─────────────────┘
```

**Clients.** At first, a single React Native app serves every role, with navigation chosen by
role. A web console for managers is a plausible later addition (`apps/web`). The monorepo
layout supports it, but it is not on the roadmap.

## 3. Architectural style: modular monolith

The backend is **one deployable NestJS application** divided into modules with strict
boundaries. It runs as **two process types** from the same codebase:

| Process | Role |
| --- | --- |
| `api` | Handles HTTP requests and WebSocket connections. Must stay fast and must not block on slow work. |
| `worker` (V12) | Consumes BullMQ queues: push notifications, media processing, AI tasks, scheduled maintenance. |

Why not microservices: one team, one domain, and no measured scaling bottleneck. Microservices
would add network failure modes, distributed transactions and deployment overhead with no
benefit. The monolith is designed so that it **could** be split later:

- Modules own their tables. No module queries another module's tables directly.
- Modules talk to each other through exported services or domain events, never through
  each other's internals.
- Side effects that cross modules go through events (in-process first, then queue-backed).

**Criteria for extracting a service later:** a module shows a scaling profile clearly
different from the rest (for example, location ingestion volume), needs independent deployment
cadence, or needs isolation for security or compliance. Extraction is a response to
measurements, not a goal in itself.

## 4. Repository structure

```text
FieldOps/
├── apps/
│   ├── mobile/        React Native + TypeScript (+ Kotlin under android/)      V1
│   └── api/           NestJS + TypeScript + Prisma                            V2
├── packages/
│   ├── config/        Shared tooling config (strict tsconfig base)            V0
│   ├── types/         Shared domain/contract types (Role, ...)                V0
│   └── shared/        Shared framework-free runtime code (schemas, state      reserved
│                      machines, sync protocol, backoff)
├── infra/
│   └── docker/        Local infrastructure (Compose) and image builds          later
└── docs/              Architecture and decision documentation                 V0
```

npm workspaces tie the apps and packages together. Dependencies between workspaces flow in
one direction only:

```text
apps/mobile ──┐
              ├──▶ packages/shared ──▶ packages/types
apps/api ─────┘            │
                           └──────────▶ packages/config (dev-time only)
```

Apps never import from each other. Packages never import from apps.

## 5. Sources of truth

Knowing where each kind of data lives, and which copy wins, prevents most offline-first bugs.

| Data | Source of truth | Notes |
| --- | --- | --- |
| Server-side relational data (orgs, users, jobs, assignments, messages, audit) | **PostgreSQL** | Authoritative for everything the server accepts |
| The device's working set (assigned jobs, drafts, captured evidence, outbox, sync cursors, location buffer) | **SQLite on the device** | Authoritative *for the device* until synchronized; the UI reads from here |
| Transient UI state (open modals, form input, filters, current screen) | **Redux** / component state | Throwaway; may be lost on app restart |
| Small device preferences and flags | **MMKV** | Not relational, not for domain data |
| Tokens and credentials on the device | **Android Keystore-backed secure storage** | Never in MMKV plaintext, Redux persistence or SQLite |
| Binary media (photos, signatures, documents) | **Object storage** (server); device file system (client, until uploaded) | Postgres stores metadata and references only |
| Cache, rate-limit counters, locks, queue state, realtime fan-out | **Redis** | Losing Redis may degrade the service but must never lose business data |

## 6. Core architectural decisions

These decisions are binding for all future versions. Changing one requires updating this
document and [technology-decisions.md](technology-decisions.md).

1. **NestJS is the backend framework.** NestJS runs on an HTTP adapter (Express by default,
   Fastify optionally). Express and NestJS are not competing architectures: Express is a
   transport detail underneath Nest. Application code must not depend on adapter-specific
   `req`/`res` objects, so the adapter can be swapped if load testing (V19) justifies it.
2. **PostgreSQL is the source of truth for server-side relational data.** All business
   invariants are enforced there as well as in code: constraints, foreign keys, unique
   indexes, transactions.
3. **SQLite is the source of truth for relevant offline mobile state.** The UI reads domain
   data from SQLite, not from network responses and not from Redux.
4. **Redis is not the primary database.** Nothing is stored only in Redis if losing it would
   lose business data. Redis holds derived, ephemeral or coordination data.
5. **Redux does not replace SQLite.** Redux holds UI and session state. Domain entities that
   must survive restarts, work offline, or be queried live in SQLite.
6. **Location history is not stored in Redux.** Location points are high-volume telemetry.
   They are buffered natively and in SQLite, uploaded in batches, and pruned after upload.
   Redux may hold at most the *latest* position for display.
7. **Offline mutations use an outbox.** Every local write that must reach the server records
   an outbox entry in the same SQLite transaction as the domain change. See
   [synchronization.md](synchronization.md).
8. **Synchronization is designed around unreliable connectivity.** Requests fail, time out,
   succeed without the response arriving, or arrive twice. The protocol is correct under all
   of these cases, not only when the network is reliable.
9. **Critical server operations support idempotency.** Sync mutations carry client-generated
   IDs. Other critical commands accept an `Idempotency-Key`. Retrying never duplicates effects.
10. **Background processing uses queues, not blocking requests.** Push delivery, media
    processing, AI tasks, exports and fan-out run in the worker process using BullMQ (V12).
    Before V12, any such work is kept minimal and isolated behind a service interface so it can
    move to a queue without changing callers.
11. **Realtime communication uses WebSockets** (Socket.IO through NestJS gateways, V8).
    WebSocket events are notifications and hints. The client reconciles state through the sync
    protocol, so a missed WebSocket event never causes data loss.
12. **Redis supports distributed concerns:** caching (V10), rate limiting (V11), queues
    (V12), distributed locks (V13) and realtime fan-out across API instances. Each use has a
    documented failure mode.
13. **AI works only through controlled backend tools.** AI features never get direct database
    access or raw SQL. They call allowlisted application services under the requesting user's
    permissions. See [ai-architecture.md](ai-architecture.md).
14. **Security is designed in from the start.** Authentication, authorization, tenant
    isolation, input validation, secret handling and audit logging are part of every version's
    definition of done. They are not bolted on in V18. V18 is for hardening and review.

## 7. Conceptual domain model

This is the initial model. V2 implemented `User` and `Session` ([database.md](database.md)); later
versions refine the rest.

```text
Organization 1───* User (role: WORKER | MANAGER | ADMIN)
Organization 1───* Job
Job          1───* JobAssignment *───1 User(WORKER)
Job          1───* JobEvent            (append-only status history, notes, checklist results)
Job          1───* Attachment          (metadata; bytes in object storage)
User         1───* Device              (push token, app version, last seen)
User         1───* Session             (refresh-token family, device binding)
User(WORKER) 1───* LocationPoint       (high-volume, time-partitioned later)
Conversation 1───* Message             (manager ⇄ worker, job-scoped or direct)
User         1───* Notification        (delivery record, read state)
Organization 1───* AuditLogEntry       (append-only)
```

Modeling principle: **worker actions are recorded as append-only events or commands** (start
job, add note, attach photo, complete checklist item, complete job). They are not overwrites of
a whole row. Most offline writes therefore do not conflict at all. See
[synchronization.md](synchronization.md#conflict-resolution).

## 8. Role model

The shared role vocabulary is defined in `packages/types/src/role.ts`. Enforcement is
implemented in V2 onward.

| Capability | WORKER | MANAGER | ADMIN |
| --- | :---: | :---: | :---: |
| View jobs assigned to self | ✅ | ✅ | ✅ |
| Update status / add evidence on own assigned jobs | ✅ | — | — |
| View all jobs in the organization | — | ✅ | ✅ |
| Create, edit, assign, reassign, cancel jobs | — | ✅ | ✅ |
| Share own location while on duty | ✅ | — | — |
| View worker locations (on-duty only) | — | ✅ | ✅ |
| Message assigned workers / managers | ✅ | ✅ | ✅ |
| Receive operational notifications | ✅ (own jobs) | ✅ | ✅ |
| Manage users and roles | — | — | ✅ |
| Organization configuration | — | — | ✅ |
| Read audit log | — | limited (own team's jobs) | ✅ |

**How authorization works:**

- **Roles map to permissions in code.** Examples: `job:read:assigned`, `job:assign`,
  `location:read:team`, `user:manage`. Code checks permissions, not role names, so roles can be
  adjusted without touching every check.
- **Permissions are necessary but not sufficient.** A resource-level policy also checks the
  relationship: *is this worker assigned to this job?*, *is this job in the caller's
  organization?* (roughly RBAC plus ABAC).
- **Tenant isolation is not optional.** Every tenant-scoped query is filtered by
  `organizationId`, taken from the authenticated session and never from the request body.
  Postgres Row-Level Security is evaluated as defense in depth in V18.
- **One role per user per organization** to start. Multi-organization membership and
  custom roles are explicitly out of scope until needed.
- **Location privacy.** Managers see worker locations only while the worker is on duty or on
  an active job. Workers can always see whether tracking is active. Location data has a
  defined retention period.

## 9. Communication patterns

| Pattern | Used for | Transport |
| --- | --- | --- |
| Request/response | Auth, online-only queries (manager dashboards), admin operations | REST over HTTPS, `/api/v1`, OpenAPI documented |
| Sync push/pull | Device ⇄ server reconciliation of offline data | REST (`/api/v1/sync/*`), batched, idempotent |
| Realtime server → client | Job assigned or changed, new message, "sync now" hints, presence | WebSocket (Socket.IO), authenticated |
| Push notifications | Reaching devices when the app is backgrounded or killed | FCM (V9) |
| Background work | Anything slow, retryable or fan-out | BullMQ queues on Redis (V12) |
| Direct upload | Photos and files | Presigned URLs to object storage (V9) |

## 10. Cross-cutting conventions

- **Identifiers.** Entities are identified by **UUIDv7** (time-ordered). IDs for records
  created on the device are generated on the device, so offline-created records never need
  to be remapped from temporary to server IDs.
- **Time.** Stored and transmitted in UTC ISO-8601. Client timestamps are recorded as
  `occurredAt` (when the worker did it). Server timestamps (`receivedAt`, change sequence) are
  authoritative for ordering and sync. Device clocks are never trusted for correctness.
- **API errors.** A consistent envelope, `{ success: false, error: { code, message } }`, with
  stable, machine-readable error codes (V2 replaced the planned RFC 9457 Problem Details; see
  [api.md](api.md)).
- **API versioning.** URI-versioned (`/api/v1`). The sync protocol also carries its own
  `protocolVersion`, because old app versions stay in the field for a long time.
- **Correlation.** Every request carries or receives a request ID, which is propagated into
  logs, queue jobs and outgoing calls (V15 adds full tracing).
- **Validation.** Types are checked at compile time and data is validated at runtime
  **at every trust boundary** (HTTP, WebSocket, queue payloads, SQLite reads after migrations,
  push payloads, LLM outputs).

## 11. Security baseline (applies from the first line of code)

- Passwords hashed with **Argon2id**. Short-lived JWT access tokens and rotating refresh tokens
  stored **hashed** server-side, with reuse detection (implemented in V2, see
  [authentication.md](authentication.md)).
- Tokens stored on the device in Keystore-backed secure storage (`react-native-keychain`).
- HTTPS everywhere outside local development. WebSocket connections authenticate on handshake.
- Authorization checked on the server for every operation, including every sync mutation
  individually. Client-side role checks are only for UX.
- Input validated at the boundary. Output never includes fields the caller may not see.
- Secrets come from the environment or a secret manager and are validated at startup. They
  are never committed.
- Security-relevant actions (login, role change, assignment, deletion, AI tool calls) are
  written to an append-only audit log.
- Rate limiting on authentication and other abuse-prone endpoints (a basic version early, the
  custom distributed limiter in V11).
- Dependencies are kept minimal, and new ones are justified in writing.

## 12. Non-goals

- Microservices, Kubernetes, service mesh or event-sourcing everything.
- A general-purpose CRDT or peer-to-peer sync. FieldOps sync is client-server with
  domain-specific conflict policies.
- iOS support in the initial roadmap (the architecture does not prevent it).
- Custom infrastructure where a mature tool exists: databases, HTTP servers, cryptography,
  WebSocket protocols, queues.

## Related documents

- [technology-decisions.md](technology-decisions.md) · [engineering-principles.md](engineering-principles.md)
- [mobile-architecture.md](mobile-architecture.md) · [backend-architecture.md](backend-architecture.md)
- [offline-first.md](offline-first.md) · [synchronization.md](synchronization.md)
- [devops.md](devops.md) · [ai-architecture.md](ai-architecture.md)
- [roadmap.md](roadmap.md) · [development.md](development.md)
