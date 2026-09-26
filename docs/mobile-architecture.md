# Mobile Architecture

> Status: **Version 1 implemented** (foundation: project, navigation, state, connectivity, API
> layer, environments, UI foundation, error handling). Later layers arrive in V2 (auth),
> V5 (SQLite), V6 (sync), V7 (Kotlin location), V8 (realtime), V9 (push and media) and V14
> (performance). How to run and develop the app: [mobile-development.md](mobile-development.md).

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
├── components/
│   ├── ui/                     Primitives: AppText, Button, Card, Badge, Screen, SegmentedControl
│   └── common/                 App-aware composites: Loading/Error/Empty states, ErrorBoundary, ConnectivityBanner
├── features/                   Vertical slices; each owns its screens and feature-local components
│   ├── auth/                   Login (V1 placeholder with development entry; real sign-in in V2)
│   ├── dashboard/              Dashboard tab
│   ├── jobs/                   Jobs tab (placeholder until V4)
│   ├── notifications/          Notifications tab (placeholder until V9)
│   └── profile/                Account, theme preference, diagnostics
├── hooks/                      Cross-feature hooks (useConnectivity)
├── services/                   Infrastructure wrappers; the only code allowed to touch these libraries
│   ├── api/                    RTK Query base API, base query, request IDs, RTK Query listeners, health endpoint
│   ├── network/                Connectivity model (pure) and NetInfo service
│   └── storage/                MMKV preferences storage with typed keys
├── store/                      Redux store, typed hooks
│   └── slices/                 Application-wide slices: session, connectivity
├── theme/                      Tokens, light/dark themes, ThemeProvider, theme preference
└── utils/                      Error model, logger, global error handler
```

**Growth plan.** New infrastructure goes into `services/` (for example `services/db` in V5,
`services/sync` in V6, `services/native` in V7, `services/realtime` in V8, and secure token
storage in `services/storage` in V2). Feature data access goes into `features/<feature>/api`
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
  only in `services/network`, MMKV only in `services/storage`. The global `fetch` is forbidden
  in app code (use the API layer), and `console` is forbidden outside `utils/logger.ts`.
- Screens are thin: they compose hooks and components.

## 4. The six kinds of state

| # | Kind | Owner | Examples | Must not | V1 status |
| --- | --- | --- | --- | --- | --- |
| 1 | UI state | Component state; Redux slices when shared across screens | Form inputs, open sheets, selected filter | Hold domain entities as truth | Component state only |
| 2 | Server state (online-only) | RTK Query | Manager dashboard, worker list, admin screens | Be used for offline-critical data | Base API + health check |
| 3 | Persistent local application data | SQLite | Assigned jobs, job events, attachment metadata, messages | Be mirrored wholesale into Redux | V5 |
| 4 | Offline mutations | SQLite outbox (same DB, same transaction as the domain write) | `job.complete`, `job.note.add` | Live anywhere in-memory-only | V5–V6 |
| 5 | Synchronization state | SQLite (truth); Redux mirror for display | Cursor, pending count, failures | Be lost on restart | V6 |
| 6 | Native device capabilities | Kotlin modules and native buffers | Location capture, background scheduling | Depend on the JS thread being alive | V7 |

Two additional stores exist for specific purposes:

- **MMKV:** small key-value preferences and flags, typed keys only. V1 stores the theme
  preference (`ui.themePreference`).
- **Keystore-backed secure storage:** tokens and credentials only (V2).

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

In V1 only the Redux and RTK Query paths exist.

## 6. SQLite access layer (V5)

- **One database connection** managed by `services/db`, opened and migrated during startup
  before any screen renders data.
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

**Slices implemented in V1** (`src/store/slices`):

| Slice | Contents |
| --- | --- |
| `session` | Discriminated union: `signedOut`, or `signedIn` with `{ displayName, role }` and `source: 'development'`. V2 replaces the development source with real sessions. Tokens will never be stored here |
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
    ├── Jobs
    ├── Notifications
    └── Profile
```

- Exactly one of `Auth` or `App` is mounted, chosen from session state. Signing out unmounts
  every authenticated screen, so back navigation cannot return to it.
- Both navigators use `screenLayout` to render the connectivity banner below the header on
  every screen.
- Param lists are typed (`app/navigation/types.ts`) and registered globally, so
  `useNavigation()` is type-checked.
- V2 adds Register/ForgotPassword to `AuthNavigator` if needed.

**Planned evolution (V4+):** role-specific tabs, for example:

```text
WorkerTabs  (WORKER)            Today / Jobs → JobDetail → Capture, Messages, Profile
ManagerTabs (MANAGER | ADMIN)   Dashboard, Jobs → JobDetail → Assign, Map, Messages, Admin (ADMIN)
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

- **One HTTP entry point** (`services/api/baseQuery.ts`). V2 adds the Authorization header and
  single-flight token refresh on `401` there.
- **Connectivity** (`services/network`): NetInfo's two facts (connected, internet reachable)
  are folded into one status: `unknown`, `checking` (connected, not yet verified), `online` or
  `offline` (including Wi-Fi without internet). It is a hint for the UI and for triggering work,
  never proof that a request will succeed.
- **Environments** (`app/config`): values come from `apps/mobile/.env.<environment>` through
  react-native-config and are validated at startup (`parseEnv`). An invalid build shows a
  configuration error screen instead of calling the wrong server. Details:
  [mobile-development.md](mobile-development.md#api-environments).
- Responses from the future backend will be validated at runtime with shared schemas (V3–V4).
- WebSocket client (V8): authenticated on connect, reconnects with backoff, events validated
  against shared schemas, and events trigger sync rather than directly mutating data.

## 11. Error handling

| Failure | Handling |
| --- | --- |
| API failure (network, timeout, HTTP, unreadable response) | `createBaseQuery` maps it to an `AppError` with a user-safe `message`, optional `status`, Problem Details `code` and `requestId`, and logs it with `logger.warn` |
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
- Tokens in Keystore-backed secure storage only (V2). No secrets are bundled in the app.
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
