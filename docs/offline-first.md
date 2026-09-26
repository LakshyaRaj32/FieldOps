# Offline-First Architecture

> Status: **implemented in Phase 3 (Offline-First)** for the worker's job workflow. The first
> section is what is built; the rest is the original design, still the target for later
> phases (photos, location, messages). The sync protocol is in
> [synchronization.md](synchronization.md).

## As built in Phase 3

### What works offline

| Capability | Offline | How |
| --- | :---: | --- |
| Worker: see assigned jobs (list, details, checklist, history, notes) | ✅ | Read from SQLite; downloaded while online |
| Worker: start a job, complete it, add field notes | ✅ | Local command + outbox entry in one SQLite transaction |
| Worker: open the app with no network | ✅ | Session restored from secure storage (V2), database opened, jobs shown |
| Worker: pending changes survive a force close or reboot | ✅ | Outbox in SQLite; in-flight entries recovered on start |
| Worker: see what is unsynced and what was rejected | ✅ | Global banner, per-job badges, Profile › Offline sync |
| Receive new assignments | ❌ | Arrive with the next sync (foreground, reconnect, pull to refresh) |
| Managers and admins (create, assign, edit, cancel, monitor) | ❌ | Online by design; manager screens use RTK Query |
| Photos, signatures, location, messages | ❌ | Phase 4 |

### Write path (as implemented)

```text
 "Start job"  (WorkerJobDetail)
   │
   ▼
 LocalJobStore.startJob(jobId)
   │  BEGIN
   │    read the job's local view; shared state machine: may it start? (else refuse, write nothing)
   │    INSERT outbox (mutation_id = UUIDv7, type job.start, status pending, base_version)
   │    recompute local_json = server_json + pending commands; UPDATE jobs
   │  COMMIT            ← both or neither (tested with an injected mid-transaction crash)
   │  notify subscribers → screens re-read SQLite
   ▼
 engine.sync()  (in the background; the UI never waits for it)
```

The worker's action is complete the moment the transaction commits. There are no spinners
for local writes, and nothing is lost if the app is killed straight after.

### Read path (as implemented)

- Worker screens (job list, details, dashboard) read **only** SQLite through
  `useLocalJobs` / `useLocalJob`, which re-run after every committed change, whether it came
  from the worker or from a sync.
- The network never bypasses the local database: sync results are written to SQLite first,
  and the UI updates from there.
- The two copies per job make convergence explicit: `server_json` is replaced by what the
  server sends (the server is the source of truth), `local_json` is always recomputed as the
  server copy plus the still-pending commands. SQLite never becomes an independent authority.

### Local database lifecycle

- **One file per user** (`fieldops-<userId>.sqlite`), opened at sign-in or session restore
  for workers. Another user signing in on the same phone never sees it.
- **Migrations:** schema version in `PRAGMA user_version`; each migration runs in one
  transaction with its version bump, before anything reads; a failure leaves the previous
  version (and the outbox) intact; a database newer than the app is refused. Adding a change
  means appending the next migration in `features/jobs/data/localSchema.ts`, never editing a
  released one. Current version: **1**.
- **Sign-out:** an explicit sign-out with nothing unsynced deletes the file. With unsynced
  changes the worker is warned, and the file is kept: the changes sync after the same worker
  signs in again. A session ended by the server (revoked, expired) always keeps the file.
- **Pruning:** jobs closed more than 7 days ago leave the working set (and the device) once
  nothing is pending for them; synced outbox entries are deleted after 7 days.

### Security of local data

- Tokens stay in the Android Keystore-backed credential store (V2). SQLite holds only job
  data and the outbox; nothing logs tokens, passwords or note contents.
- The database sits in the app's private storage. It is **not encrypted** yet: a rooted or
  forensically imaged phone could read the cached jobs (customer names, addresses, notes).
  Encryption at rest (SQLCipher-capable build, key in the Keystore) is part of Phase 5
  security hardening, as is a maximum offline session duration.
- Locally generated IDs use Math.random (uniqueness, not secrecy); the server authorizes
  every command regardless of IDs.

---

## Original design (V0)

### 1. What "offline-first" means in FieldOps

Offline is **the normal operating mode, not an error state.** Workers go into basements, rural
areas, elevators and hospitals. The app behaves as follows:

1. **Reads come from the device.** Screens show data from local SQLite. They never wait for a
   network response to render the worker's jobs.
2. **Writes go to the device first.** Every worker action commits locally and immediately.
   Synchronization happens later, in the background.
3. **The network is an optimization.** When it is available, local state converges with the
   server. When it is not, nothing the worker needs is blocked.
4. **Nothing is lost and nothing is duplicated.** Captured work survives app kills, reboots,
   token expiry and app updates, and reaches the server exactly once in effect.

"Online-first with a cache" is **not** the model. A cache is optional, whereas the local
database is authoritative for the device.

### 2. Capability matrix

| Capability | Offline | Notes |
| --- | :---: | --- |
| View assigned jobs and their details | ✅ | From SQLite |
| Start, pause or complete a job; update checklist | ✅ | Local command plus outbox entry |
| Add notes, readings, signatures | ✅ | Append-only events |
| Capture photos | ✅ | Stored on the device file system; uploaded later |
| Record location while on duty | ✅ | Native buffer and SQLite, uploaded in batches |
| Send messages | ✅ (queued) | Shown as "pending" until acknowledged |
| Receive new assignments or messages | ❌ | Arrives on the next sync, WebSocket event or push |
| Manager dashboards (all workers, live map) | ❌ | Online-only (RTK Query); shows staleness clearly |
| Log in for the first time on a device | ❌ | Requires the server |
| Continue working with an expired access token | ✅ | See section 8 |

### 3. Data classes on the device

| Class | Examples | Storage | Direction | Retention |
| --- | --- | --- | --- | --- |
| Reference data | Job types, checklist templates, org settings | SQLite | Server → device | Replaced on sync |
| Working set | Jobs assigned to the worker, their events and attachments metadata | SQLite | Both | Pruned after completion plus a grace period, once synced |
| User-generated data | Status changes, notes, checklist results, messages | SQLite (domain tables plus outbox) | Device → server | Kept until acknowledged, then subject to working-set pruning |
| Binary evidence | Photos, signatures | App-private file system; row in SQLite | Device → server | Deleted locally after confirmed upload plus a grace period |
| Telemetry | Location points | Native buffer, then SQLite | Device → server | Deleted after confirmed upload |
| Sync metadata | Outbox, pull cursor, last sync time, failure records | SQLite | Local only | Operational |
| Preferences | Filters, flags, device ID | MMKV | Local only | Persistent |
| Credentials | Refresh token, access token | Keystore-backed secure storage | Local only | Until logout or revocation |

### 4. The write path

Every user action that changes domain data follows the same path:

```text
 UI action ("Complete job")
   │
   ▼
 Local command handler (feature data layer)
   │  1. validate locally (shared state machine: is this transition allowed?)
   │  2. BEGIN SQLite transaction
   │       - apply change to domain tables (e.g. jobs.status = 'completed', insert job_event)
   │       - insert outbox entry { mutationId, type: 'job.complete', payload, ... }
   │     COMMIT
   │  3. notify observers of changed tables
   ▼
 UI re-renders from SQLite (optimistic, but durable: it is already committed locally)
   │
   ▼
 Sync engine (asynchronous) drains the outbox when connectivity allows
```

Key properties:

- **Atomicity.** A domain change without an outbox entry (or the reverse) is impossible,
  because both are in one transaction.
- **Durable optimism.** The optimistic UI state is not an in-memory guess that disappears when
  the app is killed. It is committed data, marked as pending sync.
- **Commands, not diffs.** The outbox records *intent* (`job.complete` with `occurredAt`), not
  "row X now equals Y". This is what makes server-side conflict handling tractable.

### 5. The read path

- Screens subscribe to **local queries**. When the data layer commits a change, whether from
  the user or from a sync pull, it notifies observers of the affected tables, and subscribed
  queries re-run.
- Screens never read domain entities from Redux or directly from network responses.
- Each record the user can see carries a **sync state** (`synced`, `pending`, `failed`) so the
  UI can show a subtle "pending" indicator and a clear "needs attention" state.

### 6. State layering on the device

| Layer | Holds | Technology | Survives restart? |
| --- | --- | --- | :---: |
| 1. UI state | Form inputs, modals, selection, scroll | Component state / Redux slices | ❌ |
| 2. Server state (online-only) | Dashboards, admin lists, search results | RTK Query cache | ❌ |
| 3. Persistent local application data | Jobs, events, attachments metadata, messages, reference data | SQLite | ✅ |
| 4. Offline mutations | Outbox entries | SQLite (same database, same transaction) | ✅ |
| 5. Synchronization state | Cursor, per-entry status, retry schedule, failure records; summary mirrored to Redux for display | SQLite (truth) + Redux (view) | ✅ / ❌ |
| 6. Native device capabilities | Location service, background work scheduling, permissions | Kotlin Turbo Modules, native buffer | ✅ (native) |

**Rules:**

- If losing it on restart would be a bug, it does not belong in layers 1–2.
- If it is high-volume (location points), it never goes through Redux.
- Redux may **mirror** summaries of durable state for display (for example "3 changes pending"),
  but SQLite remains the truth, and the mirror is rebuilt from SQLite on startup.

### 7. Connectivity

- **NetInfo is a hint, not the truth.** "Connected to Wi-Fi" often means a captive portal,
  or a link with 100% packet loss. The sync engine **attempts** requests and classifies the
  result. Successful requests are the only reliable proof of connectivity.
- Connectivity changes **trigger** sync attempts (debounced). They never gate the UI.
- Timeouts are short and explicit. A hung request must not block the outbox indefinitely.
- On metered or weak connections, the sync engine sends small payloads (mutations, location
  batches) before large ones (photos), and may postpone large uploads until Wi-Fi if the user
  allows it (V9).

### 8. Authentication while offline

- The access token will expire while the worker is offline. This **must not** block local
  work. Local actions don't need a valid access token, only a known, previously authenticated
  user on this device.
- When connectivity returns, the sync engine refreshes the session first, then drains the
  outbox.
- If the refresh token has been **revoked** (user disabled, device lost, password reset), the
  app requires re-authentication. The outbox is preserved: **unsynced work is never silently
  discarded**. After the same user logs in again, syncing resumes. If a *different* user logs
  in, the previous user's unsynced data is kept isolated and the situation is reported. It is
  not merged into the new user's data.
- An organization can configure a maximum offline session duration (V18) to limit the risk
  from lost devices.

### 9. Local storage lifecycle

- **Migrations.** The local SQLite schema is versioned and migrated forward on app start,
  inside a transaction, before the UI reads anything. Migrations are tested against snapshots
  of real older databases. A failed migration must never destroy the outbox.
- **Protocol compatibility.** Old app versions stay in the field. The server supports at least
  the current and previous sync protocol versions, and can tell a client "update required"
  without losing its pending outbox (see [synchronization.md](synchronization.md)).
- **Pruning.** Completed and synced jobs, uploaded photos and uploaded location points are
  pruned on a schedule to keep storage bounded. Pending data is never pruned.
- **Storage pressure.** The app monitors free space and warns before photo capture fails.

### 10. Security of local data

- The app-private storage sandbox is the baseline. Local database encryption (SQLCipher-capable
  build with a key held in the Android Keystore) is evaluated in V5 and enforced by V18.
- Logout clears local domain data only **after** the outbox has drained or the user
  explicitly confirms discarding it, with a clear warning.
- Tokens never go into SQLite, MMKV plaintext or logs.

### 11. UX principles

- Every user action gets immediate local feedback. There are no spinners for local writes.
- Pending state is visible but calm (for example a small clock icon). "Needs attention" is
  explicit and actionable ("This job was reassigned. Your notes were saved to the job
  history.").
- Global sync status is always available: last successful sync time, pending count and
  failures.
- Online-only screens clearly show when their data is stale or unavailable instead of
  failing silently.

### 12. Testing offline behavior

- Unit tests for local command handlers (domain change plus outbox entry in one transaction).
- Fault-injection tests for the sync engine: requests that time out, fail, succeed without
  the response arriving, or return partial batch results.
- Kill-and-restart tests: interrupt the app mid-transaction and mid-sync, then verify
  consistency on restart.
- Manual scenario scripts: airplane mode, captive portal, very slow network (Android emulator
  network throttling), token expiry while offline, app upgrade with a pending outbox.
