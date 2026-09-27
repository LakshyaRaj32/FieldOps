# API Conventions

> Status: **Phase 3 (Offline-First).** Applies to every endpoint of the FieldOps API. Jobs were
> added in Phase 2 ([Jobs](#jobs)); idempotent device commands, field notes and the worker's
> working set in Phase 3 ([Offline sync](#offline-sync)).

## Base URL and versioning

| Path | Contents |
| --- | --- |
| `/api/v1/...` | The versioned REST API (URI versioning via NestJS `enableVersioning`) |
| `/health/live`, `/health/ready` | Unversioned platform probes |
| `/api/docs` | Swagger UI (not in production unless `SWAGGER_ENABLED=true`) |
| `/api/docs-json` | OpenAPI document |

A breaking change ships as `/api/v2/...` next to v1. Additive changes (new optional fields,
new endpoints) stay in v1.

## Response envelope

Every JSON response has the same outer shape. The TypeScript types live in
`@fieldops/types` (`packages/types/src/api.ts`) and are shared by the API and the app.

**Success**

```json
{
  "success": true,
  "data": { "id": "…", "email": "worker@example.com" }
}
```

`204 No Content` responses (logout) have no body.

**Error**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password.",
    "requestId": "mbx2k1-4f8a9c2e"
  }
}
```

Validation errors add `details`:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are missing or invalid.",
    "details": [
      { "field": "email", "message": "Enter a valid email address." },
      { "field": "password", "message": "Password must be at least 8 characters." }
    ],
    "requestId": "…"
  }
}
```

Rules:

- Clients branch on `code`, never on `message`. Codes are stable; messages may change.
- `message` is safe to show to users, but the mobile app uses its own copy per code.
- Stack traces, database errors and framework messages are never returned. Unexpected
  failures return `500 INTERNAL_ERROR` with a generic message, and are logged server-side with
  the request ID.
- Submitted values are never echoed in validation messages (passwords).

**Why an envelope instead of RFC 9457 Problem Details** (the V0 plan): the V2 brief asked for
one consistent `success`/`data`/`error` structure, and the envelope gives both success and error
bodies the same discriminant. The information Problem Details would carry (a stable code, a
readable message, the request ID) is all present.

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Invalid or unknown fields; see `details` |
| `BAD_REQUEST` | 400 | Malformed request, for example invalid JSON |
| `UNAUTHENTICATED` | 401 | No access token on a protected endpoint |
| `ACCESS_TOKEN_EXPIRED` | 401 | Refresh the token and retry |
| `ACCESS_TOKEN_INVALID` | 401 | Malformed, forged, or not an access token |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password (the same for both) |
| `REFRESH_TOKEN_INVALID` | 401 | Malformed, forged or expired refresh token |
| `REFRESH_TOKEN_REUSED` | 401 | An already-rotated refresh token was presented; the session is revoked |
| `SESSION_REVOKED` | 401 | The session was signed out or revoked |
| `SESSION_EXPIRED` | 401 | The session reached its expiry |
| `ACCOUNT_DISABLED` | 403 | The user is deactivated |
| `FORBIDDEN` | 403 | Authenticated, but the role is not allowed |
| `NOT_FOUND` | 404 | Unknown route or resource |
| `EMAIL_ALREADY_REGISTERED` | 409 | Registration with an existing email |
| `CONFLICT` | 409 | Generic conflict |
| `INVALID_STATUS_TRANSITION` | 409 | The job's status does not allow the action (for example completing a job that was never started) |
| `JOB_NOT_EDITABLE` | 409 | The job cannot be edited or deleted in its status (closed job, started checklist, non-pending delete) |
| `VERSION_CONFLICT` | 409 | The job changed since the client read it: refetch and retry |
| `INVALID_ASSIGNEE` | 422 | The worker to assign does not exist, is disabled or is not a `WORKER` |
| `IDEMPOTENCY_KEY_REUSED` | 422 | The `Idempotency-Key` (or a device-generated note ID) was already used for a different request |
| `PAYLOAD_TOO_LARGE` | 413 | Body over the limit (100 kB JSON; 10 MB for an evidence file) |
| `UNSUPPORTED_FILE_TYPE` | 415 | The uploaded file is not a JPEG or PNG (detected from its bytes), is damaged, or has too many pixels |
| `EVIDENCE_LIMIT_REACHED` | 422 | The job already has 50 photos |
| `INTERNAL_ERROR` | 500 | Unexpected failure; see server logs with the request ID |
| `SERVICE_UNAVAILABLE` | 503 | A dependency (the database) is down; readiness probe |

The runtime list (`apps/api/src/common/errors/error-codes.ts`) is checked at compile time
against the shared union type, so the two cannot drift.

## Jobs

All job endpoints require a bearer token. Authorization is decided on the server for every
request by the job policy (`apps/api/src/jobs/domain/job.policy.ts`).

| Method | Path | Who | Result |
| --- | --- | --- | --- |
| `POST` | `/api/v1/jobs` | MANAGER, ADMIN | `201` the new job (`PENDING`) |
| `GET` | `/api/v1/jobs` | everyone | `200` a page `{ items, nextCursor }` |
| `GET` | `/api/v1/jobs/:id` | everyone who may see the job | `200` details, checklist, history |
| `PATCH` | `/api/v1/jobs/:id` | MANAGER, ADMIN | `200` the updated job |
| `DELETE` | `/api/v1/jobs/:id` | MANAGER, ADMIN | `204` (only `PENDING` jobs) |
| `POST` | `/api/v1/jobs/:id/assign` | MANAGER, ADMIN | `200` the job, `ASSIGNED` (body `{ workerId }`) |
| `POST` | `/api/v1/jobs/:id/start` | the assigned WORKER | `200` the job, `IN_PROGRESS` |
| `POST` | `/api/v1/jobs/:id/complete` | the assigned WORKER | `200` the job, `COMPLETED` |
| `POST` | `/api/v1/jobs/:id/cancel` | MANAGER, ADMIN | `200` the job, `CANCELLED` (optional body `{ reason }`) |
| `GET` | `/api/v1/users/workers` | MANAGER, ADMIN | `200` active workers to assign |
| `GET` | `/api/v1/jobs/working-set` | WORKER | `200` `{ jobs, generatedAt }`: the offline snapshot (Phase 3) |
| `GET` | `/api/v1/jobs/overview` | MANAGER, ADMIN | `200` the manager dashboard's figures (UI/UX phase, [below](#job-overview)) |
| `POST` | `/api/v1/jobs/:id/notes` | the assigned WORKER | `201` the job with the note (Phase 3) |
| `POST` | `/api/v1/jobs/:id/evidence` | the assigned WORKER | `201` the job with the photo (multipart; Phase 4, [evidence.md](evidence.md)) |
| `GET` | `/api/v1/jobs/:id/evidence/:evidenceId/content` | everyone who may see the job | `200` the image bytes (Phase 4) |
| `POST` | `/api/v1/jobs/:id/messages` | the assigned WORKER, MANAGER, ADMIN | `201` the job with the message (Phase 4) |
| `GET` | `/api/v1/notifications` | everyone | `200` the caller's inbox `{ items, nextCursor, unreadCount }` (Phase 4, [notifications.md](notifications.md)) |
| `POST` | `/api/v1/notifications/:id/read`, `/read-all` | everyone | `204` |
| `PUT` / `DELETE` | `/api/v1/notifications/devices/current` | everyone | `204` register / remove this session's FCM token |

### Job overview

`GET /api/v1/jobs/overview` returns counts computed from every job, so the manager dashboard
never estimates from a page of results. Read-only; one REPEATABLE READ transaction, so the
figures agree with each other. Time windows are rolling from `generatedAt` (no time zone).

| Field | Meaning |
| --- | --- |
| `statusCounts` | Every job by current status (all five statuses, 0 when empty) |
| `overdue` | Open jobs (`PENDING`, `ASSIGNED`, `IN_PROGRESS`) scheduled before now |
| `dueNext24Hours` | Open jobs scheduled in the next 24 hours |
| `completedLast7Days`, `cancelledLast7Days` | By `completedAt` / `cancelledAt` |
| `workload` | `{ worker, assigned, inProgress }` for workers with open jobs, busiest first (max 10) |
| `recentActivity` | The newest job history entries across all jobs, with `jobId` and `jobTitle` (max 10) |
| `generatedAt` | Server time of the figures |

Workers get `403`. The mobile app validates the payload (`isJobOverview`) and refreshes it
whenever job lists are refreshed (realtime events, job commands, pull-to-refresh).

**Realtime** (Phase 4): Socket.IO at path `/realtime` on the API origin (not under `/api/v1`),
WebSocket transport, access token in the handshake. Contract: [realtime.md](realtime.md).

**Status lifecycle.** Status never changes through `PATCH`; only the action endpoints move it,
through the job state machine:

```text
PENDING ──assign──▶ ASSIGNED ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
   │                  │  ▲                  │
   │                  └──┘ reassign         │
   └──────cancel──────┴────────cancel───────┴──▶ CANCELLED
```

- Reassignment is possible only before the worker starts.
- `COMPLETED` and `CANCELLED` are final. Reopening is not supported.
- **Repeating a command is safe.** `start` on a job that is already `IN_PROGRESS` (a double tap,
  or a retry after a lost response) returns `200` with the job and changes nothing. The same
  applies to `complete`, `cancel`, and `assign` with the current assignee. A command that would
  move the job anywhere else is `409 INVALID_STATUS_TRANSITION`.

**Visibility.** Managers and admins see every job (one organization until tenancy exists).
Workers see only the jobs currently assigned to them: another worker's job, or an unassigned
one, answers `404 NOT_FOUND`, exactly as a job that does not exist. `GET /jobs` is filtered to
the caller's own jobs for workers; a worker asking for `assignedWorkerId` of someone else gets
`403`. Role refusals (a worker assigning, a manager starting) are `403 FORBIDDEN`.

**`allowedActions`.** Every job in a response lists what the caller may do with it right now
(`start`, `complete`, `note`, `evidence`, `message`, `assign`, `edit`, `cancel`, `delete`),
computed from the caller's role,
their relationship to the job and its status. Clients show exactly these actions.

**Editing.** `PATCH` takes the `version` the client read, plus any of `title`, `description`,
`customerName`, `address`, `location`, `scheduledAt`, `priority`, `notes`, `checklist`.
`null` clears the optional ones (`description`, `location`, `notes`). A different current
version answers `409 VERSION_CONFLICT`. Closed jobs are read-only; the checklist cannot change
once the job has started (`409 JOB_NOT_EDITABLE`).

**Listing.** `GET /api/v1/jobs?status=ASSIGNED,IN_PROGRESS&assignedWorkerId=…&order=asc&limit=20&cursor=…`

- Ordered by `scheduledAt`, then creation (`order=desc` for latest first).
- `limit` 1–100 (default 20). Pass the page's `nextCursor` as `cursor` for the next page; it is
  `null` on the last page. Cursors are opaque; a forged one is `400 VALIDATION_ERROR`.

**Validation.** `scheduledAt` must be an ISO 8601 date-time **with** a time zone (`Z` or
`+05:30`), so the instant does not depend on the server's zone. Text fields are trimmed and
length-limited to the database column sizes. Unknown fields (including `status`,
`assignedWorkerId` and `version` on create) are rejected.

## Offline sync

The mobile app's sync engine talks to the ordinary job endpoints. The full protocol,
including the conflict and retry policies, is in [synchronization.md](synchronization.md).

**`Idempotency-Key`** (request header, optional, a UUID) on `POST /jobs/:id/start`,
`/complete` and `/notes`:

- The device creates one key per command and sends it on every attempt, also after an app
  restart.
- The first successful attempt is recorded (per user) in the same transaction as the change.
  A later attempt with the same key returns `200`/`201` with the job **as it is now**,
  without applying anything again, even if the job has moved on since.
- The same key for a different command or job: `422 IDEMPOTENCY_KEY_REUSED`. A malformed key:
  `400 VALIDATION_ERROR` (field `Idempotency-Key`).
- Failed commands are not recorded: a retry of a rejected command is evaluated again.

**`GET /api/v1/jobs/working-set`** (workers) returns full `JobDetail`s of every open job
assigned to the caller plus those closed in the last 7 days (at most 200), and `generatedAt`.
The device replaces its copy with it; a job missing from it is no longer the worker's.

**`POST /api/v1/jobs/:id/notes`** `{ id, body, occurredAt }`:

- `id` is a UUID generated by the device (the note keeps it from capture to server), `body`
  1–2000 characters, `occurredAt` the device time with a time zone (stored as given, shown to
  people, never used for ordering).
- Only the assigned worker; any job status (field evidence is never refused on a closed job).
- Notes are append-only and do not change the job's `version`. Sending the same note again
  is a no-op.
- Every `JobDetail` now contains `fieldNotes` (receipt order) and workers' `allowedActions`
  include `note`.

**Phase 4 additions** (all accept `Idempotency-Key`):

- `POST /jobs/:id/start` and `/complete` take an optional body `{ location: { latitude,
  longitude, accuracyMeters, capturedAt } }`. The server records it on the history entry and
  computes `distanceMeters` from the job site itself; `JobDetail` shows them as
  `startLocation` / `completeLocation` ([location.md](location.md)). A retry keeps the first
  fix.
- `POST /jobs/:id/evidence` (multipart `id`, `capturedAt`, `file`) and
  `POST /jobs/:id/messages` (`{ id, body, occurredAt }`) use device-generated IDs: sending the
  same one again is a replay.
- `JobDetail` gains `evidence` (metadata, receipt order) and `messages` (latest 100, oldest
  first); both are part of the working set.

**Conflicts.** A command whose transition the current server state does not allow is
`409 INVALID_STATUS_TRANSITION` (the server state is kept); a job reassigned away is `404`.
A stale `version` alone does not reject a worker command: the state machine decides.

## Request correlation

Clients may send `X-Request-Id` (the mobile app does, on every request). The API accepts it if it
is 1 to 64 characters of `[A-Za-z0-9._-]`, otherwise it generates a UUID. The ID is echoed in
the `X-Request-Id` response header, included in error bodies and written to the access log.

## Authentication

Protected endpoints require `Authorization: Bearer <accessToken>`. Every route is protected
unless it is explicitly public. The full model is in [authentication.md](authentication.md).

## Swagger

Start the API (`npm run api:dev`) and open <http://localhost:3000/api/docs>.

1. Run `POST /api/v1/auth/register` or `POST /api/v1/auth/login` with **Try it out**.
2. Copy `data.tokens.accessToken` from the response.
3. Click **Authorize**, paste the token (without the `Bearer ` prefix) and confirm.
4. Protected endpoints (`GET /api/v1/auth/me`, `POST /api/v1/auth/logout`) now work. In
   development the token is kept across page reloads.

When the access token expires (after 15 minutes), call `POST /api/v1/auth/refresh` with the
refresh token and authorize again with the new access token.

## Postman

Import [`docs/postman/FieldOps-API.postman_collection.json`](postman/FieldOps-API.postman_collection.json).

- Collection variables: `baseUrl` (default `http://localhost:3000`), `email` (generated per
  run), `password`, and the tokens, which the requests' test scripts fill in.
- Run the **Auth** folder top to bottom: Register, duplicate Register (`409`), Login, wrong
  password (`401`), Me, Me without a token (`401`), Refresh (rotates both tokens), Reuse old
  refresh token (`401 REFRESH_TOKEN_REUSED`, which revokes the session), Logout.
- After the reuse request the session is revoked by design: run **Login** again before
  **Logout**.
- The collection uses bearer auth with `{{accessToken}}` by default; public requests override
  it with "No Auth".

The collection covers authentication. Job endpoints are best explored in Swagger (tag
**jobs**). The Postman collection is for manual exploration. The automated regression suite is the E2E
tests (`npm run api:test:e2e`).
