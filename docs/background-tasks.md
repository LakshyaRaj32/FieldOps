# Background tasks (BullMQ)

Phase 5.3 ([master-development-plan.md](master-development-plan.md)). Work that shouldn't run
in an HTTP request, or that runs on a schedule, goes through BullMQ queues in Redis.

**Naming.** BullMQ calls its work items "jobs", but the business domain already has jobs (field
operations). In this codebase they are called **tasks**.

```text
API (any instance) ──enqueue──▶ Redis queue ──▶ worker (instances with WORKERS_ENABLED)
                                    │
                         fails for good ──▶ dead-letter queue
```

Code: `apps/api/src/queue/background-tasks.service.ts`.

## Using it

A module defines its tasks in `onModuleInit`, and anything can enqueue them:

```ts
this.tasks.define<PushTask>({
  name: 'push.send',          // unique, dot-separated
  queue: 'notifications',     // 'notifications' | 'maintenance'
  attempts: 5,                // tries in total; retries back off exponentially
  everyMs: undefined,         // set to run on a schedule instead
  run: task => this.sendPush(task),
});

await this.tasks.enqueue('push.send', data, { id: 'push.<n>.<d>', priority: 1 });
```

Rules for a task's `run`:

- **It must be idempotent.** Delivery is at-least-once: a worker can stop after doing the work
  but before BullMQ records it, and the task then runs again.
- **Data holds IDs, not content.** Read the current state when the task runs. Task data sits
  in Redis, and the state may change in between (a push token rotates, a session ends).
- **Throw to retry.** Throw `PermanentTaskError` when retrying can't help (bad input).

## Queues and tasks

| Task | Queue | Trigger | Attempts | Notes |
| --- | --- | --- | --- | --- |
| `push.send` | notifications (concurrency 10) | Each new notification, once per active device | 5 | ID `push.<notificationId>.<deviceId>` (never sent twice). Overdue reminders get priority 5, live operations 1. FCM `failed` is retried; `invalid_token` removes the registration |
| `payments.overdue-scan` | maintenance (concurrency 1) | Every `OVERDUE_SCAN_INTERVAL` | 1 | The next tick picks up what this one missed. Each order is claimed in SQL, so it is notified once |
| `sessions.purge-expired` | maintenance | Daily | 3 | Sessions that expired more than one refresh-token lifetime ago, deleted in batches of 1,000 |
| `sync.purge-processed-mutations` | maintenance | Daily | 3 | Device command keys older than 90 days ([synchronization.md](synchronization.md)) |

## Reliability

| Concern | How it is handled |
| --- | --- |
| Retries | Exponential backoff from `QUEUE_RETRY_DELAY` (default 5 s: 5, 10, 20, 40 s for a push) |
| Failed for good | Copied to the `dead-letter` queue with queue, name, data, error and attempts. BullMQ also keeps the failed task for 7 days |
| Duplicates | A task enqueued again with the same `id` is ignored while BullMQ keeps the first (completed tasks: 1 hour) |
| Scheduling | BullMQ job schedulers live in Redis, so each tick runs on one instance however many run. Re-applied whenever Redis (re)connects; a schedule that is turned off (`everyMs` 0) is removed |
| Redis down | Enqueueing gives up after 2 s and runs the task inline, once, without retry: the behaviour before queues. If the add lands later anyway, the task runs twice, which idempotency covers |
| No Redis at all | Tasks run inline and schedules use in-process timers (as before Phase 5) |
| Shutdown | Workers finish their current task (up to 10 s, then a forced close) |
| Startup | Never waits for Redis |

**Known gap.** Domain events are still published in-process after the commit
([domain-events.ts](../apps/api/src/events/domain-events.ts)). If the process dies between a
commit and its event handler, that notification is lost. The inbox, realtime and sync still
converge, but closing the gap needs a transactional outbox (planned with 5.4 reliability).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `REDIS_URL` | empty | Queues need Redis; without it, tasks run inline |
| `WORKERS_ENABLED` | `true` | `false` on instances that should only serve HTTP while a separate worker process runs the tasks |
| `QUEUE_RETRY_DELAY` | `5s` | First retry delay; each further retry doubles it |
| `OVERDUE_SCAN_INTERVAL` | `1h` | Period of the overdue scan, or `off` |

Queue keys use `<REDIS_KEY_PREFIX>bull` (BullMQ does not support ioredis's `keyPrefix`, so
the queues use their own connections).

On Render's free plan, the workers run inside the API process. To split them later, run a
second instance with `WORKERS_ENABLED=true` and set it to `false` on the web service.

## Inspecting

Every queue handle is available as `BackgroundTasks.queue(name)` (counts, failed tasks,
schedulers). Dead letters wait in the `dead-letter` queue, which has no worker. Re-enqueue
one by hand once its cause is fixed. Queue metrics (depth, processing time) are part of
5.5 observability.

## Tests

`apps/api/test/queue.e2e-spec.ts` runs against Redis and is skipped without
`TEST_REDIS_URL`. It covers retries with backoff, dead-lettering, permanent failures,
deduplication, the registered schedules, and push retries and invalid tokens end to end.
The rest of the E2E suite runs pushes through the workers when Redis is set, and inline
otherwise.
