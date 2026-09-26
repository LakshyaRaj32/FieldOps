import type {
  AddJobNoteRequest,
  JobDetail,
  JobWorkingSet,
} from '@fieldops/types';

import type { AppError } from '../../../utils/errors';
import type { LocalJobStore } from './localJobStore';
import {
  backoffDelayMs,
  classifyFailure,
  RETRY_POLICY,
  type RetryPolicy,
} from './retryPolicy';
import type { OutboxEntry } from './types';

export type TransportResult<Data> =
  | { readonly data: Data }
  | { readonly error: AppError };

/**
 * The server calls the engine needs. The app implements it with the API client (auth,
 * token refresh, error mapping); tests use a fake server with fault injection.
 */
export interface JobSyncTransport {
  startJob(
    jobId: string,
    mutationId: string,
  ): Promise<TransportResult<JobDetail>>;
  completeJob(
    jobId: string,
    mutationId: string,
  ): Promise<TransportResult<JobDetail>>;
  addNote(
    jobId: string,
    mutationId: string,
    note: AddJobNoteRequest,
  ): Promise<TransportResult<JobDetail>>;
  fetchWorkingSet(): Promise<TransportResult<JobWorkingSet>>;
}

/**
 * - `idle`: the last cycle reached the server and finished
 * - `syncing`: a cycle is running
 * - `offline`: the last cycle could not reach the server
 * - `error`: the server refused the session or failed the download
 */
export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly pending: number;
  readonly failed: number;
  readonly conflicts: number;
  /** ISO time of the last complete cycle (push and download). */
  readonly lastSyncedAt: string | null;
}

export interface Timers {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface JobSyncEngineOptions {
  readonly store: LocalJobStore;
  readonly transport: JobSyncTransport;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly timers?: Timers;
  readonly policy?: RetryPolicy;
}

type StepOutcome = 'done' | 'offline' | 'unauthenticated' | 'error';

const LAST_SYNCED_AT = 'last_synced_at';
const SYNCED_RETENTION_MS = 7 * 86_400_000;

/**
 * Drains the outbox and refreshes the working set. One cycle:
 *
 * 1. recover entries left in flight by a killed app (safe: the server deduplicates)
 * 2. push pending entries in outbox order; a job whose entry is waiting for a retry holds
 *    back its later entries, other jobs continue
 * 3. download the working set and store it as the new server copy (only when the push
 *    finished, so the snapshot includes the server's handling of this device's commands)
 * 4. schedule the next attempt: the earliest retry, or a backoff while offline
 *
 * Only one cycle runs at a time; requests during a cycle coalesce into one more cycle. The
 * outcome of a request, not the device's connectivity flag, decides what happens: NetInfo
 * may report Wi-Fi behind a captive portal.
 */
export class JobSyncEngine {
  private readonly store: LocalJobStore;
  private readonly transport: JobSyncTransport;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly timers: Timers;
  private readonly policy: RetryPolicy;
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private readonly unsubscribeStore: () => void;

  private current: SyncStatus = {
    phase: 'idle',
    pending: 0,
    failed: 0,
    conflicts: 0,
    lastSyncedAt: null,
  };
  private running: Promise<SyncStatus> | null = null;
  private again = false;
  private offlineStreak = 0;
  private timer: unknown = null;
  private disposed = false;

  constructor({
    store,
    transport,
    now = () => new Date(),
    random = Math.random,
    timers = {
      set: (callback, delayMs) => setTimeout(callback, delayMs),
      clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    policy = RETRY_POLICY,
  }: JobSyncEngineOptions) {
    this.store = store;
    this.transport = transport;
    this.now = now;
    this.random = random;
    this.timers = timers;
    this.policy = policy;
    // Local commands change the counts too.
    this.unsubscribeStore = store.subscribe(() => {
      this.refreshCounts().catch(() => undefined);
    });
  }

  status(): SyncStatus {
    return this.current;
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Runs a cycle now, or once more after the running one. Never rejects. */
  sync(): Promise<SyncStatus> {
    if (this.disposed) {
      return Promise.resolve(this.current);
    }
    if (this.running !== null) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.cycle();
        } while (this.again && !this.disposed);
      } finally {
        this.running = null;
      }
      return this.current;
    })();
    return this.running;
  }

  /** Resolves when no cycle is running (for example before the database is closed). */
  async whenIdle(): Promise<void> {
    await this.running;
  }

  /** Stops timers and listeners (sign-out). A running cycle finishes on its own. */
  dispose(): void {
    this.disposed = true;
    this.unsubscribeStore();
    this.listeners.clear();
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
  }

  private async cycle(): Promise<void> {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
    this.update({ phase: 'syncing' });
    let outcome: StepOutcome;
    try {
      await this.store.recoverInFlight();
      outcome = await this.push();
      if (outcome === 'done') {
        outcome = await this.pull();
      }
      await this.store.pruneSynced(
        new Date(this.now().getTime() - SYNCED_RETENTION_MS),
      );
    } catch {
      // A local database failure: nothing was lost (every step is a transaction). Try again
      // later like any other failure.
      outcome = 'error';
    }

    this.offlineStreak = outcome === 'offline' ? this.offlineStreak + 1 : 0;
    const lastSyncedAt = await this.store.getMeta(LAST_SYNCED_AT);
    await this.refreshCounts({
      phase:
        outcome === 'done'
          ? 'idle'
          : outcome === 'offline'
          ? 'offline'
          : 'error',
      lastSyncedAt,
    });
    await this.scheduleNext(outcome);
  }

  private async push(): Promise<StepOutcome> {
    const entries = await this.store.pendingEntries();
    const heldBack = new Set<string>();
    const now = this.now().getTime();

    for (const entry of entries) {
      if (heldBack.has(entry.jobId)) {
        continue;
      }
      if (
        entry.nextAttemptAt !== null &&
        Date.parse(entry.nextAttemptAt) > now
      ) {
        // Not due yet; later commands for the same job must not overtake it.
        heldBack.add(entry.jobId);
        continue;
      }

      await this.store.markInFlight(entry.seq);
      const result = await this.send(entry);
      if ('data' in result) {
        await this.store.markSynced(entry.seq, result.data);
        continue;
      }

      const error = {
        code: errorCode(result.error),
        message: result.error.message,
      };
      switch (classifyFailure(result.error)) {
        case 'offline':
          await this.store.markRetry(entry.seq, {
            attempts: entry.attempts,
            nextAttemptAt: null,
            error,
          });
          return 'offline';
        case 'unauthenticated':
          await this.store.markRetry(entry.seq, {
            attempts: entry.attempts,
            nextAttemptAt: null,
            error,
          });
          return 'unauthenticated';
        case 'retryable': {
          const attempts = entry.attempts + 1;
          if (attempts >= this.policy.maxAttempts) {
            // Out of retries: dead letter. The worker can retry it by hand.
            await this.store.markRejected(entry.seq, 'failed', error, attempts);
          } else {
            await this.store.markRetry(entry.seq, {
              attempts,
              nextAttemptAt: new Date(
                now + backoffDelayMs(attempts, this.random, this.policy),
              ),
              error,
            });
            heldBack.add(entry.jobId);
          }
          break;
        }
        case 'conflict':
          // The server state wins. Later commands for the job are still sent: the server
          // judges each against its current state (a note is still accepted, a completion
          // of a cancelled job is not).
          await this.store.markRejected(entry.seq, 'conflict', error);
          break;
        case 'rejected':
          await this.store.markRejected(entry.seq, 'failed', error);
          break;
      }
    }
    return 'done';
  }

  private send(entry: OutboxEntry): Promise<TransportResult<JobDetail>> {
    switch (entry.type) {
      case 'job.start':
        return this.transport.startJob(entry.jobId, entry.mutationId);
      case 'job.complete':
        return this.transport.completeJob(entry.jobId, entry.mutationId);
      case 'job.note.add':
        return this.transport.addNote(entry.jobId, entry.mutationId, {
          id: entry.payload?.noteId ?? entry.mutationId,
          body: entry.payload?.body ?? '',
          occurredAt: entry.occurredAt,
        });
    }
  }

  private async pull(): Promise<StepOutcome> {
    const result = await this.transport.fetchWorkingSet();
    if ('error' in result) {
      const kind = classifyFailure(result.error);
      return kind === 'offline' || kind === 'unauthenticated' ? kind : 'error';
    }
    await this.store.applyWorkingSet(result.data);
    await this.store.setSyncMeta(LAST_SYNCED_AT, this.now().toISOString());
    return 'done';
  }

  private async scheduleNext(outcome: StepOutcome): Promise<void> {
    if (this.disposed) {
      return;
    }
    let delay: number | null = null;
    if (outcome === 'offline' || outcome === 'error') {
      // Probe again with growing gaps; connectivity and foreground events retry sooner.
      delay = Math.max(
        this.policy.baseDelayMs,
        backoffDelayMs(this.offlineStreak + 1, this.random, this.policy),
      );
    } else if (outcome === 'done') {
      const due = (await this.store.pendingEntries())
        .map(entry =>
          entry.nextAttemptAt === null ? 0 : Date.parse(entry.nextAttemptAt),
        )
        .sort((a, b) => a - b)[0];
      if (due !== undefined) {
        delay = Math.max(0, due - this.now().getTime());
      }
    }
    if (delay !== null) {
      this.timer = this.timers.set(() => {
        this.timer = null;
        this.sync().catch(() => undefined);
      }, delay);
    }
  }

  private async refreshCounts(
    changes: Partial<SyncStatus> = {},
  ): Promise<void> {
    const counts = await this.store.counts();
    this.update({ ...counts, ...changes });
  }

  private update(changes: Partial<SyncStatus>): void {
    this.current = { ...this.current, ...changes };
    for (const listener of this.listeners) {
      listener(this.current);
    }
  }
}

function errorCode(error: AppError): string {
  return (
    error.code ??
    (error.status !== undefined
      ? `HTTP_${error.status}`
      : error.kind.toUpperCase())
  );
}
