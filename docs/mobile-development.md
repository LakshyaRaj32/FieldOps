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

**What is tested (V1):** environment validation, the connectivity status model and slice
transitions, session state and sign-out cache reset, error normalization, the HTTP base query
(headers, error mapping, config failures) and theme resolution. Tests sit next to the code as
`*.test.ts`.

**Writing tests:**

- Test behavior through pure functions and reducers where possible. Native modules do not exist
  in Jest.
- `jest.setup.js` replaces `react-native-config` with development values. Add a mock there only
  when a native import is unavoidable.
- `createAppStore()` gives each test its own Redux store.
- Do not add tests that only raise coverage.

**Lint boundaries to know about:**

- Import `react-native-config` only in `src/app/config`, NetInfo only in `src/services/network`,
  and MMKV only in `src/services/storage`.
- The global `fetch` is not allowed. Add an RTK Query endpoint with `baseApi.injectEndpoints()`.
- `console` is not allowed. Use `logger` from `src/utils/logger.ts`.

## Manual test checklist (Version 1)

Run these on the physical phone after `npm run mobile:android`:

1. **Launch.** The app opens as **FieldOps Dev** with no red error screen. The login screen
   shows "FieldOps", a "Sign in" card and a "development build" badge.
2. **Development entry.** Tap **Continue as Worker**. The tabs Dashboard, Jobs, Notifications
   and Profile appear. The dashboard greets "Dev Worker" with a WORKER badge.
3. **Tabs.** Switch between all four tabs. Jobs and Notifications show their empty states.
   On the Dashboard, **Open Jobs** switches to the Jobs tab.
4. **Connectivity.** Turn on airplane mode: the "You're offline" banner appears under the
   header, and the dashboard's Connection badge shows Offline. Turn airplane mode off:
   "Reconnecting…" may appear briefly, then "Back online" for about 2.5 seconds, then the banner
   disappears.
5. **Wi-Fi without internet (optional).** On a network with no internet access the app should
   report Offline, not Online.
6. **Theme.** Profile → Appearance: choose Dark, then Light, then System. Colors, headers and the
   tab bar follow. Close the app completely and reopen it: the choice persists.
7. **Diagnostics.** Profile → Diagnostics shows Environment `development` and API base URL
   `http://localhost:3000`. **Check API connection** shows a loading state and then
   "API not reachable" with a reference ID (correct, because there is no backend until V3).
8. **Error boundary.** Profile → **Simulate render error** shows the "Something went wrong"
   screen. In development a LogBox notice also appears. **Try again** returns to the app.
9. **Sign out.** Profile → **Sign out** returns to the login screen. The Android back button
   does not return to the tabs.
10. **Other roles.** Sign in as Manager and as Admin. The dashboard copy changes to "Team's jobs".
11. **Dark mode from the OS.** With Appearance set to System, switch the phone's dark mode.
    The app follows.

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
