# Realtime

> Status: **implemented in Phase 4 (Field Operations)**; automated tests exist, not yet run
> or verified on a device (see [phase-status.md](phase-status.md#phase-4--field-operations)).

FieldOps pushes **hints** to connected apps over WebSockets: "job X changed", "job X has a new
message". A hint makes the app look again through its normal path. It never carries data the
app would store.

```text
PostgreSQL   authoritative state
SQLite       the worker's local state (converges through sync)
WebSocket    "something changed, look again" (may be missed; that is fine)
FCM          the same kind of hint, for apps that are not connected
```

## Why hints and not data

A WebSocket event can be lost: the phone is offline, the app is in the background, the
server restarts between the commit and the emit. If the app treated events as data, every
loss would be a divergence. Because it treats them as hints, a lost event only delays an
update until the next sync, which runs anyway on app start, foreground, reconnection and
every local command.

```text
worker offline ─▶ manager reassigns a job ─▶ event to the worker is lost
       │
worker reconnects ─▶ realtime "connected" ─▶ app runs a sync ─▶ working set without the job
                                                             ─▶ SQLite converges
```

This exact scenario is an E2E test (`apps/api/test/realtime.e2e-spec.ts`, "recovers missed
events through sync").

## Server

`apps/api/src/realtime/`: a NestJS gateway on Socket.IO (the decision recorded in
[technology-decisions.md](technology-decisions.md#websockets-socketio-through-nestjs-gateways)),
on the API's own port at path **`/realtime`**, **WebSocket transport only** (no long polling,
so no sticky sessions), `maxHttpBufferSize` 4 KB (clients send nothing).

```text
JobsService (after commit) ──publish──▶ DomainEvents ──▶ RealtimeGateway ──▶ rooms
AuthService.logout        ──publish──▶ session.ended ──▶ disconnect that session's sockets
```

Publishers do not know about the gateway: jobs publish domain events
(`src/events/domain-events.ts`), the gateway and the notifications module subscribe. The bus is
in-process and not durable; Phase 5 moves it to a transactional outbox with BullMQ, and
Redis-backed Socket.IO fan-out when the API runs on more than one instance.

## Authentication

- The client sends the **access token** in the Socket.IO handshake (`auth: { token }`).
- The gateway's middleware runs `AccessTokenVerifier.verify`: the same JWT checks as HTTP
  (HS256 only, issuer, audience, expiry) **and** the same session checks (session exists,
  belongs to the user, not revoked or expired, user active; role from the database). There is
  no second authentication mechanism.
- Refusals reach the client as `connect_error` with the message `UNAUTHENTICATED`,
  `ACCESS_TOKEN_EXPIRED`, `ACCESS_TOKEN_INVALID`, `SESSION_REVOKED`, `SESSION_EXPIRED` or
  `ACCOUNT_DISABLED`.
- A connection lives **at most until its access token expires** (15 minutes by default): the
  gateway disconnects it then, and the client reconnects with a refreshed token. A revoked
  session or changed role therefore takes effect on open sockets within one token lifetime.
- **Signing out closes the session's sockets immediately** (`session.ended` event).

## Authorization (who receives what)

`src/realtime/realtime-audience.ts` (pure, unit-tested), derived from the job policy:

| Room | Joined by |
| --- | --- |
| `user:<userId>` | every connection |
| `session:<sessionId>` | every connection (used to close them on sign-out) |
| `managers` | users with `job:read:all` (MANAGER, ADMIN; single organization, see phase-status) |

| Event | Recipients |
| --- | --- |
| `job.changed` | `managers` + the job's assigned worker |
| `job.changed` with `change: "unassigned"` | only the worker a job was taken from (no status) |
| `job.message.created` | `managers` + the job's assigned worker |

A worker never receives a hint about a job they could not read through REST. Clients cannot
join rooms or send events; the gateway has no message handlers.

## Event contract

Types: `packages/types/src/realtime.ts`. Every event is emitted under the Socket.IO event name
`event`, in this envelope:

```json
{
  "id": "0192…",            // UUIDv7, unique per event: clients drop duplicates
  "type": "job.changed",
  "version": 1,             // payload schema version for this type
  "occurredAt": "2026-09-27T10:40:00.000Z",
  "data": { "jobId": "…", "change": "started", "status": "IN_PROGRESS", "version": 3 }
}
```

| Type | `data` | Sent when | Persisted? | Offline implication |
| --- | --- | --- | --- | --- |
| `job.changed` | `jobId`, `change` (`assigned`, `updated`, `started`, `completed`, `cancelled`, `note`, `evidence`), `status`, `version` | Any committed job change, including commands replayed from a phone's outbox | No (the change itself is in PostgreSQL) | Missed events are covered by the next sync |
| `job.changed` | `jobId`, `change: "unassigned"` | Reassignment, to the previous worker | No | The next working set drops the job |
| `job.message.created` | `jobId`, `messageId` | A job message was stored | The message is (`job_messages`) | Messages arrive with the working set |

Payloads never contain job titles, customers, addresses or message text.

## Client

`apps/mobile/src/services/realtime/`: `RealtimeClient` wraps `socket.io-client` (the only
importer, enforced by ESLint); `realtimeEvents.ts` validates envelopes and deduplicates IDs.
`app/providers/RealtimeConnection.tsx` owns one client per signed-in user.

| State | Meaning |
| --- | --- |
| `connecting` → `connected` | Handshake accepted; the app **resyncs** (worker: sync engine; everyone: refetch online data) |
| `reconnecting` | Connection lost or server unreachable: Socket.IO retries with jittered exponential backoff, 1 s up to 30 s |
| token expired | One session refresh (through the API layer's shared refresh), then reconnect; a second refusal in a row gives up |
| `unauthorized` | The server refused the session: stop (the API layer signs the user out) |
| `stopped` | App in the background, phone offline, or signed out: no socket at all |

Reconnection is bounded (30 s maximum delay, jitter, paused offline and in the background),
so a dead server does not cause a tight loop or battery drain.

On an event: the worker's sync engine runs (it coalesces bursts into one more cycle) and the
affected RTK Query tags are invalidated (managers' job screens, the notification inbox).

## Tests

- `apps/api/src/realtime/realtime-audience.spec.ts`: rooms and recipients, no content leak.
- `apps/api/test/realtime.e2e-spec.ts` (real Socket.IO client): refusal without/with a bad
  token and after sign-out; delivery to managers and the assigned worker only; unassignment
  hint; message events; sign-out closes the socket; missed events recovered through sync.
- `apps/mobile/src/services/realtime/realtimeClient.test.ts`: status machine, token refresh
  once, give-up rules, reconnect after a server close, duplicate and malformed events.
