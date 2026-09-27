# @fieldops/types

Shared TypeScript types that describe the FieldOps domain. The mobile app (`apps/mobile`)
and the API (`apps/api`) both use them.

## Current contents

| Export | Since | Description |
| --- | --- | --- |
| `Role` | V0 | The role vocabulary: `WORKER`, `MANAGER`, `ADMIN`. Both a runtime constant object and a type. |
| API envelope and `ApiErrorCode` | V2 | `{ success, data }` / `{ success: false, error }` and the stable error codes |
| Auth contracts | V2 | `UserProfile`, `AuthTokens`, `AuthResult`, login/register/refresh requests |
| Job vocabularies | Phase 2 | `JobStatus`, `JobPriority`, `JobAction`, `JobEventType` (constant objects and types) |
| Job contracts | Phase 2 | `JobSummary`, `JobDetail`, `JobPage`, `JobHistoryEntry`, `UserSummary`, `WorkerSummary`, create/update/assign/cancel requests |
| Offline contracts | Phase 3 | `JobNote`, `AddJobNoteRequest`, `JobWorkingSet`; `JobAction.NOTE`; error code `IDEMPOTENCY_KEY_REUSED` |

The API checks at compile time that its Prisma enums and error codes match these vocabularies
exactly (`src/users/role.ts`, `src/jobs/job-enums.ts`, `src/common/errors/error-codes.ts`).

## Rules

- **Types and constant vocabularies only.** There is no business logic, I/O or runtime
  dependencies here. Anything with runtime behavior belongs in `@fieldops/shared`.
- **No framework imports.** Nothing from React, React Native, NestJS or Prisma. This package
  must compile on its own.
- **Types do not validate.** A TypeScript type says nothing about data received over the
  network. Data crossing a boundary (HTTP, WebSocket, SQLite, push payloads) must be checked
  at runtime by a schema. Those schemas will live in `@fieldops/shared` (decision recorded in
  Version 3).
- The Prisma schema is the source of truth for **database** shapes. This package holds
  **API/domain contract** shapes. They are related but deliberately separate, so storage
  details do not leak into the API.

## Consumption

The package is consumed as TypeScript source (`main`/`types` point to `src/index.ts`). Metro
(React Native) bundles it directly. The NestJS API uses **types only** (`import type`), so the
compiled API never loads it at runtime and no build step is needed. The first runtime import on
the API side must decide how the package is built. `@fieldops/shared` (Phase 3) shows the
pattern: source for bundlers and type checking, compiled `dist/` for Node; see
`docs/technology-decisions.md`.
