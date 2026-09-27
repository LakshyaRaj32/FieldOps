# infra/docker (reserved)

Docker assets for local development and, later, for building production images.

**Status:** reserved. There are no Compose files or Dockerfiles yet.

Version 2 introduced the first infrastructure dependency (PostgreSQL). By decision of the
repository owner, local development uses a **native PostgreSQL 18 install** for now instead of
Docker ([docs/backend-development.md](../../docs/backend-development.md#1-postgresql)). The API
already reads everything from the environment, so moving PostgreSQL into Compose later needs no
code changes.

## Plan

| Version | Addition |
| --- | --- |
| Later (when adopted) | `compose.yaml` with **PostgreSQL 18** for local development (named volume, healthcheck, `.env.example`), replacing the native install |
| V9 | S3-compatible object storage (MinIO) for local file/media development |
| V10 | **Redis** service |
| V15 | Optional local observability stack (OpenTelemetry Collector, Prometheus, Grafana) as a separate Compose profile |
| V16 | Multi-stage `Dockerfile` for the API/worker image; CI builds and scans it |

## Rules

- Local infrastructure runs in Docker. Application code can run on the host during
  development for fast reloads.
- No real credentials in Compose files. They read from `.env`, which is gitignored and
  documented by `.env.example`.
- Pin image versions (for example `postgres:18`). Never use `latest`.
- No Kubernetes, Helm or service mesh. See [docs/devops.md](../../docs/devops.md).
