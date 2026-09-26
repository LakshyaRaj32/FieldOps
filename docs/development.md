# Development Guide

How to set up, work in and contribute to the FieldOps repository.

## Prerequisites

| Tool | Version | Needed from |
| --- | --- | --- |
| Node.js | 24 LTS (see `.nvmrc`) | V0 |
| npm | 10+ (bundled with Node) | V0 |
| Git | 2.39+ | V0 |
| JDK | 17 (the version React Native requires for Android builds) | V1 |
| Android Studio, Android SDK, emulator | Current stable | V1 |
| Docker Desktop (or Docker Engine with Compose v2) | Current stable | V3 |

Use a Node version manager (`nvm`, `fnm`, or `nvm-windows`) so the `.nvmrc` version is used.

## First-time setup

```bash
git clone <repository-url> FieldOps
cd FieldOps
npm install        # installs the workspace toolchain and links workspace packages
npm run typecheck  # type-checks every workspace that defines a typecheck script
```

## Repository layout

```text
apps/mobile      React Native app (generated in V1)
apps/api         NestJS API (generated in V3)
packages/config  Shared tooling config (tsconfig base)
packages/types   Shared domain types (Role, ...)
packages/shared  Reserved for shared runtime code (schemas, state machines, sync protocol)
infra/docker     Local infrastructure (Compose from V3)
docs/            Architecture and decisions
```

## Root scripts

| Script | What it does |
| --- | --- |
| `npm run typecheck` | Runs `typecheck` in every workspace that defines it |

More scripts (`lint`, `test`, `format`, `dev:api`, `android`) are added in the version that
introduces the tooling they run.

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
- **Short project path.** Keep the repository near a drive root (for example `L:\FieldOps`) to
  stay well within Gradle and CMake path limits.
- **Android emulator networking.** The emulator reaches the host machine at `10.0.2.2`.
- **Shells.** Scripts in `package.json` must work in both PowerShell and POSIX shells. Avoid
  shell-specific syntax.

## Documentation

Start with [architecture.md](architecture.md). The full index is in the root
[README.md](../README.md#documentation). Documentation changes are part of the same change as
the code they describe.
