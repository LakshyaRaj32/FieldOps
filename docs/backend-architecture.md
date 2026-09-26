# Backend Architecture

> Status: **implemented foundation (Version 2).** The NestJS application exists in `apps/api`
> with configuration, Prisma/PostgreSQL, the HTTP pipeline, health checks, `auth` and `users`
> (see [backend-development.md](backend-development.md) and
> [authentication.md](authentication.md)). The rest of this document is the design that later
> versions follow. Where V2 deliberately deviated from the V0 design, the text says so.
> Modules are added in the versions listed below.

## 1. Goals

- A **modular monolith** in NestJS with module boundaries strong enough that a module could be
  extracted into its own service if measurements ever justify it.
- **PostgreSQL** as the source of truth. Invariants are enforced by the database as well as
  by code.
- **Authorization at the server** for every operation, including each sync mutation.
- **Fast API process.** Anything slow, retryable or fan-out moves to the worker process.
- **Operable.** Structured logs, metrics, traces, health checks and configuration validated at
  startup.

## 2. Process model

```text
                 ┌────────────────────────── apps/api ──────────────────────────┐
                 │                                                              │
  HTTPS/WSS ───▶ │  api process (main.ts)            worker process (worker.ts) │
                 │  ─ REST controllers /api/v1       ─ BullMQ consumers (V12)   │
                 │  ─ WebSocket gateways (V8)        ─ scheduled jobs           │
                 │  ─ enqueues jobs, never blocks    ─ outbox relay (V13)       │
                 │           │                                   │              │
                 └───────────┼───────────────────────────────────┼──────────────┘
                             ▼                                   ▼
                    PostgreSQL (Prisma)          Redis (cache, limiter, queues, locks, pub/sub)
```

Both processes share the same modules and domain code. They differ only in which NestJS
providers they start. Both scale horizontally. Neither holds session state in memory beyond
open WebSocket connections.

## 3. Module map

| Module | Responsibility | Version |
| --- | --- | --- |
| `common` | Config validation, error mapping (error envelope), access logging, request IDs, base guards, Prisma service, health checks | V2 |
| `auth` | Login, token issuance and rotation, logout, session and device binding, password hashing | V2 |
| `users` | User profiles, role assignment (admin), user lifecycle | V2 (table, profile, admin list), grows with V3 |
| `organizations` | Tenancy, org settings | V3 |
| `jobs` | Jobs, assignments, job state machine, job events | V4 |
| `audit` | Append-only audit log writer and query API (admin) | V4 (writer), grows over time |
| `sync` | Push/pull endpoints, `processed_mutations`, `change_log`, visibility filtering | V6 |
| `locations` | Batched location ingestion, latest-position queries, retention | V7 |
| `messaging` | Conversations, messages, WebSocket delivery | V8 |
| `realtime` | Socket.IO gateway, authentication on handshake, room policy, event envelopes | V8 |
| `notifications` | Notification orchestration: preferences, deduplication, FCM delivery, device tokens | V9 (queue-backed in V12) |
| `files` | Presigned upload/download URLs, attachment metadata, media post-processing | V9 |
| `analytics` | Operational reporting (job throughput, on-time rate) | later, on demand |
| `ai` | Controlled AI tools and use cases | V17 |

A module is created in the version that needs it. Empty modules are never created ahead of
time.

## 4. Inside a module

Modules live directly under `src/` (`src/auth`, `src/users`; V2 dropped the planned
`src/modules/` level because it added nesting without adding information).

```text
jobs/
├── jobs.module.ts
├── jobs.controller.ts          Transport: HTTP routing, DTO binding. No business logic.
├── jobs.service.ts             Application layer: use cases, transactions, authorization calls
├── domain/
│   ├── job-state-machine.ts    Pure logic: allowed transitions (shared with mobile via @fieldops/shared)
│   └── job.policy.ts           Pure authorization policies (can user X do Y to job Z?)
├── data/
│   └── jobs.repository.ts      Prisma queries owned by this module
├── dto/                        Request/response contracts (validated at runtime)
└── *.spec.ts                   Tests next to the code they cover
```

**Layering rules:**

- Controllers and gateways → services → domain and data. Dependencies never point upward.
- **Domain code is plain TypeScript.** It has no Nest decorators, no Prisma and no I/O, so it
  can be unit-tested without a database and shared with the mobile app when relevant.
- **Data access is module-owned.** A module's repository is the only code that touches its
  tables. We do **not** build a generic repository abstraction over Prisma. Repositories exist
  to keep queries in one place and make them testable, not to hide the ORM.
- **Cross-module calls** go through the other module's exported service, never its repository
  or tables.
- **Cross-module side effects** go through domain events: "job completed" → notify the manager
  and broadcast in realtime. These start as in-process events and become queue-backed through a
  transactional outbox (V12–V13) without callers changing.

## 5. Request lifecycle

```text
request
  → request ID + structured logging (middleware)
  → rate limiter (custom distributed, V11; not present before)
  → AuthGuard           verify access token → attach principal { userId, orgId, role, sessionId }
  → PermissionsGuard    route-level permission check (e.g. job:assign)
  → ValidationPipe      runtime validation of body/query/params; unknown fields rejected
  → IdempotencyInterceptor (critical commands, V13)
  → controller → service
        → resource policy check (e.g. "is caller assigned to this job?")
        → transaction: domain logic + persistence + audit + outbox events
  → response serialization (explicit response DTOs; never return raw Prisma models)
  → response envelope { success: true, data }
  → exception filter → error envelope { success: false, error: { code, message } }
```

## 6. API design

- **REST, JSON, URI-versioned** (`/api/v1/...`). Commands that aren't CRUD are explicit
  actions (`POST /jobs/{id}/assign`) rather than overloading `PATCH`.
- **OpenAPI** generated from code (`@nestjs/swagger`), served in non-production environments
  and exported as an artifact in CI.
- **Validation.** DTO classes validated by `class-validator` through a global
  `ValidationPipe`, with unknown fields rejected. Contract *types* shared with the mobile app
  live in `@fieldops/types`, and DTOs `implements` them, so drift fails compilation (V2
  decision; see [technology-decisions.md](technology-decisions.md#backend-libraries-v2)).
- **Errors.** The envelope `{ success: false, error: { code, message, details?, requestId } }`
  with a stable `code` (for example `JOB_REASSIGNED`). Stack traces, database and framework
  messages are never returned to clients. V2 chose this envelope over RFC 9457 Problem Details;
  see [api.md](api.md).
- **Pagination.** Cursor-based (`?cursor=&limit=`) for lists that can grow. Offset pagination
  is allowed only for small admin tables.
- **Idempotency.** Critical non-sync commands accept an `Idempotency-Key` header. The key,
  request hash and response are stored so retries return the same result, and reusing a key
  with a different payload is rejected (V13).
- **Concurrency.** Mutable manager-owned resources carry a `version`. Updates require it and
  return `409` on mismatch.

## 7. Data layer

- **Prisma** schema and committed migrations (`prisma migrate`). Migrations run as a release
  step (`prisma migrate deploy`), never automatically on app start in production.
- **Tenant scoping.** Every tenant-owned table has `organization_id`, indexed. Repositories
  take the principal's `orgId` explicitly. There is no "find by id" without org scope. Postgres
  Row-Level Security is evaluated as defense in depth in V18.
- **Identifiers.** UUIDv7 primary keys, which allow client generation and have index-friendly
  ordering.
- **Timestamps.** `timestamptz` only. `created_at` and `updated_at` are set by the database.
- **Versioning.** An integer `version` on mutable aggregates for optimistic concurrency and
  sync.
- **Deletes.** Business entities are soft-deleted or tombstoned where devices must learn about
  the deletion (sync). Hard deletion is used for retention-driven cleanup.
- **Append-only tables:** `job_events`, `audit_log`, `change_log`, `location_points`.
  Location points get time-based partitioning once volume warrants it (V7 or later).
- **Transactions** are short and never include network calls to external services (FCM, object
  storage, LLMs). Those happen after commit, through the outbox and queues.

## 8. Authentication (V2)

Implemented; the full description is in [authentication.md](authentication.md).

- Email and password to start. **Argon2id** hashing. The design allows adding SSO/OIDC for
  organizations later.
- **Access token:** a short-lived JWT (15 minutes) carrying `sub`, `role`, `sid` (`org` joins
  with organizations in V3). **Deviation:** HS256 with a secret instead of asymmetric signing,
  because the API is the only issuer and verifier for now. Revisit in V18.
- **Refresh token:** a signed JWT naming its session plus a random `jti`, stored **hashed**
  (SHA-256) on the session row, rotated on every use, with **reuse detection**. Presenting an
  already-rotated token revokes the whole session. **Deviation:** a JWT rather than an opaque
  value, so the session is found by primary key and a genuine old token can be told apart from
  a forged one without keeping a token history.
- Every authenticated request also checks its session in the database, so logout, revocation
  and deactivation take effect immediately. Redis can cache this lookup (V10+).
- Login, registration and refresh are rate-limited in V11 and audited from V4.

## 9. Authorization

- **Roles → permissions** mapping in code (see [architecture.md](architecture.md#8-role-model)).
- **Guards** check route-level permissions. **Policies** in each module's `domain/` check
  resource relationships and tenancy.
- The **same policy functions** authorize direct API calls, sync mutations, WebSocket room
  joins and AI tool calls. There is one source of authorization truth.
- Authorization failures return `403` without revealing whether the resource exists in
  another tenant (`404` where appropriate).

## 10. Realtime (V8)

- Socket.IO through NestJS gateways, **websocket-only transport**.
- The access token is verified on handshake. Connections are dropped when the session is
  revoked.
- **Rooms:** `user:{id}`, `org:{id}:managers`, `job:{id}`. Joining a room is authorized by
  the same policies as REST.
- **Event envelope:** `{ type, version, id, occurredAt, data }`, with versioned payload schemas
  in `@fieldops/shared`.
- **Events are hints.** The authoritative state is always available through REST or sync.
  Clients that miss events converge on their next sync.
- Multi-instance fan-out uses the Socket.IO Redis adapter (V10).

## 11. Background processing (V12)

| Queue (initial) | Jobs |
| --- | --- |
| `notifications` | Fan-out, preference evaluation, FCM delivery with retries |
| `media` | Thumbnail generation, EXIF stripping, virus scan hook |
| `sync-maintenance` | Pruning `processed_mutations`, compacting `change_log` |
| `locations` | Aggregation, retention cleanup |
| `ai` | Summarization and extraction tasks (V17) |

- Handlers are **idempotent**. A job may run more than once.
- Retries use exponential backoff with jitter (the shared policy). Jobs that exhaust retries go
  to a failed set that operators can inspect and replay.
- A **transactional outbox** (V13) bridges Postgres commits and queue publishes, so an event is
  never lost between the database commit and the enqueue.

## 12. Redis-backed concerns

| Concern | Version | Design notes |
| --- | --- | --- |
| Cache | V10 | Read-through for hot, rarely changing reads (org settings, reference data, permissions). Explicit invalidation on write. TTL as a safety net. Never cache authorization decisions across tenants |
| Rate limiter | V11 | **Custom**: sliding-window or token bucket as atomic Lua scripts. Keys by IP, user and route class. Per-route fail-open or fail-closed policy. `429` with `Retry-After` |
| Locks | V13 | For avoiding duplicate work (scheduled jobs, heavy recomputation). **Not** relied on for correctness: Postgres constraints and idempotency guarantee that. Leases with expiry, and fencing tokens where writes follow the lock |
| Realtime | V10 | Socket.IO Redis adapter for cross-instance broadcast |
| Queues | V12 | BullMQ |

## 13. Audit logging

- Append-only `audit_log`: `id, org_id, actor_id, actor_type (user|system|ai), action,
  resource_type, resource_id, request_id, ip, user_agent, metadata (JSONB), created_at`.
- Written **in the same transaction** as the change it records.
- Covers authentication events, role changes, assignments, cancellations, deletions, data
  exports and every AI tool invocation.
- Admins can read it. It is never editable through the API.

## 14. Configuration and secrets

- All configuration comes from environment variables, **validated at startup** against a
  schema. The process refuses to start with invalid or missing config.
- `.env.example` documents every variable. Real `.env` files are gitignored.
- Production secrets come from the hosting platform's secret manager.

## 15. Testing

| Level | Scope | Tooling |
| --- | --- | --- |
| Unit | Domain logic, policies, state machines, backoff | Jest (or Vitest) with no I/O |
| Integration | Services and repositories against **real PostgreSQL** (and Redis when used) | Docker-based test databases, isolated per run |
| E2E API | HTTP-level flows (auth → create job → sync push/pull) | Supertest against the Nest app |
| Contract | Shared schemas validated on both sides | Shared test fixtures in `@fieldops/shared` |
| Load | Sync push/pull, location ingestion, WebSocket fan-out | V19 (k6 or similar) |

Mocks are for external services (FCM, the LLM provider, object storage). The database is never
mocked in integration tests.

## 16. Extraction path

If a module needs to become a service:

1. Its tables are already private to it, so move them to a separate schema or database.
2. Its exported service interface becomes an HTTP/gRPC API or a queue contract.
3. Its in-process domain events already go through the outbox and queues, so subscribers do not
   change.

The most likely first candidate, if volume demands it, is **location ingestion**, which is
high-write and append-only with a different scaling profile.
