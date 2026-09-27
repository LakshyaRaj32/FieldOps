# @fieldops/mobile

The FieldOps React Native application for Android. It serves both field workers and managers.

**Status:** Phase 2 (Core Product). On top of the Phase 1 foundation (navigation, state
management, the API layer, connectivity, environment configuration, UI and theme, error
handling, real authentication with Keystore-backed tokens, session restore and refresh), the
app has jobs (Phase 2) and works offline for workers (Phase 3): jobs are kept in SQLite,
start / complete / field notes work without a connection and survive restarts, and a sync
engine delivers them exactly once when the connection returns. Managers create, edit and
assign jobs online ([phase status](../../docs/phase-status.md),
[offline-first](../../docs/offline-first.md)).

## Quick start

From the repository root, with the phone connected over USB:

```bash
npm install              # once, from the root (never inside apps/mobile)
npm run api:dev          # terminal 1: the API (see docs/backend-development.md)
npm run mobile:reverse   # forward ports 3000 (API) and 8081 (Metro) to the phone
npm run mobile:start     # terminal 2: Metro
npm run mobile:android   # terminal 3: build, install, launch
```

## Scripts (run inside `apps/mobile`, or from the root with `-w @fieldops/mobile`)

| Script | What it does |
| --- | --- |
| `npm start` / `npm run start:reset` | Metro / Metro with a clean cache |
| `npm run android` | Debug build for the connected device's CPU only, then install and launch |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | ESLint (including architecture boundaries) |
| `npm test` | Jest unit tests |
| `npm run format` / `npm run format:check` | Prettier |

## Stack

React Native 0.87 (New Architecture, Hermes) · TypeScript (strict) · React Navigation 7 ·
Redux Toolkit + RTK Query · react-native-config · MMKV · react-native-keychain · NetInfo ·
Reanimated 4 · Ionicons (`@react-native-vector-icons/ionicons`) · native date/time pickers
(`@react-native-community/datetimepicker`)

The UI is built from the design system in `src/theme` and `src/components/ui`; see
[phase status › UI/UX improvement](../../docs/phase-status.md#uiux-improvement-phase).

## Layout

```text
apps/mobile/
├── android/        Native Android project (Kotlin, Gradle); build types debug / staging / release
├── src/
│   ├── app/        config/, navigation/, providers/, App.tsx
│   ├── components/ ui/ primitives, common/ composites
│   ├── features/   auth, dashboard, jobs, notifications, profile
│   ├── hooks/      cross-feature hooks
│   ├── services/   api/ (RTK Query, refresh), auth/ (credential store), network/ (NetInfo),
│   │               storage/ (MMKV, Keystore secure storage)
│   ├── store/      Redux store, slices/
│   ├── theme/      tokens, light/dark themes
│   └── utils/      errors, logger, global error handler
└── .env.*          Per-build-type public configuration (see .env.example)
```

## Documentation

- [docs/mobile-development.md](../../docs/mobile-development.md): running, building, API
  environments, testing, troubleshooting
- [docs/mobile-architecture.md](../../docs/mobile-architecture.md): architecture, state
  ownership, import rules
