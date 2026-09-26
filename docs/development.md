# Development Guide

How to set up, work in and contribute to the FieldOps repository.

## Prerequisites

| Tool | Version | Needed from |
| --- | --- | --- |
| Node.js | 24 LTS (see `.nvmrc`) | V0 |
| npm | 11 (bundled with Node 24) | V0 |
| Git | 2.39+ | V0 |
| JDK | 17 (the version React Native requires for Android builds) | V1 |
| Android SDK + platform-tools (adb), Android Studio optional | Current stable, `ANDROID_HOME` set | V1 |
| Android phone with USB debugging (an emulator is optional) | Android 7+ (minSdk 24) | V1 |
| PostgreSQL | 18 (native install; see [backend-development.md](backend-development.md#1-postgresql)) | V2 |
| Docker Desktop (or Docker Engine with Compose v2) | Current stable | Later (deferred) |

Use a Node version manager (`nvm`, `fnm`, or `nvm-windows`) so the `.nvmrc` version is used.

## First-time setup

```bash
git clone <repository-url> FieldOps
cd FieldOps
npm install        # installs the workspace toolchain and links workspace packages
npm run typecheck  # type-checks every workspace that defines a typecheck script
npm run lint
npm test
```

Running the API: [backend-development.md](backend-development.md). Running the Android app:
[mobile-development.md](mobile-development.md).

## Repository layout

```text
apps/mobile      React Native app (foundation built in V1)
apps/api         NestJS API (foundation and auth in V2)
packages/config  Shared tooling config (tsconfig base)
packages/types   Shared domain and API contract types (Role, envelope, auth)
packages/shared  Reserved for shared runtime code (schemas, state machines, sync protocol)
infra/docker     Local infrastructure (Compose, later)
docs/            Architecture and decisions
```

## Root scripts

| Script | What it does |
| --- | --- |
| `npm run typecheck` | Runs `typecheck` in every workspace that defines it |
| `npm run lint` | Runs `lint` in every workspace that defines it |
| `npm test` | Runs `test` in every workspace that defines it |
| `npm run api:dev` | Starts the API in watch mode |
| `npm run api:build` / `npm run api:start` | Compiles the API / runs the compiled API |
| `npm run api:test:e2e` | API end-to-end tests against `fieldops_test` |
| `npm run db:migrate` / `npm run db:deploy` | Create and apply a migration (dev) / apply committed migrations |
| `npm run mobile:start` | Starts Metro for the mobile app |
| `npm run mobile:android` | Builds, installs and launches the debug app on the connected phone (active ABI only) |
| `npm run mobile:reverse` | `adb reverse` for the API (3000) and Metro (8081) |

Scripts are added in the version that introduces the tooling they run.

**Root-level dev dependencies.** `typescript` and `eslint` are declared at the root so npm
installs exactly one version of each for every workspace (see
[technology-decisions.md](technology-decisions.md#mobile-quality-tooling)).

## Working with workspaces

- Run a script in one workspace: `npm run <script> -w @fieldops/types`
- Add a dependency to one workspace: `npm install <pkg> -w <workspace-name>`
- Add a dev tool used across the repo: `npm install -D <pkg>` at the root
- Workspace packages depend on each other with `"@fieldops/<name>": "*"`. npm links them
  locally.

**Adding a new package** (only when there is real code for it):

1. Create `packages/<name>/package.json` with `"name": "@fieldops/<name>"` and
   `"private": true`.
2. Add `tsconfig.json` extending `@fieldops/config/tsconfig.base.json`.
3. Add a `typecheck` script and a `README.md` stating the package's purpose and rules.
4. Run `npm install` at the root to link it.

## Git workflow

- Default branch: `main`. It is always green.
- Version work: `v<N>/<short-description>` (for example `v1/react-native-foundation`).
- Commits follow Conventional Commits (`feat(mobile): add role-based navigator`).
- Every completed version is merged, then tagged (`v0.1.0` for Version 1, and so on).

## Windows notes

The primary development machine runs Windows. To avoid common problems:

- **Line endings.** `.gitattributes` enforces LF (and CRLF for `.bat`/`.cmd`/`.ps1`). If Git
  warns about CRLF, run `git config core.autocrlf false` for this repository and let
  `.gitattributes` decide.
- **Long paths.** Android and `node_modules` paths can exceed 260 characters. Enable them with
  `git config --system core.longpaths true` (as administrator) and Windows long path support.
- **Short project path.** Keep the repository near a drive root (it lives at
  `L:\Projects\FieldOps`) to stay well within Gradle and CMake path limits. The native C++
  builds (Reanimated, MMKV, Nitro) are the most sensitive to long paths.
- **Android emulator networking.** The emulator reaches the host machine at `10.0.2.2`.
- **Shells.** Scripts in `package.json` must work in both PowerShell and POSIX shells. Avoid
  shell-specific syntax.

## Documentation

Start with [architecture.md](architecture.md). The full index is in the root
[README.md](../README.md#documentation). Documentation changes are part of the same change as
the code they describe.
