# infra/docker (reserved)

Docker assets for local development and, later, for building production images.

**Status:** reserved. There are no Compose files or Dockerfiles yet, because nothing needs to
run yet.

## Plan

| Version | Addition |
| --- | --- |
| V3 | `compose.yaml` with **PostgreSQL** for local development (named volume, healthcheck, `.env.example`) |
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
