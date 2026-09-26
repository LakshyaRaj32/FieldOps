# Phase Status

The project is managed in six phases ([master-development-plan.md](master-development-plan.md)).
This file records where the project stands. Update it at every phase checkpoint.

```text
Current Phase:   Phase 2 — Core Product
Phase Status:    IMPLEMENTED — awaiting physical-device verification
Completed Phase: Phase 1 — Foundation
Next Phase:      Phase 3 — Offline-First
```

Phase 2 becomes **COMPLETE** only after the physical Android workflow in
[Verification still required](#verification-still-required) passes. Then set:

```text
Current Phase:   Phase 2 — Core Product
Phase Status:    COMPLETE
Completed Phase: Phase 2 — Core Product
Next Phase:      Phase 3 — Offline-First
```

and create the `phase-2-core-product` tag.

## Phase overview

| Phase | Former versions | Status |
| --- | --- | --- |
| 1 — Foundation | V0, V1, V2 | Complete (see [roadmap.md](roadmap.md) for the V0–V2 checklists) |
| 2 — Core Product | Jobs (the former V4 job model and screens) | Implemented, device verification pending |
| 3 — Offline-First | V5, V6 (plus the offline half of the former V4) | Not started |
| 4 — Field Operations | V7, V8, V9 | Not started |
| 5 — Production Engineering | V10, V11, V12, V13, V15, V18 | Not started |
| 6 — Showcase Release | V14, V16, V17, V19 | Not started |

**Not yet placed in a phase: organizations and tenancy (the former V3).** The master plan does
not assign them. Phase 2 runs as a single organization: managers and admins manage every job.
The job policy is written so that adding the organization check is a local change
(`canView` in `apps/api/src/jobs/domain/job.policy.ts`). **Decision needed from the repository
owner:** schedule tenancy (Phase 5 security hardening is the natural home) or declare the
product single-organization.

---

## Phase 2 — Core Product

### What was implemented

**Backend (`apps/api`)**

- `jobs` module following the documented module layout: thin controller → `JobsService` →
  pure `domain/` (state machine, authorization policy) → `data/` repository.
- Job model: title, description, customer, address, coordinates (optional pair), scheduled
  time, priority, status, assigned worker, manager notes, checklist (item definitions),
  cancellation reason, lifecycle timestamps, `version`, created/updated timestamps.
- Append-only job history (`job_events`): created, assigned/reassigned, started, completed,
  cancelled, with actor and assignee, written in the same transaction as the change.
- Endpoints (all under `/api/v1`, documented in Swagger and [api.md](api.md#jobs)):
  `POST /jobs`, `GET /jobs`, `GET /jobs/:id`, `PATCH /jobs/:id`, `DELETE /jobs/:id`,
  `POST /jobs/:id/assign`, `/start`, `/complete`, `/cancel`, and `GET /users/workers`.
- Explicit state machine: `PENDING → ASSIGNED → IN_PROGRESS → COMPLETED`, reassignment only
  before start, cancellation from any open status, `COMPLETED`/`CANCELLED` terminal.
- Authorization on every operation, server-side: role permissions plus the resource
  relationship (a worker sees and works only jobs assigned to them). The same policy drives
  route gates, service checks and the `allowedActions` sent to clients.
- Optimistic concurrency (`version` compare-and-set) for edits and transitions; idempotent
  status commands (repeating "start" on a started job succeeds without a second change).
- Four new error codes: `INVALID_STATUS_TRANSITION`, `JOB_NOT_EDITABLE`, `INVALID_ASSIGNEE`,
  `VERSION_CONFLICT`, in the existing error envelope.
- Migration `20260926162210_jobs` with indexes for the worker list, status filters and keyset
  pagination, and CHECK constraints for status/assignment/timestamp consistency.

**Mobile (`apps/mobile`)**

- Jobs tab is a stack: job list → job details → (managers) create/edit form and worker picker.
- Job list: Active/Done views, cursor pagination, pull to refresh, loading/empty/error states.
  Workers see "My jobs"; managers see every job with its assignee.
- Job details: all job information, checklist, history, and exactly the actions the server
  allows (Start job / Complete job for the assigned worker; Assign, Edit, Cancel, Delete for
  managers). Completing, cancelling and deleting ask for confirmation.
- Manager flow: create job → pick worker → job details → monitor status.
- Dashboard shows the next three open jobs.
- Reusable components: `JobCard`, `JobStatusBadge`, `JobPriorityBadge`; `InfoRow` moved to
  shared components; `Screen` gained optional pull-to-refresh.
- App-owned messages for the new error codes; responses validated at runtime before use.

### Important decisions

| Decision | Why |
| --- | --- |
| The server computes `allowedActions` per job and user; the app renders only those | One source of authorization truth, and the UI can never offer an action the server would reject. Sharing the state machine with the app (in `@fieldops/shared`) waits for Phase 3, when the app must decide offline |
| Single current assignee on the job row; assignment history in `job_events` | The workflow needs one worker per job. The architecture's `JobAssignment` table is unnecessary until crews exist |
| Workers get `404` for jobs that are not theirs | Does not reveal which job IDs exist. Role-level refusals (a worker assigning) are `403` |
| Only never-assigned (`PENDING`) jobs can be deleted; everything else is cancelled | Keeps the history of any job a worker has seen, and devices will need tombstones once sync exists |
| Checklist items are defined per job; completion is not tracked yet | Checklist execution belongs to later phases. The table is ready for per-item completion columns |
| `scheduledAt` is required and the list is ordered by `(scheduled_at, id)` with keyset cursors | Field jobs are appointments. A required sort key makes cursor pagination simple and stable |
| Jobs are read online through RTK Query in Phase 2 | Phase 2 is online. Screens use only the feature's hooks, so Phase 3 can move the worker's jobs to SQLite behind them |
| Schedule entered as date and 24-hour time text fields | Avoids a native date-picker dependency in this phase |
| Tenancy deferred (single organization) | Not in the Phase 2 scope; see "Not yet placed in a phase" above |
| No audit-log table yet | Job history covers job-related actions. The general `audit_log` (logins, role changes) is Phase 5 security work |

### Fixes to earlier work

- **Workspace links on the development machine (not a code change).** `node_modules/@fieldops/*`
  junctions pointed at `L:\Projects\FieldOps` while the repository is `L:\projects\FieldOps`.
  Metro compares paths case-sensitively, so `@fieldops/types` could not be resolved and the
  Android bundle failed; this affected the V2 app as well. The junctions were recreated. See
  [development.md](development.md#windows-notes).

### Testing status

| Suite | Command | Result |
| --- | --- | --- |
| API unit | `npm test -w @fieldops/api` | 89 passed (48 from V2 + 41 new: state machine, policy, cursor) |
| API E2E (real PostgreSQL) | `npm run api:test:e2e` | 87 passed (33 from V2 + 54 new jobs tests) |
| Mobile | `npm test -w @fieldops/mobile` | 116 passed (83 from V2 + 33 new: API client, commands, form) |
| Typecheck / lint | `npm run typecheck`, `npm run lint` | Pass, 0 warnings |

The E2E suite covers the complete manager → worker lifecycle, creation and validation,
assignment (including invalid assignees and reassignment), worker isolation (another worker's
job, pending jobs, list scoping), every role on every action, invalid transitions, idempotent
retries, concurrent edits, pagination and deletion rules.

### Build and deployment status

- API: `npm run api:build` succeeds; the compiled server starts and serves all job endpoints
  in its OpenAPI document.
- Android: see the build entry in [Verification still required](#verification-still-required).
- No staging deployment exists yet (CI/CD and staging are Phase 6).

### Verification still required

1. **Physical Android device.** No device was connected (`adb devices` was empty) when Phase 2
   was implemented, so the workflow has not been run on the phone. Run, with the API on the
   computer and `npm run mobile:reverse`:
   - Register a manager and a worker in the app; grant the manager role with
     `npm run user:set-role -w @fieldops/api -- <email> MANAGER`.
   - Manager: Jobs → New job → create → pick the worker → job shows **Assigned**.
   - Worker: sign in → Jobs shows the job → open it → **Start job** → **Complete job**.
   - Manager: the job shows **Completed** with its history.
2. Mark this phase COMPLETE, commit, tag `phase-2-core-product`, push.

### Known issues and limitations

- Physical-device workflow not yet verified (above).
- Single organization: every manager and admin sees and manages every job.
- `GET /users/workers` returns at most 100 workers, without search (enough for the current scale).
- The Postman collection covers authentication only; jobs are covered by Swagger and the E2E
  tests.
- Coordinates can be set through the API but not in the mobile form (map picking is field-ops
  work).
- No automated UI rendering tests; mobile tests cover the API client and the pure rules
  (which buttons show, form validation, formatting). Maestro-style device E2E is later work.
