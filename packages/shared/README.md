# @fieldops/shared

Framework-free runtime code used by both the API and the mobile app. Since Phase 3 it holds
the **job state machine** (`src/job-state-machine.ts`): the API enforces transitions with it,
and the phone validates the worker's offline commands and predicts their allowed actions with
the same rules.

## Consumption

| Consumer | Loads | How |
| --- | --- | --- |
| Type checking (all workspaces) | `src/*.ts` | `exports` condition `types` |
| Metro (the app) | `src/*.ts` | `exports` condition `react-native` |
| Jest (mobile), Vitest (API) | `src/*.ts` | `moduleNameMapper` / `resolve.alias` |
| The running API (Node) | `dist/*.js` | `exports` condition `default`; built by `npm run build -w @fieldops/shared`, which the API's `prebuild` and `prestart*` scripts run |

Each entry module is exported directly (no relative imports inside): Node ESM needs `.js`
extensions on relative imports, while Metro resolves extensionless source. A new module gets
its own export path.

```bash
npm test -w @fieldops/shared        # Vitest
npm run build -w @fieldops/shared   # dist/ for the API
```

## Roadmap for this package

Pure, framework-free TypeScript that both `apps/mobile` and `apps/api` need at runtime:

| Planned content | Introduced in | Why it is shared |
| --- | --- | --- |
| API contract schemas (runtime validation of request/response payloads) | V6 (sync), if needed | Client and server validate the same shapes. V2 shares contract *types* through `@fieldops/types` instead |
| Job status state machine (allowed transitions) | **Phase 3 (here)** | The mobile app validates transitions offline; the server enforces them |
| Sync protocol envelopes and mutation type definitions | V6 | Both sides must agree on the sync protocol exactly |
| Retry/backoff calculation | V6 | Same policy for mobile sync and server-side workers |
| Realtime event names and payload schemas | V8 | WebSocket contract between gateway and client |

## Rules

- **Framework-free.** No React, React Native, NestJS, Prisma or Node-only APIs (`fs`, `net`,
  and so on). Code must run in Hermes and in Node.
- **Deterministic and side-effect free.** Code here must never do I/O. Time and randomness
  are injected so the code stays testable.
- **Nothing speculative.** Code is added only when a second consumer actually needs it.
