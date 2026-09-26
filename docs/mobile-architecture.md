# Mobile Architecture

> Status: **design (Version 0).** The app is generated in V1. The layers arrive in V2 (auth),
> V5 (SQLite), V6 (sync), V7 (Kotlin location), V8 (realtime), V9 (push and media) and V14
> (performance).

## 1. Goals

- **Offline-first.** The worker's app is fully usable without connectivity (see
  [offline-first.md](offline-first.md)).
- **Clear state ownership.** Each kind of state has exactly one home. Redux, SQLite, MMKV and
  native storage each hold what they are good at.
- **Reliable native subsystems.** Location capture and background work do not depend on the
  JavaScript runtime being alive.
- **Smooth on mid-range Android devices.** 60 fps lists and interactions, and fast cold start.
- **Strictly typed** end to end, including the native module boundary (codegen specs).

## 2. Platform and project

- **React Native Community CLI** project with the **New Architecture** (Fabric, Turbo Modules)
  and **Hermes**.
- **Android** is the target platform. Native code is **Kotlin**. Native capabilities are
  exposed through TypeScript interfaces so an iOS implementation could be added later without
  touching feature code.
- The app lives in `apps/mobile` inside the npm-workspaces monorepo. Metro is configured to
  watch the workspace packages it imports (`@fieldops/types`, `@fieldops/shared`).

## 3. Source layout

```text
apps/mobile/src/
├── app/            Root component, providers (store, navigation, theme), startup sequence
├── features/       Vertical slices; each owns its screens, components, hooks and data access
│   ├── auth/       V2
│   ├── jobs/       V4–V5
│   ├── location/   V7
│   ├── messaging/  V8
│   └── settings/
├── core/           Infrastructure shared across features (no feature-specific logic)
│   ├── api/        HTTP client, auth header injection, token refresh, RTK Query base API
│   ├── auth/       Session manager, secure token storage
│   ├── db/         SQLite connection, migrations, transaction helper, change notifications
│   ├── sync/       Outbox, sync engine, retry scheduler, sync status
│   ├── realtime/   WebSocket client, event validation, sync hints
│   ├── native/     Typed wrappers around Kotlin Turbo Modules
│   └── storage/    MMKV wrapper with typed keys
├── store/          Redux store configuration, root reducer
└── ui/             Design system: tokens, primitives, shared components
```

**Rules:**

- Features may import from `core/`, `ui/` and workspace packages. Features do **not** import
  from other features' internals. Cross-feature needs go through `core/` or explicit public
  exports.
- `core/` never imports from `features/`.
- Screens are thin: they compose hooks and components. Data access lives in each feature's
  `data/` folder.

## 4. The six kinds of state

| # | Kind | Owner | Examples | Must not |
| --- | --- | --- | --- | --- |
| 1 | UI state | Component state; Redux slices when shared across screens | Form inputs, open sheets, selected filter, active tab | Hold domain entities as truth |
| 2 | Server state (online-only) | RTK Query | Manager dashboard, worker list, admin screens | Be used for offline-critical data |
| 3 | Persistent local application data | SQLite | Assigned jobs, job events, attachment metadata, messages, reference data | Be mirrored wholesale into Redux |
| 4 | Offline mutations | SQLite outbox (same DB, same transaction as the domain write) | `job.complete`, `job.note.add`, `message.send` | Live anywhere in-memory-only |
| 5 | Synchronization state | SQLite (truth); Redux mirror for display | Cursor, pending count, last sync, failures | Be lost on restart |
| 6 | Native device capabilities | Kotlin modules and native buffers | Location capture, background scheduling, permission state | Depend on the JS thread being alive |

Two additional stores exist for specific purposes:

- **MMKV:** small key-value preferences and flags (typed keys only).
- **Keystore-backed secure storage:** tokens and credentials only.

## 5. Data flow

```text
                ┌──────────── Screens / Components ────────────┐
                │   read via hooks          dispatch commands   │
                └──────┬───────────────────────────┬────────────┘
                       │                           │
     ┌─────────────────▼──────┐       ┌────────────▼─────────────┐
     │ useLiveQuery (SQLite)  │       │ Local command handlers    │
     │ RTK Query (online-only)│       │ (domain write + outbox in │
     │ Redux selectors (UI)   │       │  one SQLite transaction)  │
     └─────────▲──────────────┘       └────────────┬─────────────┘
               │ table change notifications         │
     ┌─────────┴────────────────────────────────────▼─────────────┐
     │                         SQLite                              │
     └─────────▲────────────────────────────────────┬─────────────┘
               │ apply pulled changes                │ drain outbox
     ┌─────────┴────────────────────────────────────▼─────────────┐
     │                      Sync engine (core/sync)                 │
     └──────────────────────────────┬──────────────────────────────┘
                                    │ HTTPS
                                    ▼
                               FieldOps API
```

## 6. SQLite access layer (V5)

- **One database connection** managed by `core/db`, opened and migrated during startup before
  any screen renders data.
- **Migrations** are versioned SQL files, forward-only, applied in a transaction and tested
  against snapshots of older schemas.
- **Repositories per feature** expose typed functions (`getAssignedJobs()`,
  `completeJob(cmd)`). Raw SQL stays inside repositories.
- **Transaction helper**: `db.transaction(async (tx) => { ... })` is the only way to write.
  Every write that must sync also enqueues its outbox entry through `tx`.
- **Reactive queries.** After each committed transaction, the data layer emits the set of
  changed tables. `useLiveQuery(sql, deps, tables)` re-runs affected queries. This is a small,
  explicit mechanism. We do not use a heavy ORM.
- **Row validation.** Rows are mapped to domain types through typed mappers. JSON columns are
  validated with the shared schemas.

## 7. Redux Toolkit and RTK Query

**Redux slices (initial plan):**

| Slice | Contents |
| --- | --- |
| `session` | Auth status (`unknown` / `authenticated` / `unauthenticated` / `reauth-required`), principal summary (user ID, role, org) |
| `connectivity` | Latest NetInfo hint, last successful request time |
| `syncStatus` | Mirror of sync summary for display: pending count, failure count, last sync, running flag |
| `ui` | Cross-screen UI state only when genuinely shared |

**RTK Query** is used for online-only endpoints (manager views, admin) with tag-based
invalidation. **It is not the path for offline-critical data.** A worker's jobs come from
SQLite, filled by the sync engine.

**Not used:** blanket `redux-persist`. Durable data is written deliberately to SQLite or MMKV.

**Location rule:** Redux never stores location history. At most, a `location` slice holds the
latest fix and tracking status for display.

## 8. Navigation (V1)

React Navigation with role-based root navigators:

```text
RootNavigator
├── Startup (splash: open DB, run migrations, restore session)
├── AuthStack            (unauthenticated)
│   └── Login
├── WorkerTabs           (role = WORKER)
│   ├── Today / Jobs  → JobDetail → Capture (photo, signature, checklist)
│   ├── Messages
│   └── Profile / Sync status
└── ManagerTabs          (role = MANAGER | ADMIN)
    ├── Dashboard
    ├── Jobs  → JobDetail → Assign
    ├── Map (live worker positions, online-only)
    ├── Messages
    └── Admin            (role = ADMIN)
```

Client-side role routing is **for UX only**. The server authorizes every operation.

## 9. Native modules (Kotlin, V7+)

| Module | Responsibility | Android APIs |
| --- | --- | --- |
| `LocationTracking` | Start or stop an on-duty foreground service, capture fixes with an adaptive interval, buffer natively, expose batches to JS, report tracking state | Foreground service, Fused Location Provider, notification channel |
| `BackgroundSync` | Schedule sync and upload attempts that survive process death, with network and battery constraints | WorkManager |
| `DeviceInfo` / permissions | Battery optimization status, background location permission flow, app standby bucket | Standard Android APIs |

Design rules:

- Each module has a **TypeScript codegen spec**, which is the contract. JavaScript code only
  uses the typed wrapper in `core/native/`.
- **Location capture never depends on JavaScript.** The service persists points natively
  (in its own small store or in the shared SQLite database; decided in V7). The JavaScript sync
  engine, or a WorkManager job, uploads them in batches and deletes them after confirmation.
- Battery awareness: sampling adapts to motion and battery level, respects Doze, and stops when
  the worker goes off duty.
- The persistent notification is always visible while tracking, which Android requires and
  which workers should be able to see anyway.

## 10. Networking

- A single HTTP client in `core/api` handles the base URL, request IDs, auth headers, timeouts
  and one-shot token refresh on `401` (single-flight, so concurrent requests don't trigger
  concurrent refreshes).
- All responses are validated at runtime before entering the app.
- WebSocket client (V8): authenticated on connect, reconnects with backoff, events validated
  against shared schemas, and events trigger sync rather than directly mutating data.

## 11. Performance (V14 focus, practiced from V1)

- Virtualized lists for long collections (FlashList evaluated in V14), with stable keys and
  memoized rows.
- Reanimated for animations and gestures on the UI thread.
- Heavy work stays off the JavaScript thread: image compression natively, and SQLite through a
  JSI library.
- Startup budget: the database opens, migrations run, the session is restored and the first
  screen renders from local data with no network wait.
- Profile before optimizing (React DevTools profiler, Android Studio profiler, Hermes
  sampling).

## 12. Security

- Tokens in Keystore-backed secure storage only. No secrets are bundled in the app. The bundle
  is public.
- Local database encryption evaluated in V5 and enforced by V18.
- HTTPS only outside local development. Certificate pinning evaluated in V18.
- Logs never contain tokens, passwords or personal data. Crash reports are scrubbed.
- Photos are stored in app-private storage and stripped of unnecessary metadata before upload
  (location EXIF is replaced by explicit job-location metadata the worker can see).

## 13. Testing

| Level | Tooling | Focus |
| --- | --- | --- |
| Unit | Jest | Reducers, mappers, command handlers, sync engine with a fake transport |
| Component | React Native Testing Library | Screens with realistic data states (pending, failed, offline) |
| Database | Jest against a real SQLite engine | Migrations, repositories, transactional outbox writes |
| E2E | Maestro (evaluated in V1; Detox as the alternative) | Critical flows: login, complete job offline, reconnect and sync |
| Native | Kotlin unit and instrumented tests | Location buffering, WorkManager scheduling |
