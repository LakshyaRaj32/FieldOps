# Mobile Architecture

> Status: **Phases 1–3 implemented** (Phase 1 / V1–V2: project, navigation, state,
> connectivity, API layer, environments, UI foundation, error handling, real authentication,
> secure token storage, session restore and token refresh, see
> [authentication.md](authentication.md#8-mobile-app); Phase 2: the jobs feature, see
> [Jobs (Phase 2)](#jobs-phase-2); Phase 3: SQLite, the outbox and the sync engine for the
> worker's jobs, see [6. SQLite access layer](#6-sqlite-access-layer-phase-3)). Later layers arrive in V5 (SQLite), V6 (sync), V7 (Kotlin location), V8 (realtime), V9 (push and media) and V14
> (performance). **Phase 4 (code written, awaiting verification):** Kotlin modules
> `FieldOpsLocation` and `FieldOpsFiles`, `services/location`, `services/files`,
> `services/media`, `services/realtime`, `services/push`, the notifications feature, and
> local schema v2; see [9. Native modules](#9-native-modules-kotlin-v7) and
> [Field operations (Phase 4)](#field-operations-phase-4). How to run and develop the app:
> [mobile-development.md](mobile-development.md).

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

- **React Native 0.87** project generated with the **Community CLI**, with the **New
  Architecture** (Fabric, Turbo Modules) and **Hermes**.
- **Android** is the target platform. The template's iOS project was removed in V1. Native
  capabilities are exposed through TypeScript interfaces so an iOS implementation could be added
  later without touching feature code.
- Android application ID `com.fieldops.mobile`. The staging build type installs as
  `com.fieldops.mobile.staging` so it can sit next to the development build.
- The app lives in `apps/mobile` inside the npm-workspaces monorepo. Dependencies are hoisted to
  the repository root, so:
  - `android/settings.gradle` and `android/app/build.gradle` locate React Native packages with
    Node's module resolution instead of fixed `../node_modules` paths;
  - `metro.config.js` watches `<repo>/node_modules` and `<repo>/packages` (not the whole repo),
    so workspace packages such as `@fieldops/types` resolve and hot-reload.

## 3. Source layout

The layout implemented in V1. Every folder exists because it holds real code. Folders from
the planned layout that have nothing in them yet are created by the version that fills them.

```text
apps/mobile/src/
├── app/                        App shell: wiring only, no feature logic
│   ├── App.tsx                 Root: config check → providers → navigation
│   ├── ConfigurationErrorScreen.tsx
│   ├── config/                 Environment parsing/validation (only importer of react-native-config)
│   ├── navigation/             Root/Auth/App navigators, param-list types, navigation theme, screen layout
│   └── providers/              AppProviders (safe area, Redux, theme, error boundary), AppServices
├── assets/                     Images bundled with the app (brand-mark.png, rendered with the launcher icon)
├── components/
│   ├── ui/                     Primitives: AppText, Button, Card, Badge, Icon, Screen (keyboard-aware),
│   │                           SectionTitle, SegmentedControl, Skeleton, TextField (+ FieldLabel/FieldMessage)
│   └── common/                 App-aware composites: Loading/Error/Empty states, InfoRow, ErrorBoundary,
│                               ConnectivityBanner, DateTimeField (native pickers), ImageViewer (full-screen zoom)
├── features/                   Vertical slices; each owns its screens and feature-local components
│   ├── auth/                   Login, Register, auth endpoints, session thunks, form validation
│   ├── dashboard/              Dashboard tab
│   ├── jobs/                   Jobs stack: list, details, create/edit, assign; job API, rules, components
│   ├── notifications/          Notifications tab (placeholder until Phase 4)
│   └── profile/                Account, theme preference, diagnostics
├── hooks/                      Cross-feature hooks (useConnectivity, useKeyboardInset)
├── services/                   Infrastructure wrappers; the only code allowed to touch these libraries
│   ├── api/                    RTK Query base API, base query (auth header, refresh), request IDs, listeners, health
│   ├── auth/                   Credential store (sole owner of tokens), payload checks, session events
│   ├── network/                Connectivity model (pure) and NetInfo service
│   └── storage/                MMKV preferences (typed keys); Keystore-backed secure storage (keychain)
├── store/                      Redux store, typed hooks
│   └── slices/                 Application-wide slices: session, connectivity
├── theme/                      Tokens, light/dark themes, ThemeProvider, theme preference
└── utils/                      Error model, logger, global error handler
```

**Growth plan.** New infrastructure goes into `services/` (for example `services/db` in V5,
`services/sync` in V6, `services/native` in V7, `services/realtime` in V8; V2 added
`services/auth` and secure storage in `services/storage`). Feature data access goes into `features/<feature>/api`
(RTK Query endpoints injected into the base API) and later `features/<feature>/data` (SQLite
repositories).

### Deviations from the Version 1 brief (and why)

| Brief | Implemented | Reason |
| --- | --- | --- |
| `features/auth, jobs, profile, notifications` | Also `features/dashboard` | Dashboard is a tab with its own screen. Putting it inside another feature would couple unrelated code |
| `types/` folder | Not created | No app-wide types exist yet that don't belong to a module. Shared domain types live in `@fieldops/types`, and module types live next to their code |
| `assets/` folder | Not created | The app has no images or fonts yet. The folder arrives with the first asset |
| `services/api` fetch/HTTP layer | RTK Query `fetchBaseQuery` wrapped by `createBaseQuery` | RTK Query is already the chosen server-state tool. A second HTTP client would duplicate it |
| V0 plan named the infrastructure folder `core/` | `services/` | Matches the V1 brief; the responsibilities are identical |

**Rules (enforced where possible):**

- Features may import from `app/config`, `components/`, `hooks/`, `services/`, `store/`,
  `theme/`, `utils/` and workspace packages. Features do **not** import from other features.
- `services/` never imports from `features/` or `store/`. `app/providers/AppServices.tsx` is
  the single place that connects services to the store.
- **ESLint boundaries:** `react-native-config` may only be imported in `app/config`, NetInfo
  only in `services/network`, MMKV only in `services/storage`, the icon font
  (`@react-native-vector-icons/*`) only in `components/ui/Icon.tsx`, and the date/time picker
  only in `components/common/DateTimeField.tsx`. The global `fetch` is forbidden
  in app code (use the API layer), and `console` is forbidden outside `utils/logger.ts`.
- Screens are thin: they compose hooks and components.

## 4. The six kinds of state

| # | Kind | Owner | Examples | Must not | V1 status |
| --- | --- | --- | --- | --- | --- |
| 1 | UI state | Component state; Redux slices when shared across screens | Form inputs, open sheets, selected filter | Hold domain entities as truth | Component state only |
| 2 | Server state (online-only) | RTK Query | Manager dashboard, worker list, admin screens | Be used for offline-critical data | Base API + health check; Phase 2 jobs (interim, see [Jobs](#jobs-phase-2)) |
| 3 | Persistent local application data | SQLite | Assigned jobs, job events, attachment metadata, messages | Be mirrored wholesale into Redux | Phase 3: the worker's jobs |
| 4 | Offline mutations | SQLite outbox (same DB, same transaction as the domain write) | `job.complete`, `job.note.add` | Live anywhere in-memory-only | Phase 3: start, complete, note |
| 5 | Synchronization state | SQLite (truth); React context for display | Pending count, failures, last sync | Be lost on restart | Phase 3 |
| 6 | Native device capabilities | Kotlin modules and native buffers | Location capture, background scheduling | Depend on the JS thread being alive | V7 |

Two additional stores exist for specific purposes:

- **MMKV:** small key-value preferences and flags, typed keys only. V1 stores the theme
  preference (`ui.themePreference`).
- **Keystore-backed secure storage** (`react-native-keychain`, AES-GCM with a Keystore key):
  the session credentials only, owned by `services/auth/credentialStore.ts` (V2).

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
     │                         SQLite (V5)                         │
     └─────────▲────────────────────────────────────┬─────────────┘
               │ apply pulled changes                │ drain outbox
     ┌─────────┴────────────────────────────────────▼─────────────┐
     │                    Sync engine (services/sync, V6)           │
     └──────────────────────────────┬──────────────────────────────┘
                                    │ HTTPS
                                    ▼
                               FieldOps API
```

Since Phase 3, all paths exist for the worker's jobs. The reactive read hook is
`useLocalQuery` (behind `useLocalJobs` / `useLocalJob`), and the sync engine lives with the
feature (`features/jobs/data/syncEngine.ts`) rather than in `services/sync`: it is job-specific
by design, not a generic framework.

## 6. SQLite access layer (Phase 3)

```text
services/db/
├── database.ts          SqlDatabase: async reads, synchronous work inside transaction()
├── nitroDatabase.ts     device implementation (react-native-nitro-sqlite; sole importer, ESLint)
└── migrations.ts        forward-only migrations in PRAGMA user_version, one transaction each
features/jobs/data/
├── localSchema.ts       migration 1: jobs (server_json + local_json), outbox, sync_state
├── localJobStore.ts     the repository: reads, local commands, outbox state, working-set apply
├── projection.ts        local view = server copy + pending commands (pure)
├── syncEngine.ts        push outbox → pull working set; retry, conflicts, single flight
├── retryPolicy.ts       failure classification and backoff
├── apiTransport.ts      engine ⇄ API through RTK Query (auth, refresh, error mapping)
├── offlineSession.ts    one database file per worker; open, migrate, release
├── OfflineJobsProvider.tsx  session lifecycle + sync triggers (start, foreground, reconnect)
└── OfflineJobsContext.ts    useOfflineJobs, useLocalJobs, useLocalJob, useProblemEntries
testing/
├── nodeSqliteDatabase.ts    SqlDatabase on node:sqlite for tests (real SQLite in Jest)
└── fakeJobServer.ts         the API's rules + fault injection, for engine tests
```

- **One database per worker**, opened (and migrated before anything reads) at sign-in or
  offline session restore. Managers do not get one: their screens are online.
- **Writes only in transactions**; every local command writes its outbox entry and the
  recomputed local view together.
- **Reactive reads:** the store notifies subscribers after each committed transaction;
  `useLocalQuery` re-runs its read. Small and explicit, no ORM.
- **Row validation:** stored jobs are parsed with the same runtime guard as API responses
  (`isJobDetail`).
- Details and policies: [offline-first.md](offline-first.md#as-built-in-phase-3) and
  [synchronization.md](synchronization.md#as-built-in-phase-3).

## 7. Redux Toolkit and RTK Query

**Slices** (`src/store/slices`):

| Slice | Contents |
| --- | --- |
| `session` | Discriminated union: `restoring` (start-up, reading secure storage), `signedOut` (with an optional reason: `signedOut` or `sessionEnded`), or `signedIn` with the `UserProfile`. **Tokens are never stored here**, not even in actions; see [authentication.md](authentication.md#8-mobile-app) |
| `connectivity` | Latest status, connection type and reachability; `lastChangedAt`; `recoveringFromOffline` and `restoredAt` so the UI can show "Reconnecting…" and "Back online" |
| `api` | The RTK Query cache (`baseApi.reducer`) |

**Planned slices:** `syncStatus` (V6, a display mirror of SQLite state) and `ui` (only when
cross-screen UI state genuinely appears).

**Store rules:** `createAppStore()` builds the store (the app uses a singleton, tests build
their own). There is no blanket persistence, no large collections and no location history.
Signing out dispatches `baseApi.util.resetApiState()` so cached server data never leaks to the
next user.

**RTK Query** (`src/services/api`):

- `baseApi` is empty on purpose. Features add endpoints with `baseApi.injectEndpoints()`.
- `createBaseQuery` wraps `fetchBaseQuery`. It sets the base URL and timeout from environment
  config, adds `Accept` and `X-Request-Id`, and normalizes every failure into an `AppError`.
- `setupApiListeners` feeds RTK Query's refetch-on-focus and refetch-on-reconnect from
  `AppState` and the connectivity service (React Native has no browser online/focus events).
  It dispatches only on real online/offline transitions.
- RTK Query is for online-only data. **It is not the path for offline-critical data.**

**Location rule:** Redux never stores location history. At most, a `location` slice holds the
latest fix and tracking status for display.

## 8. Navigation

**Implemented in V1:**

```text
RootNavigator (native stack, NavigationContainer themed from the app theme)
├── Auth   (mounted while signed out)  → AuthNavigator (native stack)
│   └── Login
└── App    (mounted while signed in)   → AppNavigator (bottom tabs)
    ├── Dashboard
    ├── Jobs      → JobsNavigator (native stack, Phase 2)
    │   ├── JobList        "My jobs" for workers, "Jobs" for managers
    │   ├── JobDetail
    │   ├── JobForm        create / edit (managers)
    │   └── AssignWorker   (managers)
    ├── Notifications
    └── Profile
```

- Exactly one of `Auth` or `App` is mounted, chosen from session state. Signing out unmounts
  every authenticated screen, so back navigation cannot return to it.
- Navigators use `screenLayout` to render the connectivity banner below the header on every
  screen. The Jobs tab hides its own header and plain-wraps its stack, whose screens get the
  banner below the stack header instead.
- Param lists are typed (`app/navigation/types.ts`) and registered globally, so
  `useNavigation()` is type-checked.
- `AuthNavigator` has Login and Register (V2). While the session is `restoring`, the root
  renders a loading screen instead of either navigator, so the sign-in screen never flashes
  for a signed-in user. Password reset is future work.

**Tab icons (UI/UX phase).** Every tab has an Ionicons icon: filled while active, outline
while inactive, so the active tab differs by shape as well as color. The Notifications tab
shows the unread count as a badge and in its accessibility label. The tab bar hides while the
keyboard is open, so forms get the full height.

**Phase 2 kept one tab set for every role.** Role differences live inside the screens
(list title, assignee shown, "New job") and, above all, in the server's `allowedActions`.
**Planned evolution:** role-specific tabs once there is more role-specific content, for example:

```text
WorkerTabs  (WORKER)            Today / Jobs → JobDetail → Capture, Messages, Profile
ManagerTabs (MANAGER | ADMIN)   Dashboard, Jobs → JobDetail → Assign, Map, Messages, Admin (ADMIN)
```

Client-side role routing is **for UX only**. The server authorizes every operation.

## Jobs (Phase 2)

`features/jobs/`:

```text
jobs/
├── api/jobsApi.ts        RTK Query endpoints (list = infinite query with cursors, details, commands, workers)
├── api/contracts.ts      Runtime checks of every job payload before it enters the cache
├── presentation.ts       Labels, badge tones, schedule formatting, list views, job commands
├── jobForm.ts            Manager form: validation mirroring the API, create/update requests
├── components/           JobCard, JobStatusBadge, JobPriorityBadge
└── screens/              JobsScreen (list), JobDetailScreen, JobFormScreen, AssignWorkerScreen
```

- **The server decides what a user may do.** Every job carries `allowedActions`;
  `jobCommands()` turns exactly those into buttons ("Start job" for the assigned worker on an
  assigned job, "Complete job" once in progress; assign/edit/cancel/delete for managers). The
  app makes no role or status decision of its own, so it can never offer an action the server
  would reject.
- **Every command invalidates the job and the lists, even when it fails.** A
  `VERSION_CONFLICT` or `INVALID_STATUS_TRANSITION` means the screen shows a stale job; the
  refetch brings it up to date and the app explains what happened.
- **Responses are validated** (`queryFn` + guards); a malformed body becomes a `parse` error,
  shown by the normal error state.
- **Data sources since Phase 3.** Workers: SQLite (`WorkerJobDetail`, the worker list and
  dashboard), with commands through the local store and the outbox. Managers and admins: RTK
  Query (`ManagerJobDetail`, the manager list), online by design. The split is by role, in
  one place per screen (`JobsScreen`, `JobDetailScreen`), and shared rendering lives in
  `components/JobDetailSections.tsx`.
- **Sync status UI.** `SyncStatusBanner` (below the connectivity banner on every screen, only
  when something is unsynced or rejected), a badge per job ("Waiting to sync", "Needs
  attention"), `SyncProblemList` (reason, Dismiss, Try again) and `SyncCard` on Profile with
  "Sync now".

## Field operations (Phase 4)

```text
services/native/        codegen specs: NativeFieldOpsLocation.ts, NativeFieldOpsFiles.ts
services/location/      permission + one fix → LocationResult (locationService, locationResult)
services/files/         evidence files in app-private storage (FieldOpsFiles)
services/media/         photo capture/choice (react-native-image-picker; sole importer)
services/realtime/      RealtimeClient (socket.io-client; sole importer), envelope checks
services/push/          FCM (React Native Firebase; sole importer)
features/jobs/          outbox commands job.evidence.add, job.message.send; locations on
                        start/complete; FieldOperationSections, WorkerLocationPanel,
                        MessageComposer; schema v2 (evidence_files)
features/notifications/ inbox API + screen, notificationRouting (push data → route)
app/providers/          RealtimeConnection (resync on events/reconnect), PushNotifications
app/navigation/         navigationRef (open a job from a notification, also on cold start)
hooks/useLiveUpdates    realtime and push status for display
```

All new worker writes follow the Phase 3 write path (one SQLite transaction: outbox entry +
local view); realtime and push only trigger the existing sync. See [location.md](location.md),
[realtime.md](realtime.md), [notifications.md](notifications.md), [evidence.md](evidence.md).

## 9. Native modules (Kotlin, V7+)

**As built in Phase 4** (both Turbo Modules from specs in `src/services/native`, registered by
`FieldOpsPackage.kt`; `codegenConfig` in `package.json`):

| Module | Responsibility |
| --- | --- |
| `FieldOpsLocation` | Location enabled?, one foreground fix (LocationManager), open location settings |
| `FieldOpsFiles` | Copy a picked photo into `files/evidence`, check, delete (confined to that directory) |

`MainApplication.kt` also creates the `jobs` notification channel. The planned modules
below (`LocationTracking`, `BackgroundSync`) are not built: no workflow needs background
tracking yet, and background sync (WorkManager) remains later work.

The original plan:

| Module | Responsibility | Android APIs |
| --- | --- | --- |
| `LocationTracking` | Start or stop an on-duty foreground service, capture fixes with an adaptive interval, buffer natively, expose batches to JS, report tracking state | Foreground service, Fused Location Provider, notification channel |
| `BackgroundSync` | Schedule sync and upload attempts that survive process death, with network and battery constraints | WorkManager |
| `DeviceInfo` / permissions | Battery optimization status, background location permission flow, app standby bucket | Standard Android APIs |

Design rules:

- Each module has a **TypeScript codegen spec**, which is the contract. JavaScript code only
  uses the typed wrapper in `services/native/`.
- **Location capture never depends on JavaScript.** The service persists points natively
  (in its own small store or in the shared SQLite database; decided in V7). The JavaScript sync
  engine, or a WorkManager job, uploads them in batches and deletes them after confirmation.
- Battery awareness: sampling adapts to motion and battery level, respects Doze, and stops when
  the worker goes off duty.
- The persistent notification is always visible while tracking, which Android requires and
  which workers should be able to see anyway.

V1 contains no custom Kotlin modules. The only Kotlin change is the `MainActivity` fragment
factory that react-native-screens requires.

## 10. Networking, connectivity and environments

- **One HTTP entry point** (`services/api/baseQuery.ts`). It adds the `Authorization` header
  per request, unwraps the `{ success, data }` envelope, and on a `401` to an authenticated
  request performs one refresh shared by all concurrent requests (single flight), then retries
  once. A `4xx` from the refresh ends the session; offline or `5xx` keeps it. The base query
  reaches the credential store through the store's thunk extra argument, so tests inject an
  in-memory store.
- **Connectivity** (`services/network`): NetInfo's two facts (connected, internet reachable)
  are folded into one status: `unknown`, `checking` (connected, not yet verified), `online` or
  `offline` (including Wi-Fi without internet). It is a hint for the UI and for triggering work,
  never proof that a request will succeed.
- **Environments** (`app/config`): values come from `apps/mobile/.env.<environment>` through
  react-native-config and are validated at startup (`parseEnv`). An invalid build shows a
  configuration error screen instead of calling the wrong server. Details:
  [mobile-development.md](mobile-development.md#api-environments).
- Auth responses and restored credentials are checked at runtime (`services/auth/contracts.ts`)
  before the app trusts them. Shared runtime schemas for larger payloads arrive with sync (V6).
- WebSocket client (V8): authenticated on connect, reconnects with backoff, events validated
  against shared schemas, and events trigger sync rather than directly mutating data.

## 11. Error handling

| Failure | Handling |
| --- | --- |
| API failure (network, timeout, HTTP, unreadable response) | `createBaseQuery` maps it to an `AppError` with a user-safe `message` (the app's own copy per error `code`; never server text for `5xx`), optional `status`, `code`, field `details` and `requestId`, and logs it with `logger.warn` |
| Any error shown in the UI | `ErrorState` normalizes any value with `toAppError()`. Technical detail is logged and never shown as the message |
| Render error | `ErrorBoundary` (inside the theme provider) logs it and shows a recovery screen with "Try again" |
| Uncaught JavaScript error | `installGlobalErrorHandler()` logs it, then hands it to React Native's default handler (red box in development, crash in release). Errors are never swallowed |
| Invalid build configuration | `ConfigurationErrorScreen` lists every problem |

`utils/logger.ts` is the only console user. V15 connects it to crash reporting.

## 12. Performance (V14 focus, practiced from V1)

- Small store, narrow selectors, no large objects in Redux. The connectivity reducer returns
  the same state object when nothing changed, so listeners do not re-render.
- Static styles live in `StyleSheet.create`. Only theme-dependent values are computed per
  render. `memo` is not applied speculatively.
- Reanimated runs the connectivity banner's enter/exit animations on the UI thread.
- Virtualized lists for long collections (FlashList evaluated in V14), with stable keys and
  memoized rows.
- Heavy work stays off the JavaScript thread: image compression natively, and SQLite through a
  JSI library.
- Startup budget: the database opens, migrations run, the session is restored and the first
  screen renders from local data with no network wait.
- Profile before optimizing (React DevTools profiler, Android Studio profiler, Hermes
  sampling).

## 13. Security

- Environment configuration is **not** a security boundary. Every value in
  `apps/mobile/.env.*` is compiled into the APK. The files hold public settings only.
- Release-like builds (staging, release) block cleartext HTTP. Configuration validation also
  requires `https` outside development.
- Tokens in Keystore-backed secure storage only (V2), never in Redux, MMKV or logs. No secrets
  are bundled in the app.
- Local database encryption evaluated in V5 and enforced by V18. Certificate pinning evaluated
  in V18.
- Logs never contain tokens, passwords or personal data. Crash reports are scrubbed.
- Staging and release builds are signed with the debug keystore until V16 and are for local
  testing only.
- Photos are stored in app-private storage and stripped of unnecessary metadata before upload
  (location EXIF is replaced by explicit job-location metadata the worker can see).

## 14. Testing

| Level | Tooling | Focus | Status |
| --- | --- | --- | --- |
| Static | TypeScript (strict + FieldOps flags), ESLint | Types, hooks rules, architecture boundaries | V1 |
| Unit | Jest | Config validation, connectivity model and slice, session slice, error normalization, base query, theme resolution | V1 (55 tests) |
| Component | React Native Testing Library | Screens with realistic data states (pending, failed, offline) | When screens have real behavior (V2+) |
| Database | Jest against a real SQLite engine | Migrations, repositories, transactional outbox writes | V5 |
| E2E | Maestro (Detox as the alternative) | Critical flows: login, complete job offline, reconnect and sync | Evaluated when real flows exist (V2+) |
| Native | Kotlin unit and instrumented tests | Location buffering, WorkManager scheduling | V7 |
