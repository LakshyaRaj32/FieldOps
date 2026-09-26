# Mobile Development

How to install, run, build, configure and test the FieldOps Android app (`apps/mobile`).
For the architecture behind it, see [mobile-architecture.md](mobile-architecture.md).

## Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | 24 (see `.nvmrc`) | `node -v` |
| npm | 10+ | `npm -v` |
| JDK | 17 | `java -version` |
| Android SDK | Platform 36/37, Build-Tools 37, NDK 27.1 (Gradle downloads missing pieces) | `ANDROID_HOME` is set |
| adb | from Android SDK platform-tools | `adb --version` |
| Android phone | USB debugging enabled | `adb devices` lists it as `device` |

An emulator is not required. The physical phone is the primary test device.

## Install dependencies

From the **repository root** (npm workspaces install everything and link the workspace
packages):

```bash
npm install
```

Do not run `npm install` inside `apps/mobile`. Dependencies are hoisted to the root
`node_modules`, and the Gradle and Metro configuration expect that.

## Project structure (short version)

```text
apps/mobile/
├── android/            Native Android project (Kotlin, Gradle)
├── src/
│   ├── app/            App shell: config, navigation, providers
│   ├── components/     ui/ primitives and common/ composites
│   ├── features/       auth, dashboard, jobs, notifications, profile
│   ├── hooks/          Cross-feature hooks
│   ├── services/       api (RTK Query), network (NetInfo), storage (MMKV)
│   ├── store/          Redux store and slices
│   ├── theme/          Tokens, light/dark themes
│   └── utils/          Errors, logger, global error handler
├── .env.example        Environment template (documents every key)
├── .env.development    Development environment (committed; public values only)
├── index.js            Entry point
├── metro.config.js     Monorepo-aware Metro configuration
├── eslint.config.js    Lint rules, including architecture boundaries
└── jest.config.js      Test configuration
```

Folder responsibilities and import rules: [mobile-architecture.md, section 3](mobile-architecture.md#3-source-layout).

## Run on the physical phone

1. Connect the phone by USB and confirm it is authorized:

   ```bash
   adb devices
   # 2cc8dd70   device      <- "unauthorized" means: accept the prompt on the phone
   ```

2. Start Metro in one terminal:

   ```bash
   npm run mobile:start          # from the repo root
   # or, inside apps/mobile:  npm start
   # after changing .env files, babel.config.js or dependencies:  npm run start:reset -w @fieldops/mobile
   ```

3. Build, install and launch in a second terminal:

   ```bash
   npm run mobile:android        # from the repo root
   # or, inside apps/mobile:
   npx react-native run-android
   ```

   `npm run mobile:android` runs `react-native run-android --active-arch-only`, which compiles
   native code only for the connected phone's CPU (arm64-v8a) instead of all four Android ABIs.
   The first build compiles C++ for Reanimated, MMKV and Nitro, so it takes noticeably longer
   than later builds. The plain `npx react-native run-android` also works, but builds every ABI.

   The CLI runs `adb reverse tcp:8081 tcp:8081` so the phone can reach Metro over USB. If the
   app shows "Unable to load script", run it yourself and reload:

   ```bash
   adb reverse tcp:8081 tcp:8081
   ```

4. Developer menu on a physical phone: shake the device, or run
   `adb shell input keyevent 82`. Press `r` in the Metro terminal to reload.

## Build Android APKs

Run from `apps/mobile/android` (use `gradlew.bat` in cmd or PowerShell, `./gradlew` in Git Bash):

| Command | Build type | Environment file | Output |
| --- | --- | --- | --- |
| `gradlew assembleDebug` | debug (needs Metro) | `.env.development` | `app/build/outputs/apk/debug/app-debug.apk` |
| `gradlew assembleStaging` | staging (JS bundled) | `.env.staging` | `app/build/outputs/apk/staging/app-staging.apk` |
| `gradlew assembleRelease` | release (JS bundled) | `.env.production` | `app/build/outputs/apk/release/app-release.apk` |

Add `-PreactNativeArchitectures=arm64-v8a` to build faster for the phone only. Install an APK
with `adb install -r <path>`.

- Staging installs as **FieldOps Staging** (`com.fieldops.mobile.staging`) next to the debug
  build, which appears as **FieldOps Dev**.
- `.env.staging` and `.env.production` do not exist yet, because there is no staging or
  production API. Those builds fail immediately with a clear message until the files are
  created (copy `.env.example`).
- Staging and release builds are signed with the **debug keystore** until Version 16. They are
  for local testing only and must not be distributed.

## API environments

### How it works

Each build type reads one dotenv file from `apps/mobile/` through **react-native-config**.
The values are compiled into the APK and validated when the app starts
(`src/app/config/env.ts`).

| Key | Required | Rules |
| --- | --- | --- |
| `APP_ENV` | yes | `development`, `staging` or `production` |
| `API_BASE_URL` | yes | API origin, no trailing slash, no `/api/v1`. Must be `https://` in staging and production |
| `API_TIMEOUT_MS` | no | Integer from 1000 to 120000. Default 15000 |

If a value is invalid, the app shows a **Configuration error** screen that lists every problem,
instead of starting against the wrong server.

Code never reads URLs directly. Requests go through the RTK Query API layer, which takes the
base URL from the validated configuration. Business endpoints live under `API_V1`
(`/api/v1`). Health checks live at the root (`/health/live`).

### Local API on a USB-connected phone

`.env.development` uses `API_BASE_URL=http://localhost:3000`. When the local API exists
(Version 3), forward the phone's port 3000 to your computer:

```bash
adb reverse tcp:3000 tcp:3000
```

This works on any network and needs no IP address. Repeat it after reconnecting the phone.
Alternatively, set your computer's LAN IP (`http://192.168.x.y:3000`) in `.env.development`.
Plain HTTP is allowed only in debug builds.

Until the backend exists, **Profile → Diagnostics → Check API connection** correctly reports
"API not reachable".

### Switching to staging without code changes

- **Staging build:** create `.env.staging` (copy `.env.example`, set `APP_ENV=staging` and the
  `https://` staging URL), then build `assembleStaging`.
- **Debug build pointed at staging** (hot reload against the real staging API): override the
  env file for one build with `ENVFILE`:

  ```powershell
  # PowerShell
  $env:ENVFILE = ".env.staging"; npx react-native run-android; Remove-Item Env:ENVFILE
  ```

  ```bash
  # Git Bash
  ENVFILE=.env.staging npx react-native run-android
  ```

Values are compiled into the APK, so **rebuild the app** after changing an env file. Reloading
JavaScript is not enough.

### Security rules

- Environment configuration is **not** a security boundary. Anyone with the APK can read every
  value. **Never** put API keys, credentials, signing passwords or server secrets in these files.
- The mobile env files are committed on purpose (public settings only). The root `.gitignore`
  allows exactly `apps/mobile/.env.development`, `.env.staging` and `.env.production`, and
  keeps ignoring every other `.env*` file in the repository.

## Testing and quality checks

Run from the repo root (all workspaces) or inside `apps/mobile`:

| Command (root) | Inside `apps/mobile` | What it does |
| --- | --- | --- |
| `npm run typecheck` | `npm run typecheck` | Strict TypeScript check (`tsc --noEmit`) |
| `npm run lint` | `npm run lint` | ESLint: React Native rules, hooks rules and architecture boundaries |
| `npm test` | `npm test` | Jest unit tests |
| — | `npm run format:check` / `npm run format` | Prettier check / fix |

**What is tested:** environment validation, connectivity, session state and sign-out, error
normalization, the HTTP base query (V1–V2); job presentation rules, the job form and the job API
client (Phase 2); SQLite migrations, the local job store (persistence across restarts,
atomicity), the projection, the retry policy and the sync engine with fault injection (Phase 3).
Tests sit next to the code as `*.test.ts`.

**SQLite in tests.** Data-layer tests run against Node's built-in SQLite
(`src/testing/nodeSqliteDatabase.ts`), so they exercise real SQL and transactions. They need
`@jest-environment node` at the top of the file. `src/testing/fakeJobServer.ts` implements the
API's rules for worker commands (state machine, assignment, idempotency) with fault injection:
network down, lost responses, HTTP errors.

**Live offline sync test (against the real API).** `src/features/jobs/data/liveSync.test.ts`
runs the app's data layer against a running API and database. It is skipped by default. To
run it against the test database:

```bash
# terminal 1 (apps/api): the compiled API on port 3000 against fieldops_test
npm run build
APP_ENV=development PORT=3000 \
DATABASE_URL=postgresql://fieldops:fieldops@localhost:5432/fieldops_test \
JWT_ACCESS_SECRET=e2e-access-secret-0123456789abcdefghijklmnop \
JWT_REFRESH_SECRET=e2e-refresh-secret-0123456789abcdefghijklmno \
node dist/main.js

# terminal 2 (apps/mobile)
FIELDOPS_LIVE_API=1 \
FIELDOPS_LIVE_DATABASE_URL=postgresql://fieldops:fieldops@localhost:5432/fieldops_test \
npx jest src/features/jobs/data/liveSync.test.ts
```

**Writing tests:**

- Test behavior through pure functions and reducers where possible. Native modules do not exist
  in Jest.
- `jest.setup.js` replaces `react-native-config` with development values. Add a mock there only
  when a native import is unavoidable.
- `createAppStore()` gives each test its own Redux store.
- Do not add tests that only raise coverage.

**Lint boundaries to know about:**

- Import `react-native-config` only in `src/app/config`, NetInfo only in `src/services/network`,
  MMKV and Keychain only in `src/services/storage`, and `react-native-nitro-sqlite` only in
  `src/services/db`.
- The global `fetch` is not allowed. Add an RTK Query endpoint with `baseApi.injectEndpoints()`.
- `console` is not allowed. Use `logger` from `src/utils/logger.ts`.

## Run against the local API

The app talks to the real API from Version 2. Start the backend first
([backend-development.md](backend-development.md)):

```bash
npm run api:dev          # terminal 1: API on http://localhost:3000
npm run mobile:reverse   # forward the phone's ports 3000 (API) and 8081 (Metro) over USB
npm run mobile:start     # terminal 2: Metro
npm run mobile:android   # terminal 3: build and install (after native dependency changes)
```

`npm run mobile:android` is required once after pulling Version 2, because it adds a native
module (`react-native-keychain`). Afterwards, JavaScript changes only need Metro.

## Manual test checklist (Version 2)

Run these on the physical phone with the API running and `adb reverse` active:

1. **Launch.** The app shows "Starting FieldOps…" briefly, then the sign-in screen with a
   "development build" badge. There is no development entry anymore.
2. **Validation.** Tap **Sign in** with empty fields: inline messages appear under Email and
   Password, and no request is sent. Register with a 5-character password: "Use at least 8
   characters."
3. **Register.** **Create an account** → fill in the form → **Create account**. The main tabs
   appear; the dashboard greets you by first name with a WORKER badge.
4. **Profile.** Profile shows your name, email, WORKER role and "Member since".
5. **Duplicate email.** Sign out, register again with the same email (any capitalization):
   "An account with this email already exists."
6. **Wrong password.** Sign in with a wrong password: "Incorrect email or password."
7. **Login.** Sign in with the correct password: the tabs appear.
8. **Restart.** Close the app completely (swipe it away) and reopen it: it opens signed in,
   without the sign-in screen.
9. **Offline start.** Enable airplane mode, close and reopen the app: it still opens signed in,
   with the offline banner. Disable airplane mode.
10. **Token refresh.** Set `ACCESS_TOKEN_EXPIRATION=1m` in `apps/api/.env` and restart the API.
    Sign in, wait over a minute, then tap **Check API connection** or reopen the app. It keeps
    working: the API log shows `POST /api/v1/auth/refresh 200` followed by the retried request.
    Restore `15m` afterwards.
11. **Session ended by the server.** Sign in, then revoke the session in the database (or
    replay an old refresh token from Postman): the next authenticated request returns the app to
    the sign-in screen with "Your session has ended."
12. **Logout.** Profile → **Sign out**: the sign-in screen appears. The Android back button
    does not return to the tabs. Reopening the app shows the sign-in screen. In the database,
    that session has `revoked_reason = LOGOUT`.
13. **Server unreachable.** Stop the API and try to sign in: "Can't reach the FieldOps server."
14. **V1 features.** Tabs, connectivity banner, theme switching (and persistence), diagnostics
    (**Check API connection** now succeeds) and **Simulate render error** behave as in
    Version 1.

## Offline demo on the phone (Phase 3)

Needs a manager and a worker account (grant the role with
`npm run user:set-role -w @fieldops/api -- <email> MANAGER`), the API running and
`npm run mobile:reverse`. Use a second device, Swagger or Postman for the manager.

1. **Online download.** Sign in on the phone as the worker. The manager creates a job and
   assigns it to the worker. On the phone, pull down on Jobs: the job appears.
2. **Go offline.** Turn on airplane mode (or stop the API: the app cannot tell the
   difference, which is the point). The offline banner appears.
3. **Restart offline.** Swipe the app away and reopen it: signed in, the job is there.
4. **Work offline.** Open the job → **Start job** (instant, "Waiting to sync"), add a note,
   **Complete job**. The sync banner says the changes are saved on the phone.
5. **Force close** and reopen: the job still shows *Completed*, with 3 changes waiting
   (Profile › Offline sync).
6. **Reconnect.** Turn airplane mode off. Within seconds the banner goes away (or tap
   **Sync now**). The manager sees the job *Completed* with the note and one Started and one
   Completed entry in the history.
7. **Conflict.** Assign a second job, go offline, start it on the phone, and cancel it as the
   manager. Reconnect: the phone shows *Cancelled* and "“Start job” on … was not applied: the
   job changed while you were offline." Dismiss it.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Port 8081 already in use` | Another Metro is running. Close it, or find it with `netstat -ano \| findstr :8081` and end that process |
| App shows old code or env values | Rebuild after `.env` changes. Restart Metro with `npm run start:reset -w @fieldops/mobile` |
| "Unable to load script" on the phone | `adb reverse tcp:8081 tcp:8081`, then reload |
| Build fails with `Missing apps/mobile/.env.<name>` | Create that file from `.env.example` (expected for staging and release until those APIs exist) |
| CMake/Ninja errors mentioning path length | Windows long paths are disabled on this machine (`LongPathsEnabled = 0`). Enable long paths in Windows (admin) and `git config --system core.longpaths true`, or keep the repo path short |
| `adb devices` shows `unauthorized` | Unlock the phone and accept the USB debugging prompt |
| Gradle is slow or stuck after dependency changes | `cd apps/mobile/android && gradlew clean`, then rebuild. `gradlew --stop` stops the daemons |
| Configuration error screen on launch | Fix the listed keys in the env file for that build type, then rebuild |

## Version workflow

Every version follows the same steps: implement → typecheck → lint → test → build → test on the
phone → commit → push → (deploy and test against staging, once it exists) → document → stop.
