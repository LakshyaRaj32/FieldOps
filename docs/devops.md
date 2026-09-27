# DevOps Architecture

> Status: **design (Version 0), backend deployable since Version 2.** The API reads all
> configuration from the environment and is ready for a PaaS or container host
> ([backend-development.md](backend-development.md#7-staging-preparation)). Local PostgreSQL
> runs natively for now; Docker Compose is adopted later. Full containerization and CI/CD come
> in V16. Observability comes in V15.

## 1. Goals

- **Reproducible.** The same Postgres, Redis and Node versions everywhere, from a developer
  laptop to production.
- **Automated.** Every change is type-checked, linted, tested and built in CI before merge.
- **Simple to operate.** Managed services where possible, no Kubernetes, and a single
  deployable image.
- **Safe releases.** Migrations are controlled, deploys are health-checked, and rollback is
  possible.
- **Secure by default.** No secrets in git, minimal images, dependency and image scanning.

## 2. Environments

| Environment | Purpose | Infrastructure |
| --- | --- | --- |
| `local` | Development | App processes on the host; Postgres, Redis and MinIO in Docker Compose |
| `ci` | Automated verification | GitHub Actions runners with service containers |
| `staging` | Pre-production verification, internal testing builds | Same image and topology as production, smaller sizes |
| `production` | Real users | Container platform or VM, managed Postgres and Redis, S3-compatible storage |

## 3. Local development (grows by version)

| Version | `infra/docker/compose.yaml` services |
| --- | --- |
| Later | `postgres` (pinned major version, named volume, healthcheck). Until then: native PostgreSQL 18 |
| V9 | `minio` (S3-compatible object storage) |
| V10 | `redis` |
| V15 | Optional `observability` profile: OpenTelemetry Collector, Prometheus, Grafana |

The API runs on the host in watch mode for fast feedback. The mobile app runs on an emulator or
device and connects to the host (`10.0.2.2` from the Android emulator).

## 4. Container image (V16)

- A **single multi-stage Dockerfile** for `apps/api` that produces one image, run as either
  `api` or `worker` depending on the command.
- Stages: install dependencies (cached on the lockfile) → build (TypeScript, Prisma client) →
  runtime (slim Node base, production dependencies only).
- Runs as a **non-root** user with a read-only filesystem where possible.
- `HEALTHCHECK` against `/health/live`. Readiness is checked at `/health/ready`, which checks
  database and Redis connectivity.
- Image tagged with the git SHA, plus semantic versions on release.
- Scanned for vulnerabilities in CI.

## 5. CI pipeline (GitHub Actions)

Triggered on pull requests and on the main branch:

```text
 ┌─────────┐   ┌───────────────┐   ┌───────────────────────────┐   ┌──────────────┐
 │ install │──▶│ lint, format, │──▶│ unit tests                 │──▶│ build         │
 │ (npm ci,│   │ typecheck     │   │ integration tests (Postgres│   │ api image     │
 │  cache) │   │ (all          │   │ + Redis service containers)│   │ android APK   │
 └─────────┘   │  workspaces)  │   │ migration check            │   │ OpenAPI spec  │
               └───────────────┘   └───────────────────────────┘   └──────────────┘
```

- **Migration check.** Apply all migrations to an empty database, confirm the Prisma schema
  and migrations are in sync, and flag destructive changes for review.
- **Android.** Build a debug or release APK with Gradle (cached), run Kotlin unit tests, and
  run lint. E2E tests on an emulator run nightly or on demand, since they are slower.
- **Path filters** so mobile-only changes don't rebuild the API image, and the reverse.
- The pipeline must stay under about 10 minutes for pull requests. Caching and parallel jobs
  are required.

## 6. Continuous delivery (V16)

- Merge to `main` → build and push the image → deploy to **staging** automatically → run smoke
  tests.
- Promotion to **production** happens through a manual approval or a tag, using the same image
  digest that passed staging. Production never gets a rebuild.
- **Migrations** run as a separate release step (`prisma migrate deploy`) before new app
  instances start. Migrations must be backward compatible with the running version
  (expand/contract pattern), so rolling deploys and rollbacks are safe.
- **Rollback** means redeploying the previous image digest. Destructive schema changes are
  split across releases.

## 7. Mobile release pipeline

- `versionCode` is derived from CI and `versionName` follows semantic versioning.
- Release signing keys live in CI secrets and are **never committed**.
- Builds are distributed to Google Play **internal testing** first, then to closed or
  production tracks.
- The **sync protocol version** is part of the release checklist. The server must support the
  oldest app version still in use.

## 8. Configuration and secrets

- Twelve-factor style: configuration comes from the environment and is validated at process
  start.
- `.env.example` documents every variable. `.env` is gitignored.
- CI secrets live in GitHub encrypted secrets. Runtime secrets come from the hosting platform's
  secret manager.
- JWT signing keys, database credentials and API keys are rotatable without code changes.

## 9. Data operations

- **Managed PostgreSQL** with automated backups and point-in-time recovery. Restores are tested
  periodically, not only assumed to work.
- **Redis** is treated as rebuildable. Losing it must not lose business data (see
  [architecture.md](architecture.md#5-sources-of-truth)).
- **Object storage** uses versioning or retention policies for evidence files.
- **Retention jobs** (location history, `processed_mutations`, `change_log`) run as scheduled
  worker jobs.

## 10. Observability (V15)

| Signal | Tooling | Notes |
| --- | --- | --- |
| Logs | pino (structured JSON) | Request ID, user ID, org ID, route, latency; no secrets or personal data |
| Traces | OpenTelemetry SDK → Collector → backend of choice | HTTP → service → Prisma → Redis → queue jobs, linked across processes |
| Metrics | Prometheus-format endpoint (or OTel metrics), Grafana dashboards | RED metrics per route, queue depth and latency, sync push/pull metrics, WebSocket connections |
| Errors / crashes | Sentry or equivalent (backend and mobile) | Source maps and ProGuard mappings uploaded in CI |
| Health | `/health/live`, `/health/ready` | Used by the platform and the load balancer |
| Alerts | Based on SLOs | For example: sync push p95 latency, 5xx rate, queue lag, failed-job rate |

## 11. Scaling path

1. **One instance** each of `api` and `worker`, with managed Postgres and Redis.
2. **Horizontal `api` replicas** behind a load balancer. This works without sticky sessions
   because Socket.IO uses websocket-only transport and fans out through the Redis adapter.
3. **Scale `worker` replicas** by queue depth. Split queues across worker pools if one queue
   type starves the others.
4. **Database:** indexes and query tuning first, then read replicas for reporting, then
   partitioning for location history.
5. **Service extraction** only as a last resort, driven by measurements (see
   [backend-architecture.md](backend-architecture.md#16-extraction-path)).

## 12. Explicit non-goals

- Kubernetes, Helm, service mesh or multi-region active-active.
- Self-hosted databases in production when managed options exist.
- Infrastructure as code for its own sake. It will be introduced (for example with Terraform)
  only if the chosen hosting platform makes it worthwhile.
