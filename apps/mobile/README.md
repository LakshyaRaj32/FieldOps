# @fieldops/mobile

The FieldOps React Native application for Android. It serves both field workers and managers.

**Status:** Version 1 foundation. The app contains navigation, state management, the API layer,
connectivity, environment configuration, the UI and theme foundation, and error handling.
Features arrive in later versions (auth in V2, jobs in V4, offline storage in V5, sync in V6,
and so on).

## Quick start

From the repository root, with the phone connected over USB:

```bash
npm install              # once, from the root (never inside apps/mobile)
npm run mobile:start     # terminal 1: Metro
npm run mobile:android   # terminal 2: build, install, launch
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
Redux Toolkit + RTK Query · react-native-config · MMKV · NetInfo · Reanimated 4

## Layout

```text
apps/mobile/
├── android/        Native Android project (Kotlin, Gradle); build types debug / staging / release
├── src/
│   ├── app/        config/, navigation/, providers/, App.tsx
│   ├── components/ ui/ primitives, common/ composites
│   ├── features/   auth, dashboard, jobs, notifications, profile
│   ├── hooks/      cross-feature hooks
│   ├── services/   api/ (RTK Query), network/ (NetInfo), storage/ (MMKV)
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
