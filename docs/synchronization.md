# Synchronization Architecture

> Status: **design (Version 0).** Implemented in **V6** (custom sync engine). It relies on
> V5 (local SQLite) and is hardened further in V13 (idempotency, locks, reliability).
> The device-side principles are in [offline-first.md](offline-first.md).

FieldOps implements its **own** synchronization engine. It sits on established infrastructure
(SQLite, PostgreSQL, HTTPS) but the protocol, outbox, conflict policies and retry strategy are
FieldOps-specific. We build it ourselves because sync correctness depends on the domain (job
state machines, assignment rules, append-only evidence), and generic sync frameworks either
hide those decisions or dictate the data model.

## Goals

1. **No lost writes.** Work committed on the device eventually reaches the server, or ends up
   in an explicit, user-visible "needs attention" state. It is never silently dropped.
2. **Exactly-once effect.** Retries, duplicate deliveries and lost responses never cause
   duplicate server-side effects.
3. **Convergence.** After a successful push and pull, the device's working set matches the
   server's view of what that user may see.
4. **Correct under unreliable networks.** Timeouts, partial failures, reordering of retries,
   app kills mid-sync and long offline periods (days) are all normal cases.
5. **Bounded and efficient.** Batched requests, incremental pulls and small payloads, so
   battery and data use stay reasonable.
6. **Authorized.** Every mutation is authorized on the server individually, as if it were a
   direct API call.

## Non-goals

- A general-purpose CRDT or multi-master replication. The server is authoritative.
- Peer-to-peer device sync.
- Real-time collaborative editing of the same field by multiple users.
- Synchronizing the entire organization's data to every device. Devices get a scoped working
  set.

## Overview

```text
 DEVICE                                                    SERVER
 ┌───────────────────────────┐                          ┌────────────────────────────────┐
 │ domain tables   outbox    │   POST /api/v1/sync/push │ for each mutation:             │
 │   (SQLite)     (SQLite)───┼─────────────────────────▶│   authorize → dedupe (idem.)   │
 │                           │◀─────────────────────────┼─  → apply in txn → change_log  │
 │                           │    per-mutation results  │                                │
 │ pull cursor               │   GET /api/v1/sync/pull  │ changes since cursor, filtered │
 │   (SQLite) ───────────────┼─────────────────────────▶│ to what this user may see      │
 │ apply changes in txn ◀────┼──────────────────────────┤  (+ tombstones, revocations)   │
 └───────────────────────────┘    changes + new cursor  └────────────────────────────────┘
          ▲                                                        │
          │  WebSocket "sync.hint" / FCM data message (V8/V9)      │
          └────────────────────────────────────────────────────────┘
```

A sync **cycle** runs in this order: refresh the session if needed → **push** the outbox →
**pull** changes → apply locally. Pushing first means the pull reflects the server's handling of
the device's own changes.

## Identifiers

- Every entity and every mutation uses a **UUIDv7** generated on the device when it is created
  there.
- Because IDs are generated on the client, offline-created records (a job note, a photo, a
  message) keep the same ID forever. There is no temporary-ID remapping.
- `mutationId` doubles as the **idempotency key** for that mutation.

## The outbox (device)

Conceptual schema (finalized in V5–V6):

| Column | Purpose |
| --- | --- |
| `mutation_id` (PK, UUIDv7) | Idempotency key; time-ordered |
| `type` | Command name, for example `job.start`, `job.complete`, `job.note.add`, `message.send` |
| `entity_type`, `entity_id` | The aggregate this mutation targets (used for ordering and blocking) |
| `payload` (JSON) | Command data, validated against the shared schema for `type` |
| `base_version` (nullable) | The entity version the user saw, for commands that need a concurrency check |
| `occurred_at` | Device time of the user action (informational, not trusted for ordering) |
| `depends_on` (nullable) | Another mutation or upload that must complete first (for example, a photo upload) |
| `status` | `pending` · `in_flight` · `applied` · `rejected` |
| `attempts`, `next_attempt_at`, `last_error` | Retry bookkeeping |
| `protocol_version` | The schema version the payload was written with |

### Mutation lifecycle

```text
            enqueue (same txn as domain change)
                         │
                         ▼
     ┌────────────▶  pending  ──── selected for batch ───▶  in_flight
     │                   ▲                                     │
     │  retryable failure│                                     │ server result
     │  (network, 5xx,   │                                     ├── applied  ──▶ applied (then pruned)
     │  429, timeout)    │                                     ├── duplicate ─▶ applied (idempotent replay)
     │  backoff → next_  │                                     ├── conflict  ─▶ resolved per policy
     │  attempt_at       │                                     │                (applied / rejected)
     └───────────────────┘                                     └── rejected  ──▶ rejected (needs attention)
```

- On app start, any `in_flight` entries are reset to `pending`. The previous attempt may or
  may not have reached the server, and idempotency makes retrying safe.
- `rejected` entries are **not deleted**. They are shown to the user with a reason, and the
  local domain state is reconciled (see [Conflict resolution](#conflict-resolution)).

## Push protocol

```http
POST /api/v1/sync/push
Authorization: Bearer <access token>
Content-Type: application/json
```

```json
{
  "protocolVersion": 1,
  "deviceId": "0190c3a2-...",
  "mutations": [
    {
      "mutationId": "0190c3b1-7a2e-7cc1-9f00-3b1d2e4f5a60",
      "type": "job.start",
      "entityType": "job",
      "entityId": "0190c0aa-...",
      "baseVersion": 7,
      "occurredAt": "2026-09-26T08:14:03.120Z",
      "payload": {}
    }
  ]
}
```

```json
{
  "results": [
    { "mutationId": "0190c3b1-...", "status": "applied", "entityVersion": 8 },
    { "mutationId": "0190c3b2-...", "status": "duplicate", "entityVersion": 8 },
    { "mutationId": "0190c3b3-...", "status": "rejected", "code": "JOB_REASSIGNED",
      "message": "Job is no longer assigned to you." }
  ],
  "serverTime": "2026-09-26T09:02:11.004Z"
}
```

(The JSON above is illustrative. The exact schemas are defined in `@fieldops/shared` in V6.)

### Server processing

For each mutation, in the order the device sent them:

1. **Validate** the payload against the schema for `type` and `protocolVersion`.
2. **Authorize** using the same policy as the equivalent direct API command. For example,
   `job.start` requires that the caller is currently assigned to the job and that it belongs to
   their organization.
3. **Deduplicate.** Look up `(userId, mutationId)` in `processed_mutations`. If it exists,
   return the stored result (`duplicate`) without re-applying.
4. **Apply in one Postgres transaction:**
   - run the domain command (state-machine check, conflict policy),
   - increment the entity `version`,
   - insert into `change_log` (for pull),
   - insert into `processed_mutations` with the result,
   - insert an audit log entry where relevant,
   - insert server-side outbox events for side effects (notify manager, WebSocket broadcast;
     delivered through queues from V12/V13).
5. **Commit.** A unique constraint on `processed_mutations (user_id, mutation_id)` guarantees
   that two concurrent retries of the same mutation cannot both apply.

Results are per mutation. One rejected mutation does not fail the batch, **except** that later
mutations on the **same entity** that depend on a rejected one are also rejected with
`BLOCKED_BY_PREVIOUS` rather than applied out of context.

`processed_mutations` rows are retained long enough to outlive any realistic offline period
(for example 90 days, configurable), then pruned.

## Pull protocol

```http
GET /api/v1/sync/pull?cursor=<opaque>&limit=500
```

- The server keeps a `change_log` with a **monotonically increasing sequence** (`bigserial`)
  that is written in the same transaction as every change. The cursor encodes the last sequence
  the device has applied.
- **Sequences, not timestamps.** Timestamp cursors miss rows that commit out of order or share
  a timestamp, and they depend on clocks. Sequence cursors don't have these problems. (Commit-order
  gaps from concurrent transactions are handled by only exposing sequences below the oldest
  in-progress transaction's sequence; the exact mechanism is designed in V6.)
- The server **filters by visibility**. A worker receives changes only for jobs assigned to
  them, their own messages, and organization reference data.
- **Visibility changes are first-class:**
  - *Gained access* (a new assignment): the response includes a **full snapshot** of the entity
    and its children, not only the latest change.
  - *Lost access* (reassigned or cancelled): the response includes a **revoke** entry. The
    device removes the entity locally **unless** it has pending outbox entries for it, in which
    case those resolve first (see conflict policies).
- **Deletes are tombstones** in the change log, so devices learn about them.
- The response contains `changes`, `nextCursor` and `hasMore`. The device applies each page in
  one SQLite transaction and stores the new cursor in the **same** transaction. A crash
  therefore replays at most one page, and applying changes is idempotent.
- **Resync.** If the cursor is older than the change log's retention, or the protocol version
  changed incompatibly, the server responds with `RESYNC_REQUIRED`. The device then
  downloads a fresh snapshot of its working set **while preserving its outbox**, and pushes
  the outbox again afterwards.

### Applying pulled changes with a pending outbox

If a pulled change touches an entity that still has `pending` local mutations, the device
applies the server state and then **re-applies its pending commands locally** on top (a local
rebase), so the UI keeps showing the user's intended state until the server rules on it. This
is safe because outbox entries are commands, not snapshots.

## Conflict resolution

Conflicts are handled **per data type** with explicit policies. The data model is designed so
that most worker writes cannot conflict at all.

| Data | Nature | Policy |
| --- | --- | --- |
| Job events: notes, photos, checklist results, readings | Append-only | **No conflict.** Always appended, ordered by server receipt with `occurredAt` kept for display |
| Location points | Append-only telemetry | **No conflict.** Deduplicated by point ID |
| Messages | Append-only | **No conflict.** Deduplicated by message ID |
| Job status (start/pause/complete) | State machine | **Server validates the transition** against the current state. Valid transitions apply even if `baseVersion` is stale, because the state machine is the arbiter, not the version number |
| Job assignment | Manager-authoritative | **Server wins.** A worker mutation on a job no longer assigned to them is rejected with `JOB_REASSIGNED`. Its append-only evidence (notes, photos) is still **accepted into the job history**, attributed to the worker, so field work is never lost |
| Job details edited by managers (address, description, schedule) | Manager-owned fields | Workers cannot edit these. For concurrent manager edits, **optimistic concurrency** (`baseVersion` check) returns `409 Conflict` to the online client, which refetches and retries |
| Job cancelled while worker completed it offline | Cross-role race | Completion is **recorded as an event**, the job stays cancelled, and the manager is notified to review. Policy is configurable per organization later |
| Reference data (templates, settings) | Server-owned | **Server wins.** Read-only on devices |

**Principles:**

- Never apply blind last-write-wins on whole rows. Device clocks are unreliable, and whole-row
  overwrites destroy information.
- The server decides. The device predicts optimistically and accepts the ruling.
- Every rejection has a machine-readable code and a human-readable explanation, and the user
  sees it.
- Field evidence is the most valuable data in the system. Policies prefer **keeping evidence
  with a flag** over rejecting it.

## Ordering and dependencies

- Mutations for the **same entity** are pushed and applied in outbox order (FIFO per entity).
- Mutations for **different entities** are independent. A stuck entity does not block others.
- **Binary uploads come first.** A mutation that references a photo (`job.attachment.add`) has
  `depends_on` pointing at the upload record. The photo uploads through a presigned URL
  (V9), and the mutation becomes eligible only after the upload is confirmed.
- **Location batches** travel on their own endpoint and queue (V7), so high-volume telemetry
  never delays job mutations.

## Retry and backoff

Implemented once in `@fieldops/shared` and used by both the mobile sync engine and server-side
workers.

- **Classification:**
  - Retryable: network error, timeout, `5xx`, `429` (respect `Retry-After`), `503` during
    deploys.
  - Needs re-authentication: `401` → refresh the session once, then retry. If the refresh fails,
    pause sync and require login (the outbox is preserved).
  - Permanent: `400`/`422` validation errors and `403` → mark `rejected`, surface to the user,
    and report to telemetry (it usually indicates a bug or a policy change).
  - Update required: `426` (unsupported protocol) → pause sync and prompt the user to update the
    app.
- **Exponential backoff with full jitter:**
  `delay = random(0, min(maxDelay, baseDelay × 2^attempt))`, for example base 1 s, cap 5 min.
  Jitter prevents a fleet of devices from reconnecting in lockstep after an outage (a thundering
  herd).
- Backoff state is **persisted** (`next_attempt_at`), so it survives app restarts.
- A connectivity-regained event or an explicit user "Sync now" may bring the next attempt
  forward but does not reset server-signaled `Retry-After`.

## Batching

- Push up to N mutations or M KB per request (initial values: 100 mutations or 256 KB).
- Pull pages of up to 500 changes.
- Location points are uploaded in batches (for example every 50 points or every 2 minutes,
  whichever comes first, adapted to battery and connectivity; designed in V7).
- Requests are gzip-compressed.

## Sync triggers

| Trigger | Version |
| --- | --- |
| App comes to foreground | V6 |
| Local mutation committed (debounced ~2 s) | V6 |
| Connectivity regained (NetInfo hint) | V6 |
| User pulls to refresh or taps "Sync now" | V6 |
| Periodic background work (WorkManager, with network constraint) | V7 |
| WebSocket `sync.hint` event while connected | V8 |
| FCM data message "you have changes" when not connected | V9 |

Only **one sync cycle runs at a time** per device (a single-flight guard). Additional triggers
while a cycle runs coalesce into at most one follow-up cycle.

## Failure scenarios

| Scenario | What happens | Why it is correct |
| --- | --- | --- |
| Request times out, but the server applied it | Entry returns to `pending`; the retry is deduplicated and returns `duplicate` with the same result | `processed_mutations` unique key |
| App killed while a push is in flight | On restart, `in_flight` → `pending` and the push is retried | Idempotent server |
| App killed while applying a pull page | Page transaction rolls back; cursor unchanged; page is re-fetched | Cursor stored in the same transaction |
| Two retries of the same mutation arrive concurrently | One commits, the other hits the unique constraint → `duplicate` | Database-enforced |
| Worker offline for 5 days, job reassigned meanwhile | Status mutations rejected with `JOB_REASSIGNED`; notes and photos kept in the job history; the job is revoked from the device after the outbox resolves | Assignment is manager-authoritative; evidence preserved |
| Device clock is 3 hours wrong | Ordering uses server sequence; `occurredAt` shown with a "device time" caveat if implausible | Clocks never used for correctness |
| Server rejects a mutation due to a bug | Entry `rejected`, visible to the user, reported to telemetry; not retried forever | Permanent failures are not retried |
| Refresh token revoked while offline | Sync pauses, login required, outbox preserved and pushed after login | Never discard unsynced work |
| Old app version after a protocol change | Server supports N−1; beyond that returns `426`; outbox preserved until the app updates | Explicit versioning |
| Change-log retention exceeded | `RESYNC_REQUIRED` → snapshot while preserving outbox | Bounded server storage, safe recovery |

## Observability (V15)

- **Device:** outbox depth, age of the oldest pending entry, sync cycle duration, failure
  counts by classification, rejected count. Reported with anonymized telemetry and crash
  reports.
- **Server:** push and pull latency, mutations per second, duplicate rate (a high rate means
  clients retry too aggressively), rejection rate by code, conflict rate by policy,
  change-log lag.
- Every push carries a request ID that links device logs, server logs and audit entries.

## Testing strategy

- **Protocol unit tests** for the shared state machine, backoff and schema validation.
- **Server integration tests** against real PostgreSQL: concurrent duplicate submissions,
  visibility changes, tombstones, `RESYNC_REQUIRED`.
- **Deterministic fault-injection tests** for the device sync engine with a simulated transport
  that drops requests, drops responses, delays, duplicates and returns partial batch results.
  Assert the invariants: no lost writes, no duplicate effects, eventual convergence.
- **Property-based tests** (V13): random sequences of offline actions, manager actions and
  network faults must always converge to a consistent state.
