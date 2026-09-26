# apps/api (reserved)

The FieldOps backend: a **NestJS modular monolith** written in TypeScript and backed by
PostgreSQL (through Prisma) and Redis.

**Status:** reserved. The project will be generated in **Version 3** with the official Nest CLI
and then adapted to the monorepo (shared tsconfig, workspace packages).

## Planned stack

Node.js · NestJS · TypeScript (strict) · PostgreSQL · Prisma · Redis · BullMQ · WebSockets
(Socket.IO through Nest gateways) · JWT · RBAC with resource policies · Swagger/OpenAPI

## Process model

One codebase, two entrypoints:

| Process | Entrypoint | Responsibility |
| --- | --- | --- |
| `api` | `src/main.ts` | HTTP (REST under `/api/v1`) and WebSocket gateway |
| `worker` | `src/worker.ts` (V12) | BullMQ consumers: notifications, media processing, AI jobs, maintenance |

## Planned source layout

```text
apps/api/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── common/              Cross-cutting infrastructure (config, errors, logging, guards)
    └── modules/
        ├── auth/            V2
        ├── users/           V2–V3
        ├── organizations/   V3
        ├── jobs/            V4
        ├── sync/            V6
        ├── locations/       V7
        ├── messaging/       V8
        ├── notifications/   V9
        ├── files/           V9
        ├── audit/           V4+
        ├── analytics/       later
        └── ai/              V17
```

Modules are created in the version that needs them, never earlier.

See [docs/backend-architecture.md](../../docs/backend-architecture.md) for the full design.
