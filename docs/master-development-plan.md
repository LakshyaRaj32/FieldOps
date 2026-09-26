# FieldOps --- Master Development Plan

**Project:** FieldOps\
**Type:** Portfolio-grade offline-first field workforce management
platform\
**Target:** Real running Android application + deployable backend +
production-oriented architecture\
**Budget:** ₹0 project budget; prefer local/open-source/free-tier
infrastructure

> **Current status:** Phase 1 complete; Phase 2 implemented, awaiting physical-device
> verification. Details, decisions and known issues: [phase-status.md](phase-status.md).

## 1. Project Vision

FieldOps is an offline-first field workforce management platform for
organizations whose workers operate outside reliable office/network
environments.

### Users

-   **WORKER** --- receives and executes jobs.
-   **MANAGER** --- assigns and monitors jobs/workers.
-   **ADMIN** --- manages the platform and organization.

### Core worker workflow

1.  Log in.
2.  View assigned jobs.
3.  Work with poor or unavailable connectivity.
4.  Start a job.
5.  Use location capabilities.
6.  Complete checklists.
7.  Capture notes, photos, signatures, and evidence.
8.  Send job-specific messages.
9.  Complete the job.
10. Synchronize when connectivity returns.
11. Receive notifications.

### Core manager workflow

-   Create and assign jobs.
-   Monitor job status.
-   Communicate with workers.
-   View appropriate worker/location information.
-   Receive alerts and notifications.
-   View operational reports.

The project demonstrates engineering depth rather than technology-count.

------------------------------------------------------------------------

# 2. Engineering Philosophy

## 2.1 Use mature infrastructure

Use:

-   React Native
-   NestJS
-   PostgreSQL
-   Prisma
-   Redis
-   BullMQ
-   WebSockets
-   SQLite
-   Android location APIs
-   FCM
-   Docker
-   GitHub Actions
-   Jest
-   Prometheus/Grafana where useful

Do not reinvent databases, HTTP servers, encryption, JWT algorithms,
WebSocket protocols, or SQLite.

## 2.2 Own the application-specific engineering

FieldOps-specific engineering includes:

-   Offline outbox
-   Synchronization engine
-   Retry/backoff
-   Conflict resolution
-   Idempotency
-   Rate-limiting algorithms and policies
-   Cache strategy/invalidation
-   Notification orchestration
-   Job orchestration
-   Location batching
-   Application authorization
-   Audit logging
-   Realtime event model
-   AI tool boundary

**Rule: Use infrastructure; own the engineering logic.**

------------------------------------------------------------------------

# 3. Technology Stack

## Mobile

-   React Native
-   TypeScript
-   React Navigation
-   Redux Toolkit
-   RTK Query
-   SQLite
-   NetInfo
-   Reanimated
-   Native Kotlin modules/services where Android-specific functionality
    is genuinely required

## Backend

-   NestJS
-   TypeScript
-   PostgreSQL
-   Prisma
-   Redis
-   BullMQ
-   WebSockets

## Infrastructure

-   Docker
-   GitHub Actions
-   Free-tier staging where practical
-   Prometheus/Grafana where useful

## AI

AI is a final-stage capability. Use an abstraction supporting:

-   Local provider
-   External provider
-   Mock provider

No paid AI API should be required for development.

------------------------------------------------------------------------

# 4. Six-Phase Development Roadmap

The original V1--V19 roadmap is retained as an internal implementation
breakdown, but the project is now managed through **six major phases**.

A phase is a meaningful product/engineering milestone. Smaller tasks and
former versions exist underneath the phase and do not require separate
major project checkpoints.

------------------------------------------------------------------------

# PHASE 1 --- FOUNDATION

**Maps primarily to:** Former V1 + V2

## Objective

Create the real mobile and backend foundation and establish the first
end-to-end authenticated slice.

## Mobile

-   React Native + TypeScript foundation
-   Feature-based architecture
-   Navigation
-   Authenticated/unauthenticated navigation
-   Redux Toolkit
-   RTK Query
-   API abstraction
-   Connectivity abstraction
-   Environment configuration
-   Reusable UI foundation
-   Theme foundation
-   Error handling
-   Testing foundation

## Backend

-   NestJS API
-   PostgreSQL
-   Prisma
-   User model
-   Roles
-   Sessions
-   Password hashing
-   Access tokens
-   Refresh tokens
-   Refresh-token rotation
-   Logout
-   Protected endpoints
-   Role authorization
-   DTO validation
-   Swagger
-   Consistent API errors

## Roles

-   WORKER
-   MANAGER
-   ADMIN

## Authentication

``` text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

## Explicitly defer

-   Redis
-   Rate limiting
-   Jobs
-   SQLite
-   Sync
-   GPS
-   WebSockets
-   Notifications
-   Messaging
-   AI

## Acceptance Criteria

-   App builds.
-   App installs on physical Android.
-   Navigation works.
-   Typecheck passes.
-   Lint passes.
-   Tests pass.
-   Backend runs.
-   Database migrations work.
-   Mobile can authenticate against the backend.
-   Documentation is updated.

**Checkpoint:** `phase-1-foundation`

------------------------------------------------------------------------

# PHASE 2 --- CORE PRODUCT

**Maps primarily to:** Former V3

## Objective

Turn FieldOps into a usable field-work application.

## Job model

Jobs should eventually support:

-   ID
-   Title
-   Description
-   Customer
-   Address
-   Coordinates
-   Scheduled time
-   Priority
-   Status
-   Assigned worker
-   Notes
-   Checklist
-   Created timestamp
-   Updated timestamp

## Statuses

-   PENDING
-   ASSIGNED
-   IN_PROGRESS
-   COMPLETED
-   CANCELLED

## Workflows

### Manager

``` text
Create Job
    ↓
Assign Worker
    ↓
Monitor Status
```

### Worker

``` text
Receive Job
    ↓
View Job
    ↓
Start Job
    ↓
Work
    ↓
Complete Job
```

## Implement

-   Job CRUD where appropriate
-   Assignment
-   Worker job list
-   Job details
-   Status transitions
-   Manager workflow
-   Authorization
-   Validation

Workers must only access jobs they are authorized to access.

## Acceptance Criteria

The complete basic workflow works:

``` text
Manager creates job
        ↓
Assigns worker
        ↓
Worker sees job
        ↓
Worker starts job
        ↓
Worker completes job
```

**Checkpoint:** `phase-2-core-product`

**Status:** implemented (jobs API, state machine, authorization, worker and manager screens,
tests); physical-device verification pending. In practice Phase 2 delivered the job model and
screens that the former roadmap placed in V4. The former V3 (organizations and tenancy) is not
part of any phase yet: see [phase-status.md](phase-status.md).

------------------------------------------------------------------------

# PHASE 3 --- OFFLINE-FIRST ENGINE

**Maps primarily to:** Former V4 + V5 + V6

## Objective

Make offline operation a core architectural capability.

This is one of the most important phases of FieldOps.

## Data ownership

``` text
PostgreSQL
    = server-side source of truth

SQLite
    = relevant mobile offline data

Redux
    = UI/application state

Redis
    = cache/transient distributed state
```

Redux is not the offline database.

## SQLite

Implement:

-   Database initialization
-   Schema/versioning
-   Repository/data-access layer
-   Local job persistence
-   Local reads
-   Local writes
-   Migration foundation

The app must open previously synchronized job data without network
connectivity.

## Outbox

Each local mutation should be represented by an outbox record containing
concepts such as:

-   ID
-   Operation
-   Entity
-   Entity ID
-   Payload
-   Created time
-   Retry count
-   Status
-   Last error

## Sync engine

Implement:

-   Outbox processing
-   Sync queue
-   Retry
-   Exponential backoff
-   Connectivity-triggered synchronization
-   Manual synchronization
-   Idempotency identifiers
-   Partial-success handling
-   Failed-operation handling
-   Sync status
-   Dead-letter operations

Suggested statuses:

``` text
PENDING
SYNCING
SYNCED
FAILED
DEAD_LETTER
```

## Conflict resolution

Implement:

-   Entity versions
-   Conflict detection
-   Explicit conflict rules
-   Appropriate server-authoritative fields
-   Last-write-wins only where appropriate
-   Version numbers/timestamps where useful
-   Domain-specific conflict rules
-   Duplicate-request protection
-   Recovery tools

Do not blindly overwrite local data.

## Critical demonstration

``` text
Login
  ↓
Download Job
  ↓
Turn Internet OFF
  ↓
Start Job
  ↓
Add Notes
  ↓
Capture Evidence
  ↓
Complete Job
  ↓
Close App
  ↓
Turn Internet ON
  ↓
Sync
  ↓
Server Receives Mutations
  ↓
No Duplicate Mutation
  ↓
Correct Final State
```

**Checkpoint:** `phase-3-offline-first`

At this point the project already qualifies as a strong portfolio
project.

------------------------------------------------------------------------

# PHASE 4 --- FIELD OPERATIONS

**Maps primarily to:** Former V7 + V8 + V9

## Objective

Add the device capabilities and communication features that make
FieldOps a realistic field workforce application.

## 4.1 Location

Architecture:

``` text
React Native
    ↓
LocationService
    ↓
Native Kotlin Module
    ↓
Android Location APIs
    ↓
Foreground/Background Service
    ↓
Local Persistence
    ↓
Sync Engine
    ↓
NestJS
```

Implement where justified:

-   Location permissions
-   Tracking start/stop
-   Tracking status
-   Foreground service
-   Location batching
-   Local persistence
-   Battery-aware behavior
-   Geofencing where useful
-   Arrival/departure events

Do not send every GPS point through Redux.

## 4.2 Messaging

Implement:

-   1:1 messaging
-   Job-specific chat
-   Message persistence
-   WebSocket events
-   Online/offline presence
-   Read/unread state
-   Delivery state

Offline messages follow:

``` text
Message
  ↓
SQLite
  ↓
Outbox
  ↓
Sync
  ↓
Server
```

WebSocket delivery is not the source of truth. Messages are persisted.

## 4.3 Notifications

Implement:

-   In-app notifications
-   Push notifications
-   Notification history
-   Preferences
-   Unread count
-   Job-event notifications
-   Message notifications
-   FCM
-   Android notification channels
-   Permission handling

## 4.4 Files and evidence

Support:

-   Photos
-   Documents
-   Signatures
-   Evidence

Architecture:

``` text
Mobile
  ↓
Local File
  ↓
Upload
  ↓
Object Storage
  ↓
Metadata in PostgreSQL
```

Do not store large binary files directly in PostgreSQL unless there is a
strong reason.

**Checkpoint:** `phase-4-field-operations`

------------------------------------------------------------------------

# PHASE 5 --- PRODUCTION ENGINEERING

**Maps primarily to:** Former V10 + V11 + V12 + V13 + V15 + V18

## Objective

Demonstrate backend reliability, distributed-systems reasoning,
observability, and security.

------------------------------------------------------------------------

## 5.1 Redis and caching

Introduce Redis only where a real use case exists.

Use it for:

-   Cache
-   Transient state
-   Rate limiting
-   Distributed locks
-   WebSocket scaling where required

Never use Redis as the primary relational business-data store.

Cache-aside:

``` text
Request
  ↓
Redis?
 ├─ Hit → Return
 └─ Miss
      ↓
  PostgreSQL
      ↓
    Redis
```

Implement:

-   TTL
-   Cache keys
-   Invalidation
-   Stale-data handling
-   Cache stampede protection where useful

------------------------------------------------------------------------

## 5.2 Custom distributed rate limiter

Implement and understand:

-   Fixed Window
-   Sliding Window
-   Token Bucket
-   Redis-backed distributed limiting
-   Configurable policies
-   Atomic operations
-   HTTP 429
-   Rate-limit headers where appropriate
-   Per-user/per-IP keys
-   Endpoint-specific policies

Example policies can be configured and tested rather than treated as
universal production values.

------------------------------------------------------------------------

## 5.3 BullMQ and background workers

Move long-running work out of HTTP request paths.

Potential queues:

-   Notifications
-   Location processing
-   Reports
-   Media
-   Cleanup
-   AI

Architecture:

``` text
API
 ↓
Queue
 ↓
Worker
```

Workers should support:

-   Retry
-   Exponential backoff
-   Priority
-   Delayed jobs
-   Concurrency
-   Idempotency
-   Failed-job handling
-   Dead-letter handling

------------------------------------------------------------------------

## 5.4 Distributed reliability

Implement where genuinely useful:

### Idempotency

``` text
Request
   ↓
Idempotency-Key
   ↓
Server
   ↓
Process Once
   ↓
Repeated Request
   ↓
Return Previous Result
```

### Distributed locks

Use only where coordination requires them.

Support:

-   Lock acquisition
-   TTL
-   Safe release
-   Failure handling

Do not treat distributed locks as a universal concurrency solution.

------------------------------------------------------------------------

## 5.5 Observability

Implement:

-   Structured logging
-   Request IDs
-   Correlation IDs
-   Health checks
-   Metrics
-   Performance measurements
-   Error tracking architecture

Potential metrics:

-   API latency
-   Request count
-   Error rate
-   Queue depth
-   Job processing time
-   Sync failures
-   WebSocket connections
-   Database performance indicators

Avoid unnecessary collection of sensitive information.

------------------------------------------------------------------------

## 5.6 Security hardening

Review:

-   Authentication
-   Authorization
-   Session management
-   Token rotation
-   Password policy
-   Rate limiting
-   Input validation
-   File upload validation
-   API security
-   CORS
-   Secrets
-   Database permissions
-   Audit logging
-   Dependency vulnerabilities
-   Mobile secure storage

Threat-model important flows and document known limitations.

**Checkpoint:** `phase-5-production-engineering`

------------------------------------------------------------------------

# PHASE 6 --- SHOWCASE RELEASE

**Maps primarily to:** Former V14 + V16 + V17 + V19

## Objective

Turn the technically complete system into a measured, documented,
demonstrable portfolio project.

------------------------------------------------------------------------

## 6.1 Mobile performance

Measure before optimizing.

Areas:

-   List virtualization
-   Render counts
-   Memoization
-   Selector design
-   JS-thread performance
-   Memory
-   Startup time
-   SQLite query performance
-   Image optimization
-   Network efficiency
-   Battery impact

UX quality:

-   Skeletons
-   Safe optimistic UI
-   Offline indicators
-   Retry UI
-   Error boundaries
-   Accessibility
-   Gesture/animation polish

------------------------------------------------------------------------

## 6.2 Docker and CI/CD

Target workflow:

``` text
Local
  ↓
Tests
  ↓
GitHub
  ↓
GitHub Actions
  ↓
Typecheck
  ↓
Lint
  ↓
Tests
  ↓
Build
  ↓
Docker Build
  ↓
Staging
  ↓
Physical Android Phone
  ↓
Manual Acceptance Test
```

Docker services may include:

-   API
-   PostgreSQL
-   Redis
-   Workers

Use free hosting where practical.

------------------------------------------------------------------------

## 6.3 AI

AI remains deliberately near the end.

Potential features:

-   Job summaries
-   Conversation summaries
-   Operational assistant
-   Questions such as overdue-job queries

Architecture:

``` text
User
 ↓
AI
 ↓
Intent / Tool Selection
 ↓
Backend Authorization
 ↓
Controlled Service
 ↓
Database
 ↓
Result
 ↓
AI Response
```

AI must not receive unrestricted database access.

Use:

``` text
AIService
 ├── Provider Interface
 ├── Local Provider
 ├── External Provider
 └── Mock Provider
```

------------------------------------------------------------------------

## 6.4 Load testing and final release

Measure actual:

-   API throughput
-   Latency
-   Database behavior
-   Redis behavior
-   Queue throughput
-   Sync throughput
-   Concurrent connections
-   Mobile startup
-   Offline synchronization

Never fabricate scalability numbers.

Create:

-   Architecture diagrams
-   Demo instructions
-   Screenshots
-   API documentation
-   Deployment documentation
-   Test results
-   Performance results
-   Final README
-   Demo video

**Final checkpoint:** `v1.0.0-final`

------------------------------------------------------------------------

# 5. Repository Structure

``` text
FieldOps/
│
├── apps/
│   ├── mobile/
│   └── api/
│
├── packages/
│   ├── shared/
│   ├── types/
│   └── config/
│
├── infra/
│   └── docker/
│
├── docs/
│   ├── master-development-plan.md
│   ├── phase-status.md
│   ├── architecture.md
│   ├── technology-decisions.md
│   ├── mobile-architecture.md
│   ├── backend-architecture.md
│   ├── offline-first.md
│   ├── synchronization.md
│   ├── devops.md
│   ├── ai-architecture.md
│   └── engineering-principles.md
│
├── .gitignore
├── README.md
└── package/workspace configuration
```

------------------------------------------------------------------------

# 6. Phase Completion Workflow

Every phase follows:

``` text
1. Read master plan
        ↓
2. Read phase-status.md
        ↓
3. Inspect existing code
        ↓
4. Implement only current phase
        ↓
5. Typecheck
        ↓
6. Lint
        ↓
7. Automated tests
        ↓
8. Build
        ↓
9. Test physical Android device
        ↓
10. Review changes
        ↓
11. Commit
        ↓
12. Tag checkpoint
        ↓
13. Push GitHub
        ↓
14. Deploy staging when available
        ↓
15. Test deployed system
        ↓
16. Update documentation
        ↓
17. STOP
```

Do not automatically start the next phase.

------------------------------------------------------------------------

# 7. Git Strategy

Meaningful commits:

``` text
feat: implement authentication
feat: add job assignment
feat: add sqlite job repository
feat: implement offline outbox
fix: prevent duplicate sync mutations
test: add synchronization integration tests
```

Major checkpoints:

``` text
phase-1-foundation
phase-2-core-product
phase-3-offline-first
phase-4-field-operations
phase-5-production-engineering
v1.0.0-final
```

During a phase, use smaller commits as needed.

At phase completion:

1.  Test.
2.  Review.
3.  Commit.
4.  Tag.
5.  Push.
6.  Deploy staging when available.
7.  Test deployed version.
8.  Update documentation.
9.  Stop.

------------------------------------------------------------------------

# 8. Local Development

Eventually:

``` text
Terminal 1
└── NestJS API

Terminal 2
└── React Native Metro

Docker
├── PostgreSQL
└── Redis

Physical Android
└── FieldOps
```

Docker Compose may later start the infrastructure together.

The physical Android phone remains the primary mobile development/test
device.

------------------------------------------------------------------------

# 9. Deployment Strategy

The project needs a real running demo but does not require
production-scale infrastructure.

Target:

``` text
GitHub
  ↓
CI
  ↓
Staging
  ↓
Android Phone
```

Public staging should eventually have:

-   Accessible backend
-   Database
-   Redis where needed
-   API
-   Workers where feasible
-   HTTPS
-   React Native Android app configured for staging

Free-tier limitations are acceptable.

Never claim production scale without measurements.

------------------------------------------------------------------------

# 10. Environment Strategy

Three conceptual environments:

### Development

``` text
Local machine
localhost
```

### Staging

``` text
Public free-tier deployment
https://staging-api...
```

### Production

Architecturally supported but not necessarily paid/deployed.

Never commit real secrets.

Use:

``` text
.env.example
```

------------------------------------------------------------------------

# 11. Definition of Done

FieldOps is complete when:

-   Real Android app exists.
-   Real backend exists.
-   Backend is deployable.
-   App connects to deployed backend.
-   Authentication works.
-   Jobs work.
-   Offline operation works.
-   Synchronization works.
-   Conflicts are handled.
-   Location works.
-   Messaging works.
-   Notifications work.
-   Files/media work.
-   Redis is used appropriately.
-   Rate limiting works.
-   Background workers work.
-   Idempotency is demonstrated.
-   Observability exists.
-   Docker works.
-   CI/CD works.
-   Staging works.
-   AI has a safe integration or working local/mock implementation.
-   Automated tests exist.
-   Critical offline-to-online workflow is tested.
-   Architecture is documented.
-   Git history contains meaningful checkpoints.
-   Application can be demonstrated on a physical Android phone.

------------------------------------------------------------------------

# 12. What NOT to Add

Do not add technology merely because it sounds advanced.

Avoid unnecessary:

-   Kubernetes
-   Service mesh
-   Kafka
-   Dozens of microservices
-   Custom database
-   Custom cryptography
-   Custom HTTP server
-   Custom WebSocket protocol
-   Blockchain
-   Unnecessary cloud services

Before introducing a technology, answer:

1.  What problem does it solve?
2.  Why this technology?
3.  Why now?
4.  What happens without it?
5.  Can it be tested?
6.  Can its tradeoffs be explained?

If those questions cannot be answered, do not add it.

Prefer a modular monolith over unnecessary microservices.

------------------------------------------------------------------------

# 13. Interview Philosophy

The project should support explanations such as:

> Here was the problem. Here was the constraint. Here were the
> alternatives. I chose this architecture because of these tradeoffs. I
> implemented the application-specific logic myself, used mature
> infrastructure for underlying primitives, tested the behavior, and
> measured the result.

Examples:

### Redis

Do not only say:

> I used Redis.

Explain:

> PostgreSQL remains the source of truth. Redis handles
> transient/cache/distributed concerns. I implemented cache-aside
> behavior and explicit invalidation where caching was beneficial.

### BullMQ

Explain:

> Long-running notification, report, and media work is moved out of the
> HTTP request path. Workers retry transient failures with backoff, and
> failed jobs can be isolated for recovery.

### Offline synchronization

Explain:

> The mobile app persists relevant domain state in SQLite and records
> local mutations in an outbox. When connectivity returns, the sync
> engine sends idempotent mutations, retries transient failures, and
> applies explicit conflict rules.

------------------------------------------------------------------------

# 14. Final Architecture

``` text
                         FIELDOPS
                            │
             ┌──────────────┴──────────────┐
             │                             │
       React Native                    NestJS API
             │                             │
     ┌───────┼────────┐            ┌───────┼──────────┐
     │       │        │            │       │          │
   Redux   SQLite   Native        Auth    Jobs    Messaging
     │       │      Kotlin         │       │          │
     └───────┴────────┘             └───────┼──────────┘
             │                              │
        Sync Engine                    PostgreSQL
             │                              │
             └──────────────┐               │
                            │               │
                          Redis─────────────┘
                            │
                      ┌─────┴─────┐
                      │           │
                    Cache      BullMQ
                                  │
                           ┌──────┼──────┐
                           │      │      │
                        Workers Workers Workers
                           │
                     Notifications

                        WebSockets
                            │
                     Realtime Events

                       Native Kotlin
                            │
                    Location Subsystem

                         DevOps
                            │
                 Docker + GitHub Actions
                            │
                    Staging Deployment
                            │
                    Monitoring/Metrics

                           AI
                            │
                  Controlled Tool Access
```

------------------------------------------------------------------------

# 15. Project Principle

The final project should not merely demonstrate that technologies were
installed.

It should demonstrate that the developer understands:

-   Why each technology exists.
-   How components interact.
-   What tradeoffs they introduce.
-   Which problems they solve.
-   What alternatives existed.
-   How the system behaves under failure.
-   How the system is tested.
-   How the system is operated.
-   What was measured.
-   What limitations remain.

**FieldOps is a coherent engineering project, not a collection of
technologies.**
