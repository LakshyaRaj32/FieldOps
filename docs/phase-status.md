# Phase Status

The project is managed in six phases ([master-development-plan.md](master-development-plan.md)).
This file records where the project stands. Update it at every phase checkpoint.

```text
Current Phase:   Multi-tenant business logic (after Phase 4 and the UI/UX phase)
Phase Status:    AUTOMATED CHECKS PASS — device verification pending (the owner tests on the phone)
Completed Phase: Phase 1 — Foundation
Next Phase:      Phase 5 — Production Engineering (not started)
```

Phases 2 and 3 are implemented and verified by automated tests, including an end-to-end run of
the app's offline data layer against the real API and PostgreSQL. **Neither has been run on the
physical Android phone yet**: no device was connected (`adb devices` empty) during either
implementation session. Both device checklists can be done in one sitting:
[Phase 2](#verification-still-required) first, then [Phase 3](#phase-3-device-verification).

**Phase 4 is now installed and checked automatically, but not yet run on the phone.** The
UI/UX session (2026-09-27) installed the dependencies, fixed the type errors in the Phase 4
code, ran every test suite and the API E2E suite (which applied the Phase 4 migration to the
test database), and built the Android debug APK. See
[UI/UX improvement](#uiux-improvement-phase) for the results and
[Phase 4](#phase-4--field-operations) for the device checklist.

When they pass, set:

```text
Current Phase:   Phase 3 — Offline-First
Phase Status:    COMPLETE
Completed Phase: Phase 3 — Offline-First (Phase 2 — Core Product also complete)
Next Phase:      Phase 4 — Field Operations
```

and create the tags `phase-2-core-product` and `phase-3-offline-first`.

**Multi-tenant business logic** (2026-09-27) is implemented and passes every automated check;
see [its section](#multi-tenant-business-logic-phase). The development database must be
migrated before running the API (`npm run db:deploy`).

## Phase overview

| Phase | Former versions | Status |
| --- | --- | --- |
| 1 — Foundation | V0, V1, V2 | Complete (see [roadmap.md](roadmap.md) for the V0–V2 checklists) |
| 2 — Core Product | Jobs (the former V4 job model and screens) | Implemented, device verification pending |
| 3 — Offline-First | Local SQLite, sync engine, conflict resolution (see the note below) | Implemented, device verification pending |
| 4 — Field Operations | V7, V8, V9 | Code written; not installed, tested, built or device-verified |
| 5 — Production Engineering | V10, V11, V12, V13, V15, V18 | Not started |
| 6 — Showcase Release | V14, V16, V17, V19 | Not started |

**Legacy version numbers for Phase 3.** The master plan maps Phase 3 to "former V4 + V5 +
V6", described in the Phase 3 brief as *V4 → local SQLite / offline persistence, V5 →
synchronization engine, V6 → conflict resolution*. The original [roadmap.md](roadmap.md)
numbered them differently (V4 jobs, V5 offline SQLite, V6 sync engine including conflict
policies). Both are kept as written; the content is the same: Phase 3 is local persistence,
the sync engine and conflict resolution together.

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
- Android: the release JS bundle builds (`react-native bundle`), and the debug APK builds
  (`gradlew assembleDebug`, arm64-v8a, 12 min on the development machine). The machine has
  8 GB of RAM and earlier builds crashed the JVM for lack of memory; building one ABI with
  `--no-daemon -Dorg.gradle.workers.max=2` succeeded. `npm run mobile:android` builds only the
  connected device's ABI.
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

---

## Phase 3 — Offline-First

### What was implemented

**Mobile (`apps/mobile`)**

- **SQLite** through `react-native-nitro-sqlite`, behind a small `SqlDatabase` interface
  (`src/services/db`), with forward-only migrations in `PRAGMA user_version` (schema v1).
- **One database per worker**, opened at sign-in or offline session restore.
- **Local job store:** per job the last server copy and the local view (server copy + pending
  commands), recomputed in the same transaction as every change.
- **Offline commands:** start, complete and add a field note. Each is validated with the shared
  state machine and written together with its outbox entry in one transaction. The UI updates
  at once, with no network needed.
- **Outbox** (`pending`, `in_flight`, `synced`, `failed`, `conflict`), durable across restarts.
  Mutation IDs (UUIDv7) are created once and reused on every attempt.
- **Sync engine:**
  - Pushes in outbox order, and a job waiting for a retry holds back its later commands.
  - Then downloads the working set.
  - Exponential backoff with full jitter; offline failures don't count as attempts; dead letter
    after 10 counted attempts.
  - Server-wins conflicts.
  - One cycle at a time, and in-flight entries are recovered after a crash.
- **Triggers:** app start and sign-in, foreground, connectivity regained, every local command,
  pull-to-refresh, "Sync now", and the engine's retry timer.
- **Local-first screens for workers:** job list, job details (including the note composer) and
  dashboard read SQLite and update after every committed change. Managers stay online.
- **Sync status:** a global banner, per-job badges, rejected changes with their reasons
  (Dismiss / Try again), a Profile › Offline sync card with "Sync now", and a warning before
  signing out with unsynced changes.

**Backend (`apps/api`)**

- **`Idempotency-Key`** on `POST /jobs/:id/start`, `/complete` and `/notes`. It is recorded in
  `processed_mutations` in the same transaction as the change. A retry is a replay, concurrent
  duplicates are resolved by the primary key, and a key reused for another command gets
  `422 IDEMPOTENCY_KEY_REUSED`.
- **Field notes** (`job_notes`, `POST /jobs/:id/notes`): append-only, with device-generated IDs,
  on jobs in any status. `JobDetail` gains `fieldNotes`, and workers' `allowedActions` gain `note`.
- **`GET /jobs/working-set`:** the worker's offline snapshot, meaning open jobs plus jobs closed
  in the last 7 days.
- Migration `20260926171517_offline_sync`.

**Shared (`packages/shared`)**

- **`@fieldops/shared`** is a real package now. It holds the job state machine, moved from the
  API, which the API enforces and the phone uses to validate commands offline.

### Important decisions

| Decision | Why |
| --- | --- |
| react-native-nitro-sqlite over op-sqlite | The app already builds Nitro Modules (MMKV). It is about 10 MB against about 350 MB, and the swap is contained behind `SqlDatabase`. Trade-off: no SQLCipher, and encryption is Phase 5 |
| Commands through the domain endpoints plus `Idempotency-Key`, not a `/sync/push` batch | The endpoints already enforce authorization and the state machine, so there is nothing new to secure |
| Working-set snapshot instead of a change-log cursor | Working sets are small, a snapshot can't miss a change, and revocations come for free |
| The state machine, not `version`, decides worker commands | A manager's edit must not reject a worker's valid start. `version` still guards manager edits |
| Offline failures don't count toward the retry limit | A worker offline for days must never dead-letter their work |
| Server copy and local view kept separately | The server stays authoritative, and a refresh can never erase unsynced work |
| Sign-out deletes local data only when nothing is unsynced | Unsynced work is never discarded |
| Field notes added in this phase | The master plan's Phase 3 demo includes "Add Notes", and append-only notes show the no-conflict path |

### Testing status

| Suite | Command | Result |
| --- | --- | --- |
| Shared | `npm test -w @fieldops/shared` | 20 passed (the state machine, moved from the API) |
| API unit | `npm test -w @fieldops/api` | 69 passed |
| API E2E (real PostgreSQL) | `npm run api:test:e2e` | 108 passed (21 new: working set, idempotency including concurrent duplicates, notes, conflicts, a replayed offline session) |
| Mobile | `npm test -w @fieldops/mobile` | 174 passed, 2 skipped (the live tests below); 58 new |
| Live offline sync (app data layer ⇄ real API + PostgreSQL) | see [mobile-development.md](mobile-development.md#testing-and-quality-checks) | **2 passed**: the full offline session with a restart and lost responses (each command applied exactly once, and phone and server converge), and a cancelled-while-offline conflict (server state kept) |
| Typecheck / lint | `npm run typecheck`, `npm run lint` | Pass, 0 warnings |
| Android | `gradlew assembleDebug` (arm64-v8a) and `react-native bundle` | Both succeed. `libRNNitroSQLite.so` is packaged, and TypeORM (an upstream dependency) is not bundled |

The mobile data-layer tests run against real SQLite (`node:sqlite`) and cover:

- persistence across restarts, and atomicity under an injected mid-transaction crash;
- migrations: rollback on failure, and refusing a newer schema;
- the projection;
- the retry policy;
- sync-engine behavior: success, ordering, offline, temporary failure then success, dead
  letter, isolation of a permanent failure, lost responses, recovery of a command left in
  flight after a crash, single flight, cancellation and reassignment conflicts, and the full
  offline session across a restart.

### Build and deployment status

- API: `npm run api:build` succeeds; `prebuild` builds `@fieldops/shared`, and the compiled API
  loads it at runtime.
- Android debug APK builds (see above). No staging deployment yet (Phase 6).

### Phase 3 device verification

Not done: no device was connected. Run the
[offline demo on the phone](mobile-development.md#offline-demo-on-the-phone-phase-3):

1. download;
2. airplane mode;
3. restart offline;
4. start, note, complete;
5. force close;
6. reconnect and confirm convergence;
7. conflict.

Also check that `adb logcat` shows no SQLite errors at start-up.

### Known issues and limitations

- **Not verified on the physical device** (see above).
- The local database is **not encrypted** (planned for Phase 5), and IDs created on the device
  use Math.random (unique, not secret).
- Sync runs only while the app is in use (start, foreground, reconnect, timers). There's no
  background sync yet (WorkManager, Phase 4 or later).
- `processed_mutations` rows are never pruned yet (planned: 90 days, with the Phase 5 workers).
- A command whose response was lost and whose job was then reassigned gets a 404 on retry and
  is shown as a conflict, even though the server did apply it. This is a rare edge case: the
  server state stays correct, and only the phone's message is misleading.
- The worker's working set is capped at 200 jobs, and there's no change-log sync for larger
  sets.
- Only worker job commands work offline; manager screens need a connection, by design.
- Checklist completion, photos, signatures, location and messages are not implemented (Phase 4).

---

## Phase 4 — Field Operations

Former V7 (location), V8 (messaging, WebSockets) and V9 (notifications, files, evidence) as one
phase, integrated into the Phase 3 offline architecture: every new worker action is an outbox
command, and realtime and push are hints that trigger the existing sync.

### What was implemented

**Location** ([location.md](location.md))

- A small Kotlin Turbo Module `FieldOpsLocation` on Android's `LocationManager` (no Play
  services, no npm dependency): one foreground fix on demand, "is location on?", open settings.
- Permissions asked in context with `PermissionsAndroid` (fine + coarse; no background
  location); every failure case explained with its way out.
- A fix is captured at **Start job** and **Complete job** (never blocking them) and travels in
  the outbox payload; the server stores it on the STARTED/COMPLETED history entry and computes
  the distance from the job site itself. "Check my distance" shows a fix without storing it.

**Realtime** ([realtime.md](realtime.md))

- Socket.IO gateway at `/realtime` (WebSocket only), authenticated with the same access-token
  and session checks as REST (`AccessTokenVerifier`, extracted from the Passport strategy).
- Rooms from the job policy: managers + the assigned worker; an `unassigned` hint for a worker
  a job was taken from. Connections close at token expiry and at sign-out.
- Events `job.changed` and `job.message.created` (IDs and status only, versioned envelope).
- App: `RealtimeClient` with bounded backoff (1–30 s), one token refresh on expiry, paused in
  the background and offline; every event and every (re)connection triggers the Phase 3 sync
  (workers) and a refetch (online screens).

**Messages**

- Job-scoped conversation between the assigned worker and managers (`job_messages`,
  device-generated IDs, idempotent). Workers send through the outbox (`job.message.send`,
  works offline); managers send online. The latest 100 messages are part of `JobDetail` and
  therefore of the worker's working set: no separate message sync.

**Notifications** ([notifications.md](notifications.md))

- Inbox (`notifications` table, list/read/read-all API, Notifications tab with unread badge).
- Rules: assignment, unassignment, cancellation, completion (to the creator), messages; never
  to the actor.
- FCM HTTP v1 sender (OAuth assertion signed with the existing `@nestjs/jwt`), push payloads
  with IDs only; disabled cleanly without a service-account file.
- Device tokens bound to sessions (`push_devices`): rotation, move between sessions, removal on
  sign-out, on FCM "unregistered", and never sent to revoked sessions.
- App: React Native Firebase messaging, permission on Android 13+, taps open the job from the
  background and from a cold start, "Looking for this job…" + sync when it is not on the phone.
  Android channel `jobs` created natively. Push is optional per build (no
  `google-services.json` → "Not available in this build").

**Evidence** ([evidence.md](evidence.md))

- Photos (JPEG/PNG) taken or chosen with `react-native-image-picker` (resized to 1920 px),
  copied to app-private storage by a small Kotlin module `FieldOpsFiles`, and uploaded through
  the outbox (`job.evidence.add`, multipart, exactly once).
- Server: type detected from the bytes, structure and dimensions checked, EXIF/GPS and other
  metadata stripped (orientation kept), 10 MB and 50-per-job limits, stored through an
  `ObjectStorage` interface (local disk implementation), metadata in `job_evidence`,
  authorized download.
- Gallery with states Waiting to upload / Uploading / Uploaded / Upload failed; local files
  deleted once nothing needs them.

**Backend structure**

- In-process domain events (`src/events`): jobs publish `job.changed` / `job.message.created`
  after commit, auth publishes `session.ended`; realtime and notifications subscribe.
- Migration `20260927100000_field_operations` (hand-written in Prisma's format): location
  columns on `job_events` with a CHECK constraint; `job_evidence`, `job_messages`,
  `push_devices`, `notifications`.
- New error codes `UNSUPPORTED_FILE_TYPE`, `EVIDENCE_LIMIT_REACHED`; new config
  `STORAGE_DIR`, `FCM_SERVICE_ACCOUNT_FILE`.

**App data layer**

- Local schema v2: the outbox rebuilt with the two new command types (rows copied unchanged),
  `evidence_files`; jobs stored by v1 are completed with the new fields when read.
- `JobDetail` gains `startLocation`, `completeLocation`, `evidence`, `messages` (validated at
  runtime); workers' `allowedActions` gain `evidence` and `message`, managers' gain `message`.

### Important decisions

| Decision | Why |
| --- | --- |
| On-demand foreground location, no tracking | No workflow needs continuous tracking; it would cost battery and privacy for nothing |
| Kotlin module instead of a geolocation library | Three platform calls, exact failure codes ("location off" vs "no fix"), no Play services, no dependency |
| Location recorded, never enforced | Fixes can be inaccurate or spoofed; enforcing would block honest workers. The server computes the distance itself |
| Evidence through the outbox | Same guarantees as every other command (durable, ordered, idempotent, visible failures); only the transport is multipart |
| Messages inside `JobDetail` / the working set | Reuses sync; no second synchronization system |
| Local-disk object storage behind an interface | No MinIO container on an 8 GB machine; one implementation, swappable for S3 |
| Upload through the API, not presigned URLs | The server must inspect and rewrite the bytes (type, metadata) anyway; photos are small |
| FCM HTTP v1 without the Admin SDK | One HTTP call, signed with the JWT library already in use |
| Device token per session | A session is a signed-in device: sign-out and revocation end push automatically |
| In-process domain events | Decouples jobs from realtime/notifications now; Phase 5 swaps in outbox + BullMQ |

### Testing status

**Nothing in this phase has been run.** Tests written:

| Suite | New or changed |
| --- | --- |
| Shared (`npm test -w @fieldops/shared`) | `geo.spec.ts` |
| API unit (`npm test -w @fieldops/api`) | `evidence-image`, `job-location`, `domain-events`, `local-disk-object-storage`, `realtime-audience`, `notification-plan`, `fcm-push-sender`, `app-config`, `job.policy` (updated) |
| API E2E (`npm run api:test:e2e`) | `field-operations.e2e-spec.ts` (location, evidence, messages, notifications, push devices), `realtime.e2e-spec.ts` (real Socket.IO client); `jobs` and `offline-sync` updated for the new `allowedActions` |
| Mobile (`npm test -w @fieldops/mobile`) | `localSchema.test.ts` (v1 → v2 with pending work), `syncEngine.test.ts` (location, uploads, messages, file cleanup), `projection`, `contracts`, `locationResult`, `photoPicker`, `realtimeClient`, `notificationRouting`, `notificationsApi`, `presentation`, `retryPolicy` |

### Steps to verify (in order, each needs the owner's go-ahead)

1. `npm install` at the root (adds `@nestjs/websockets`, `@nestjs/platform-socket.io`,
   `socket.io`, `socket.io-client`, `react-native-image-picker`,
   `@react-native-firebase/app`, `@react-native-firebase/messaging`). The versions in the
   manifests are the expected current majors; adjust if npm reports one missing.
2. `npm run typecheck`, `npm run lint`, then `npm run format -w @fieldops/api` and
   `npm run format -w @fieldops/mobile` (the new files were not run through Prettier).
3. `npm test`, then `npm run db:deploy` and `npm run api:test:e2e` (PostgreSQL running).
4. Android build (`--no-daemon -Dorg.gradle.workers.max=2`, one ABI; codegen generates the
   `FieldOpsSpecs` Java specs the Kotlin modules extend). Without `google-services.json` the
   build skips the Google services plugin; confirm the app starts with push "Not available".
5. Optional push: Firebase project, `google-services.json`, `FCM_SERVICE_ACCOUNT_FILE`
   ([notifications.md](notifications.md#setup-push)).
6. The [device checklist](#phase-4-device-verification).

### Phase 4 device verification

Not done (no device; nothing built). With the API on the computer, `npm run mobile:reverse`,
one manager and one worker account (two phones, or the manager in Swagger):

1. Manager assigns a job with coordinates → worker's phone: realtime refresh while open; push
   while in the background and while closed; tap opens the job.
2. Worker opens the job → Job site card → **Check my distance** → permission prompt → distance.
   Try deny, "don't ask again", location switched off: each explained.
3. **Start job** → "Getting your position…" → started; manager sees "Started … from the site".
4. Worker and manager exchange a message; each side updates live.
5. Airplane mode. Worker: take a photo, choose a photo, write a message, **Complete job**
   (position captured or explained). Everything shows "Waiting…".
6. Force close, reopen offline: all still pending.
7. Network back: sync uploads photos and sends commands exactly once; realtime reconnects;
   manager gets the completion notification; both sides show the same final state.
8. `adb logcat` shows no errors from `FieldOpsLocation`, `FieldOpsFiles` or SQLite migration 2
   (upgrade from a Phase 3 install with pending work, if one exists).

When everything passes: set this phase COMPLETE, commit, tag `phase-4-field-operations`.

### Known issues and limitations

- **Not run on the phone yet.** Since the UI/UX session: dependencies installed, type checks
  and lint pass, unit tests pass except one (below), the API E2E suite passes (so the
  migration SQL applies cleanly), and the debug APK builds (so the Kotlin modules compile
  against the generated specs). Still unproven: React Native Firebase at runtime without
  `google-services.json`, and the device checklist above.
- **One failing API unit test:** `evidence-image.spec.ts` › "removes EXIF, XMP and comments
  but keeps the orientation". The rewritten JPEG's orientation segment does not match what
  the test expects. Either the test or the sanitizer (`jobs/domain/evidence-image.ts`) needs a
  fix; the phone's photo rotation should be checked in step 5 of the device checklist.
- React Native Firebase is expected to stay inert without `google-services.json`; if its
  native side fails at start-up without one, a dummy Firebase project is the workaround.
- Push has no retry before Phase 5 (BullMQ); the inbox and sync cover a lost push.
- Domain events are in-process: a crash between commit and delivery loses that hint only.
- A crash between storing an evidence object and recording it leaves an orphan file (cleanup
  job in Phase 5).
- Socket.IO fan-out is single-instance (Redis adapter in Phase 5).
- Revoking a session from elsewhere closes its WebSockets within one access-token lifetime,
  not instantly (sign-out on the device itself is instant).
- Documents and signatures are not implemented (photos only); no notification preferences;
  no read receipts or typing indicators (out of scope by design).
- The Phase 2 and Phase 3 device checklists are still open as well.

---

## UI/UX improvement phase

A visual and usability pass over the whole app, keeping every feature, API contract and the
offline architecture as they were. Implemented 2026-09-27.

### UI/UX changes

- **Design system.** The existing theme (`src/theme`) was extended, not replaced: a refreshed
  palette with new roles (`secondary`, `info`, `borderStrong`, `textSubtle`, `overlay`),
  elevation tokens (soft shadows in light mode, borders only in dark mode), icon sizes,
  control heights (48 dp touch targets), a `captionStrong` text style and a documented type
  scale (screen title → section → body → caption). Chart colors for job statuses were checked
  for color-vision-deficiency separation in both modes.
- **Common components.** `Button` gained leading icons, a `sm` size, a pressed state, and the
  same disabled and loading look for every variant. `TextField` gained a readable label,
  focus/error/disabled states, an error icon, hints, multiline sizing, and "Next" moves to the
  next field without closing the keyboard. `Card` is flatter (hairline border and a soft
  shadow) with a dense option. `Badge` gained icons and an `info` tone. New components:
  `Icon`, `SectionTitle` (icon + heading on every card), `Skeleton`. Empty, error and loading
  states have icons, clear messages and retry buttons, and never show raw server errors.
- **Keyboard-aware forms.** `Screen` pads its bottom by exactly the part the keyboard covers
  (`hooks/useKeyboardInset`), measured from the screen's real position. This is needed
  because the app is edge-to-edge, so Android 15+ no longer resizes the window. Android's
  scroll view then keeps the focused input visible. Tapping outside an input or dragging
  closes the keyboard, and the tab bar hides while typing. No extra space appears while the
  keyboard is closed. This applies to every form: sign-in, registration, job create/edit,
  field notes and messages.
- **Date and time pickers.** The job form's typed `YYYY-MM-DD` / `HH:MM` fields are replaced
  by `DateTimeField`, which opens the native Android date or time dialog and shows the value
  as "Mon, 28 Sep 2026" / "10:30 AM". The form keeps the same values and validation, and the
  request is unchanged (`scheduledAt`, ISO, device time zone).
- **Notifications.** The inbox is a compact list (about 64 dp rows: icon, title, two-line
  preview, relative time) instead of large cards. Unread entries have the brighter surface, a
  bold title, a filled colored icon and a dot, and screen readers hear "Unread". Read entries
  are muted but readable. Loading shows skeleton rows. See
  [notifications.md](notifications.md#inbox-api).
- **Mark all as read** changes only the read state. Entries stay in place and nothing
  navigates. The list and the tab badge update at once (an optimistic cache update); a
  failure undoes it and shows an inline message. Marking a single entry works the same way.
- **Tab icons.** Dashboard, Jobs, Notifications and Profile have Ionicons icons: filled when
  active, outline when inactive. The unread count appears in the badge and the accessibility
  label. The same four tabs are right for every role; role differences live in the screens.
- **Manager dashboard.** Built from real data only:
  - Overview tiles: open (with unassigned), overdue, due in 24 h, in progress (with assigned),
    completed in 7 days, and completion rate. The rate shows "–" when nothing was closed.
  - Jobs by status: a stacked bar with a labeled legend.
  - Needs a worker: unassigned jobs.
  - Up next.
  - Team workload: open jobs per worker.
  - Recent activity: the latest job history across the team; each entry opens its job.

  Pull-to-refresh updates every section, and realtime events keep it current. Revenue and
  customer metrics are not shown because the product has no such data yet. Workers get a
  smaller home screen with open / in progress / completed (7 days) from the phone's own
  database, so it still works offline.
- **Photos.** Evidence thumbnails are image buttons with an expand badge. Tapping one opens
  `ImageViewer`, a full-screen view with the aspect ratio kept. Pinch or double-tap zooms up
  to 4×, you can drag while zoomed, and a zoom button covers people who can't pinch. It closes
  with the button, Android Back, or a swipe down. It uses the same image source as the
  thumbnail, so nothing is uploaded or downloaded again.
- **App icon.** An adaptive launcher icon (Android 8+), plus legacy PNGs for Android 7: a
  white map pin with a check mark on the brand blue. It has no lettering, so it works with
  any product name. The sign-in screen shows the same mark.

### Technical changes

| Area | Change |
| --- | --- |
| New dependencies | `@react-native-vector-icons/ionicons` (font icons; the font is packaged by Gradle, imported through `/static`, so it is not bundled twice) and `@react-native-community/datetimepicker` (native pickers). Both are small, autolinked and New Architecture ready. No gesture or UI framework was added: the viewer uses React Native's `PanResponder` and `Animated`, and the charts are plain views |
| Removed dependencies | None found unused |
| Components created | `ui/Icon`, `ui/SectionTitle`, `ui/Skeleton`, `common/DateTimeField`, `common/ImageViewer` (+ pure `imageZoom`), `notifications/components/NotificationItem`, `dashboard/components/{ManagerDashboard, MetricTile, StatusBreakdown}` |
| Components modified | `Button`, `TextField` (exports `FieldLabel`, `FieldMessage`, `fieldColors`), `Card`, `Badge`, `AppText`, `Screen`, `EmptyState`, `ErrorState`, `ConnectivityBanner`, `SyncStatusBanner`, `JobCard` (icons, `dense`), `JobDetailSections`, `FieldOperationSections` (gallery + viewer), `NotificationsScreen`, `DashboardScreen`, `JobFormScreen`, `JobsScreen`, `AssignWorkerScreen`, `LoginScreen`, `RegisterScreen`, `ProfileScreen` and the profile/sync cards |
| Navigation | Tab icons, badge styling, `tabBarHideOnKeyboard`, flat headers. No routes changed |
| State management | Optimistic `updateQueryData` for mark read / mark all read (`markReadInPage`, pure and tested); new RTK Query endpoint `getJobOverview`, tagged with the job list so existing invalidations refresh it |
| API | New read-only `GET /api/v1/jobs/overview` (MANAGER, ADMIN): pure shaping in `jobs/domain/job-overview.ts`, one REPEATABLE READ batch in the repository, Swagger DTOs, shared types `JobOverview`, `WorkerWorkload` and `JobActivity` ([api.md](api.md#job-overview)). No existing endpoint or contract changed |
| Configuration | Adaptive icon resources (`mipmap-anydpi-v26`, `drawable/ic_launcher_*.xml`); legacy PNGs and `src/assets/brand-mark*.png` regenerated with `apps/mobile/scripts/render-app-icon.py`; ESLint boundaries: icons only in `ui/Icon.tsx`, the picker only in `common/DateTimeField.tsx` |
| Fixes to earlier work | Type errors in the never-compiled Phase 4 code (index-signature access, nullable Turbo Modules, test typings); a stale table list in `migrations.test.ts`; lint warnings; Phase 4 files formatted with Prettier |

### Testing

```text
[x] npm install (2 packages added)
[x] Type checks: mobile, API, shared types (pass)
[x] Lint: mobile ESLint 0 problems, API oxlint 0 warnings
[x] Mobile unit tests: 245 passed, 2 skipped (live tests); new: markReadInPage, isJobOverview,
    dashboard metrics, image-zoom geometry, date formatting
[~] API unit tests: 129 passed, 1 failed (pre-existing evidence-image case, see Phase 4
    known issues); new: job overview shaping
[x] API E2E against PostgreSQL: 143 passed (new: overview access, empty state, real counts,
    workload and activity)
[x] Android build: gradlew assembleDebug (arm64-v8a) succeeded, including codegen and
    autolinking for the two new native packages
[ ] Forms with keyboard open (short: sign-in; long: job form; bottom fields: checklist,
    note and message composers; multiline)          — owner, on the phone
[ ] Date picker / time picker                         — owner, on the phone
[ ] Notifications: read vs unread, mark all as read   — owner, on the phone
[ ] Tab navigation and icons                          — owner, on the phone
[ ] Manager dashboard                                 — owner, on the phone
[ ] Photo thumbnail → full-screen viewer, zoom, close — owner, on the phone
[ ] Launcher icon on the home screen                  — owner, on the phone
[ ] Different screen sizes (layouts use flex and wrap; tiles 2 per row, 3 from 600 dp)
[ ] Regression: sign-in, jobs, offline sync, messages, photos (the Phase 2–4 checklists)
```

The APK was built but not installed or run: the owner does the device testing.

### Known limitations and next steps

- The app is Android-only (no `ios/` project). The iOS paths in `Screen` and `DateTimeField`
  follow the platform's documented behavior but have never been built.
- The activity feed reads the newest `job_events` without a dedicated `created_at` index.
  That is fine at single-organization scale; add the index with the Phase 5 performance work.
- Revenue/earnings and customer metrics need data the product does not have yet. The
  overview endpoint can grow fields without breaking the app, which validates only what it
  uses.
- The viewer shows one photo at a time (no swiping between photos yet).
- Themed (monochrome) launcher icons for Android 13+ are not provided.
- The product is named FieldOps in code and on the device. The UI/UX brief called it
  "ServiceHub"; renaming is a separate decision, and the icon has no lettering so it fits
  either name.

## Multi-tenant business logic phase

Commit `1200b16` on `phase-3/offline-first` (2026-09-27). The rules themselves are in
[business-domain.md](business-domain.md).

### What was implemented

- **Organizations** as tenants, with `SUPER_ADMIN`, `ORGANIZATION_ADMIN` (was `ADMIN`),
  `MANAGER` and `WORKER`; teams (worker → manager); scoped managers with optional
  organization-wide access; suspension that blocks sign-in, requests and realtime.
- **Shops** (many-to-many with managers and workers), **products**, **orders** with items and
  **payments**: partial payments, server-derived balances, no overpayment (row lock and CHECK),
  duplicate reference protection, verification and rejection, overdue notices.
- **Operation types** on the existing job, with one shared state machine (field lifecycle for
  every type except `GENERAL`) and shared submission requirements checked offline and on the
  server. Verification applies the effect (delivery, payment, new order) in one transaction.
- **Append-only audit log**, business-event notifications, realtime presence for the
  dashboard's "online" figure, arrival radius flag, duplicate photo detection.
- **Mobile:** shops, shop detail and account, orders, members, products, organization
  settings, change password, platform (organizations) screens; role-based tabs; the field
  lifecycle and submission form offline (local schema v3); dashboard money, team and shop
  figures; "To verify" tile for workers; a "not part of an organization yet" dashboard.

### Important decisions

- The operation **is** the job: the offline outbox, evidence, messages and notifications are
  reused, and `/jobs` stays the API. `GENERAL` jobs behave exactly as before.
- Existing data moves into a "Default organization"; nothing is deleted. The role enum value is
  renamed in place, so existing `ADMIN` users become `ORGANIZATION_ADMIN`.
- Verification is the `SUBMITTED` status, rescheduling an action; see
  [business-domain.md](business-domain.md#5-operation-types-and-the-state-machine).
- No new infrastructure: the overdue scan is an in-process timer (`OVERDUE_SCAN_INTERVAL`).
- No new dependencies.

### Testing status

| Suite | Result |
| --- | --- |
| Shared (`packages/shared`) | 88 passed |
| API unit | 137 passed |
| API E2E (real PostgreSQL, `fieldops_test`) | 200 passed, including new `tenancy`, `payments`, `operations`, `shops` suites |
| Mobile (Jest) | 266 passed, 2 skipped (live API tests) |
| Type check, lint, API build | clean |

The E2E suites cover the testing checklist: cross-tenant reads and writes refused (404 or
`INVALID_REFERENCE`), scoped managers, suspended organizations, partial and concurrent
payments, overpayment and duplicate references refused, verification and rejection effects,
every lifecycle transition and its idempotent retry, submission requirements, audit rows for
tenancy and payment changes, and the notifications of payment and operation events.

### Steps to run it

1. `npm run db:deploy` against `fieldops_dev` (applies the two new migrations).
2. Create the first platform admin:
   `npm run user:set-role -w @fieldops/api -- you@example.com SUPER_ADMIN`.
3. Sign in on the phone as that user, create an organization and its admin, then as the admin
   add members, shops and products.

### Device verification

Not yet done on the phone, and the Android APK was not rebuilt in this phase. Check: each role's
tabs; a worker's delivery, collection and visit offline then synced; the manager verifying and
rejecting; a shop's account after a partial payment; a suspended organization's members being
refused.

### Known issues and limitations

- When an organization is suspended, the app is refused (`ORGANIZATION_SUSPENDED`) and shows
  the error, but does not yet sign the user out or explain the suspension on a screen of its
  own; the phone keeps its copy of the worker's operations until they sign out.
- The overdue scan runs inside the API process; with several API instances it would run in each
  (safe, because orders are claimed atomically, but wasteful). Phase 5 moves it to a queue.
- Reports and exports, invoices, stock levels and route planning are not part of this phase.

