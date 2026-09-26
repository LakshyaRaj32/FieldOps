# @fieldops/types

Shared TypeScript types that describe the FieldOps domain. The mobile app (`apps/mobile`)
and the API (`apps/api`) both use them.

## Current contents (Version 0)

| Export | Description |
| --- | --- |
| `Role` | The role vocabulary: `WORKER`, `MANAGER`, `ADMIN`. It is both a runtime constant object and a type. |

## Rules

- **Types and constant vocabularies only.** There is no business logic, I/O or runtime
  dependencies here. Anything with runtime behavior belongs in `@fieldops/shared`.
- **No framework imports.** Nothing from React, React Native, NestJS or Prisma. This package
  must compile on its own.
- **Types do not validate.** A TypeScript type says nothing about data received over the
  network. Data crossing a boundary (HTTP, WebSocket, SQLite, push payloads) must be checked
  at runtime by a schema. Those schemas will live in `@fieldops/shared` (decision recorded in
  Version 3).
- The Prisma schema is the source of truth for **database** shapes. This package holds
  **API/domain contract** shapes. They are related but deliberately separate, so storage
  details do not leak into the API.

## Consumption

For now the package is consumed as TypeScript source (`main`/`types` point to `src/index.ts`).
Metro (React Native) handles that directly. When the NestJS API starts using it in Version 3,
we will decide between compiling the package with `tsc` and letting the API's build include
it. The decision goes in `docs/technology-decisions.md`.
