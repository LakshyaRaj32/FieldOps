# Engineering Principles

These principles govern every FieldOps version. When a decision is unclear, go back to them.

## 1. Build what differentiates, adopt what doesn't

Use mature, proven technology for fundamental infrastructure. Build the systems that are
specific to FieldOps and that demonstrate real engineering.

| Adopt (never reinvent) | Build (FieldOps-specific) |
| --- | --- |
| PostgreSQL, SQLite, Redis | Offline sync engine and outbox |
| HTTP servers (via NestJS), WebSockets (via Socket.IO) | Conflict resolution policies |
| Cryptography (Argon2, JWT libraries, TLS) | Idempotency handling |
| Prisma, BullMQ | Retry and backoff strategy |
| FCM, Android location APIs, WorkManager | Custom distributed rate limiter (on Redis) |
| Docker, GitHub Actions | Cache strategy, notification and job orchestration |
| | Location batching, permission architecture, audit logging, realtime event architecture |

Every technology must have a written reason for existing
([technology-decisions.md](technology-decisions.md)).

## 2. Modular monolith first

Start with one deployable backend that has strict internal boundaries. Modules own their data
and communicate through public services and events. Extract a service only when measurements
demand it, not because it looks sophisticated.

## 3. One source of truth per kind of data

PostgreSQL for server data, SQLite for the device working set, Redux for UI state, MMKV for
small preferences, secure storage for credentials, object storage for binaries, and Redis for
ephemeral and coordination state. If you have to ask "which copy is right?", the design is
wrong ([architecture.md](architecture.md#5-sources-of-truth)).

## 4. Offline is the normal path

Design the offline path first and treat connectivity as an optimization. Every feature spec
answers: *what happens with no network, a flaky network, and a network that returns after
three days?*

## 5. Design for failure

Networks drop, responses get lost, processes are killed, clocks drift, Redis restarts and
third-party APIs time out. Code assumes all of this:

- Every retried operation is **idempotent**.
- Every external call has a **timeout**.
- Retries use **exponential backoff with jitter** and distinguish retryable from permanent
  failures.
- Correctness comes from the **database** (constraints, transactions, unique keys), not from
  locks or timing.
- Background work goes through **queues**, and handlers can run more than once.

## 6. Secure by default, from day one

- Authorization is checked on the server for every operation. Client checks are UX only.
- Tenant isolation is enforced by default in data access. There is no unscoped "find by id".
- Validate all input at trust boundaries. Never trust the client, the network, push payloads
  or model output.
- Least privilege for users, services, CI tokens and AI tools.
- Secrets never enter git, logs or the mobile bundle.
- Security-relevant actions are audited.
- Every version's definition of done includes a security review of what changed.

## 7. Strict types, validated boundaries

- TypeScript `strict` plus the extra flags in `packages/config/tsconfig.base.json`. No `any`.
  Use `unknown` and narrow it.
- Types are compile-time only, so runtime schemas validate every external input.
- Make illegal states unrepresentable: discriminated unions for state machines, and branded
  types for IDs where confusion is likely.
- Exhaustive `switch` over unions, enforced by the compiler.

## 8. Explicit over magic

Prefer readable, explicit code over clever abstractions. An abstraction must remove real
duplication or isolate a real volatility. "We might need it" is not a reason. Keep business
logic in plain TypeScript, separate from framework decorators and I/O.

## 9. No placeholder code

- Do not create empty modules, stub services, fake implementations or code that pretends to be
  production functionality.
- A directory that will be filled later gets a README explaining its purpose and when it will
  be filled, and nothing else.
- Dependencies are installed when the version that uses them begins, not before.

## 10. Small, complete increments

Each version delivers a coherent, working, tested slice with updated documentation. Do not
implement features from future versions early. If a future concern affects today's design (for
example, AI needing reusable authorization), record it in the docs and keep the design
compatible, without building it.

## 11. Test what matters, at the right level

- **Unit tests** for pure logic: state machines, policies, conflict rules, backoff.
- **Integration tests** against real Postgres and Redis. Never mock the database.
- **Fault-injection tests** for sync and anything network-dependent.
- **E2E tests** for a small number of critical user journeys.
- A bug fix comes with a test that fails before the fix.

## 12. Observable by design

Structured logs with correlation IDs, meaningful metrics, and traces across process
boundaries. If a sync fails in the field, we must be able to explain why from telemetry
without asking the user to reproduce it.

## 13. Documentation is part of the change

- Architecture docs are updated in the same change that alters the architecture.
- Decisions, and the reasoning behind them, go in `technology-decisions.md`. A reversed
  decision is updated there with the reason, not silently changed.
- Every workspace has a README describing its purpose and rules.

## 14. Dependency discipline

Before adding a dependency, answer: what does it do, why not the standard library or an
existing dependency, is it maintained, what is its size and security record, and what is its
license? Remove unused dependencies promptly.

## 15. Conventions

| Topic | Convention |
| --- | --- |
| Files | `kebab-case.ts`; Nest files follow `name.role.ts` (for example `jobs.service.ts`) |
| Types and classes | `PascalCase`; functions and variables `camelCase`; constants `UPPER_SNAKE_CASE` only for true constants |
| Database | `snake_case` tables and columns (mapped in Prisma), plural table names |
| API | Plural resource nouns, explicit action endpoints for commands, `camelCase` JSON |
| Events and mutation types | `entity.action` (for example `job.completed` for events, `job.complete` for commands) |
| Commits | [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, and so on) |
| Branches | `v<N>/<short-description>` for version work, `fix/<description>` for fixes |
| Versions | Each completed roadmap version is tagged `v0.<N>.0` until production readiness |

## 16. Definition of done (every version)

- [ ] Scope matches the version, with nothing from future versions
- [ ] Type-check, lint and tests pass locally and in CI (once CI exists)
- [ ] Security implications reviewed (authentication, authorization, input, secrets, audit)
- [ ] Offline and failure behavior considered and tested where relevant
- [ ] Documentation updated (architecture, decisions, READMEs, roadmap checklist)
- [ ] No placeholder code, dead code or unused dependencies
