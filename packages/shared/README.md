# @fieldops/shared (reserved)

This directory is reserved. It does **not** contain code or a `package.json` yet. It will
become a workspace package when the first genuinely shared runtime code exists. Creating an
empty package now would only add noise.

## What will live here

Pure, framework-free TypeScript that both `apps/mobile` and `apps/api` need at runtime:

| Planned content | Introduced in | Why it is shared |
| --- | --- | --- |
| API contract schemas (runtime validation of request/response payloads) | V6 (sync), if needed | Client and server validate the same shapes. V2 shares contract *types* through `@fieldops/types` instead |
| Job status state machine (allowed transitions) | V4 | The mobile app validates transitions offline; the server enforces them |
| Sync protocol envelopes and mutation type definitions | V6 | Both sides must agree on the sync protocol exactly |
| Retry/backoff calculation | V6 | Same policy for mobile sync and server-side workers |
| Realtime event names and payload schemas | V8 | WebSocket contract between gateway and client |

## Rules

- **Framework-free.** No React, React Native, NestJS, Prisma or Node-only APIs (`fs`, `net`,
  and so on). Code must run in Hermes and in Node.
- **Deterministic and side-effect free.** Code here must never do I/O. Time and randomness
  are injected so the code stays testable.
- **Nothing speculative.** Code is added only when a second consumer actually needs it.
