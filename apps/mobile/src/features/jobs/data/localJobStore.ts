import { nextStatus } from '@fieldops/shared';
import type {
  JobDetail,
  JobStatus,
  JobWorkingSet,
  UserSummary,
} from '@fieldops/types';

import {
  integer,
  optionalText,
  text,
  type SqlDatabase,
  type SqlRow,
  type SqlTransaction,
} from '../../../services/db/database';
import { uuidv7 } from '../../../utils/uuid';
import { isJobDetail } from '../api/contracts';
import { projectJob } from './projection';
import {
  LocalCommandError,
  type LocalJob,
  type NotePayload,
  type OutboxCounts,
  type OutboxEntry,
  type OutboxError,
  type OutboxType,
} from './types';

/** Outbox statuses that still change what the worker sees. */
const ACTIVE = "('pending', 'in_flight')";
/** Outbox statuses that need the worker's attention. */
const PROBLEM = "('failed', 'conflict')";

const JOB_COLUMNS = `local_json,
  (SELECT count(*) FROM outbox o WHERE o.job_id = jobs.id AND o.status IN ${ACTIVE}) AS pending_changes,
  (SELECT count(*) FROM outbox o WHERE o.job_id = jobs.id AND o.status IN ${PROBLEM}) AS problems`;

export interface LocalJobStoreOptions {
  readonly db: SqlDatabase;
  /** The signed-in worker (author of offline notes). */
  readonly me: UserSummary;
  readonly now?: () => Date;
}

function parseJob(json: string): JobDetail {
  const value: unknown = JSON.parse(json);
  if (!isJobDetail(value)) {
    throw new Error('Stored job does not match the job contract');
  }
  return value;
}

function toEntry(row: SqlRow): OutboxEntry {
  const code = optionalText(row, 'last_error_code');
  const payload = optionalText(row, 'payload');
  return {
    seq: integer(row, 'seq'),
    mutationId: text(row, 'mutation_id'),
    type: text(row, 'type') as OutboxType,
    jobId: text(row, 'job_id'),
    jobTitle: text(row, 'job_title'),
    payload: payload === null ? null : (JSON.parse(payload) as NotePayload),
    baseVersion: integer(row, 'base_version'),
    occurredAt: text(row, 'occurred_at'),
    status: text(row, 'status') as OutboxEntry['status'],
    attempts: integer(row, 'attempts'),
    nextAttemptAt: optionalText(row, 'next_attempt_at'),
    lastAttemptAt: optionalText(row, 'last_attempt_at'),
    lastError:
      code === null
        ? null
        : { code, message: optionalText(row, 'last_error_message') ?? '' },
    createdAt: text(row, 'created_at'),
  };
}

function toLocalJob(row: SqlRow): LocalJob {
  return {
    job: parseJob(text(row, 'local_json')),
    pendingChanges: integer(row, 'pending_changes'),
    problems: integer(row, 'problems'),
  };
}

/**
 * The worker's jobs and outbox in SQLite: the only code that touches these tables.
 *
 * Every write is one transaction that also recomputes the job's local view, so the view, the
 * server copy and the outbox can never disagree, even if the app is killed mid-write.
 * Listeners are told after each committed change, and screens re-read.
 */
export class LocalJobStore {
  private readonly db: SqlDatabase;
  private readonly me: UserSummary;
  private readonly now: () => Date;
  private readonly listeners = new Set<() => void>();

  constructor({ db, me, now = () => new Date() }: LocalJobStoreOptions) {
    this.db = db;
    this.me = me;
    this.now = now;
  }

  /** Called after every committed change. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async write<Result>(
    work: (tx: SqlTransaction) => Result,
  ): Promise<Result> {
    const result = await this.db.transaction(work);
    this.changed();
    return result;
  }

  // ---- Reads -------------------------------------------------------------------------

  async listJobs(
    statuses: readonly JobStatus[],
    order: 'asc' | 'desc',
  ): Promise<LocalJob[]> {
    const placeholders = statuses.map(() => '?').join(', ');
    const direction = order === 'asc' ? 'ASC' : 'DESC';
    const rows = await this.db.all(
      `SELECT ${JOB_COLUMNS} FROM jobs WHERE status IN (${placeholders})
       ORDER BY scheduled_at ${direction}, id ${direction}`,
      statuses,
    );
    return rows.map(toLocalJob);
  }

  async getJob(id: string): Promise<LocalJob | null> {
    const [row] = await this.db.all(
      `SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`,
      [id],
    );
    return row === undefined ? null : toLocalJob(row);
  }

  /** Entries still to send, in the order they must reach the server. */
  async pendingEntries(): Promise<OutboxEntry[]> {
    const rows = await this.db.all(
      "SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq",
    );
    return rows.map(toEntry);
  }

  /** Rejected entries the worker has not dismissed yet, oldest first. */
  async problemEntries(jobId?: string): Promise<OutboxEntry[]> {
    const rows = await this.db.all(
      `SELECT * FROM outbox WHERE status IN ${PROBLEM}
       ${jobId === undefined ? '' : 'AND job_id = ?'} ORDER BY seq`,
      jobId === undefined ? [] : [jobId],
    );
    return rows.map(toEntry);
  }

  async entry(seq: number): Promise<OutboxEntry | null> {
    const [row] = await this.db.all('SELECT * FROM outbox WHERE seq = ?', [
      seq,
    ]);
    return row === undefined ? null : toEntry(row);
  }

  async counts(): Promise<OutboxCounts> {
    const [row] = await this.db.all(
      `SELECT
        coalesce(sum(status IN ${ACTIVE}), 0) AS pending,
        coalesce(sum(status = 'failed'), 0) AS failed,
        coalesce(sum(status = 'conflict'), 0) AS conflicts
       FROM outbox`,
    );
    return {
      pending: row === undefined ? 0 : integer(row, 'pending'),
      failed: row === undefined ? 0 : integer(row, 'failed'),
      conflicts: row === undefined ? 0 : integer(row, 'conflicts'),
    };
  }

  async getMeta(key: string): Promise<string | null> {
    const [row] = await this.db.all(
      'SELECT value FROM sync_state WHERE key = ?',
      [key],
    );
    return row === undefined ? null : text(row, 'value');
  }

  // ---- Local commands (work offline) -------------------------------------------------

  /** The worker starts the job. Committed locally; the sync engine sends it later. */
  startJob(jobId: string): Promise<OutboxEntry> {
    return this.command(jobId, 'job.start', null, job => {
      if (nextStatus(job.status, 'start') === undefined) {
        throw new LocalCommandError(
          'INVALID_STATUS_TRANSITION',
          'This job can no longer be started.',
        );
      }
    });
  }

  completeJob(jobId: string): Promise<OutboxEntry> {
    return this.command(jobId, 'job.complete', null, job => {
      if (nextStatus(job.status, 'complete') === undefined) {
        throw new LocalCommandError(
          'INVALID_STATUS_TRANSITION',
          'Only a job in progress can be completed.',
        );
      }
    });
  }

  addNote(jobId: string, body: string): Promise<OutboxEntry> {
    const now = this.now();
    return this.command(jobId, 'job.note.add', {
      noteId: uuidv7(now.getTime()),
      body: body.trim(),
    });
  }

  /**
   * The atomic local write path: validate against the local view, insert the outbox entry and
   * recompute the view, all in one transaction. Either the worker's action exists both in the
   * UI and in the outbox, or not at all.
   */
  private async command(
    jobId: string,
    type: OutboxType,
    payload: NotePayload | null,
    validate: (job: JobDetail) => void = () => undefined,
  ): Promise<OutboxEntry> {
    const now = this.now().toISOString();
    const mutationId = uuidv7(Date.parse(now));
    const seq = await this.write(tx => {
      const [row] = tx.all(
        'SELECT local_json, server_version FROM jobs WHERE id = ?',
        [jobId],
      );
      if (row === undefined) {
        throw new LocalCommandError(
          'JOB_NOT_FOUND',
          'This job is no longer on this device.',
        );
      }
      const job = parseJob(text(row, 'local_json'));
      validate(job);
      tx.run(
        `INSERT INTO outbox (mutation_id, type, job_id, job_title, payload, base_version,
           occurred_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [
          mutationId,
          type,
          jobId,
          job.title,
          payload === null ? null : JSON.stringify(payload),
          integer(row, 'server_version'),
          now,
          now,
          now,
        ],
      );
      this.reproject(tx, jobId);
      const [inserted] = tx.all(
        'SELECT seq FROM outbox WHERE mutation_id = ?',
        [mutationId],
      );
      return inserted === undefined ? 0 : integer(inserted, 'seq');
    });
    const entry = await this.entry(seq);
    if (entry === null) {
      throw new Error('Outbox entry vanished after insert');
    }
    return entry;
  }

  /**
   * The worker asks to try a failed entry again (for example after a long server outage
   * used up its retries). Conflicts cannot be retried: the server state has moved on.
   */
  async retry(seq: number): Promise<void> {
    const now = this.now().toISOString();
    await this.write(tx => {
      tx.run(
        `UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = NULL,
           updated_at = ? WHERE seq = ? AND status = 'failed'`,
        [now, seq],
      );
      const [row] = tx.all('SELECT job_id FROM outbox WHERE seq = ?', [seq]);
      if (row !== undefined) {
        this.reproject(tx, text(row, 'job_id'));
      }
    });
  }

  /** The worker acknowledges a rejected entry; it leaves the attention list. */
  async dismiss(seq: number): Promise<void> {
    await this.write(tx => {
      tx.run(`DELETE FROM outbox WHERE seq = ? AND status IN ${PROBLEM}`, [
        seq,
      ]);
    });
  }

  // ---- Used by the sync engine -------------------------------------------------------

  /**
   * Start-up recovery: an entry left `in_flight` belongs to an attempt the app did not see
   * finish. It may or may not have reached the server; sending it again is safe because the
   * server deduplicates by mutation ID.
   */
  async recoverInFlight(): Promise<void> {
    await this.write(tx => {
      tx.run("UPDATE outbox SET status = 'pending' WHERE status = 'in_flight'");
    });
  }

  async markInFlight(seq: number): Promise<void> {
    const now = this.now().toISOString();
    await this.write(tx => {
      tx.run(
        "UPDATE outbox SET status = 'in_flight', last_attempt_at = ?, updated_at = ? WHERE seq = ?",
        [now, now, seq],
      );
    });
  }

  /** The server applied the entry: store its job as the new server copy, in one transaction. */
  async markSynced(seq: number, serverJob: JobDetail): Promise<void> {
    const now = this.now().toISOString();
    await this.write(tx => {
      tx.run(
        `UPDATE outbox SET status = 'synced', next_attempt_at = NULL, last_error_code = NULL,
           last_error_message = NULL, updated_at = ? WHERE seq = ?`,
        [now, seq],
      );
      this.storeServerJob(tx, serverJob, now);
    });
  }

  /** Back to pending, to be retried (`attempts` counts only failures the server answered). */
  async markRetry(
    seq: number,
    retry: {
      readonly attempts: number;
      readonly nextAttemptAt: Date | null;
      readonly error: OutboxError;
    },
  ): Promise<void> {
    await this.markOutcome(seq, 'pending', retry.error, {
      attempts: retry.attempts,
      nextAttemptAt: retry.nextAttemptAt?.toISOString() ?? null,
    });
  }

  /** Rejected for good: the entry stops affecting the local view and needs attention. */
  async markRejected(
    seq: number,
    status: 'failed' | 'conflict',
    error: OutboxError,
    attempts?: number,
  ): Promise<void> {
    await this.markOutcome(seq, status, error, {
      nextAttemptAt: null,
      ...(attempts !== undefined && { attempts }),
    });
  }

  private async markOutcome(
    seq: number,
    status: 'pending' | 'failed' | 'conflict',
    error: OutboxError,
    fields: { attempts?: number; nextAttemptAt: string | null },
  ): Promise<void> {
    const now = this.now().toISOString();
    await this.write(tx => {
      tx.run(
        `UPDATE outbox SET status = ?, attempts = coalesce(?, attempts), next_attempt_at = ?,
           last_error_code = ?, last_error_message = ?, updated_at = ? WHERE seq = ?`,
        [
          status,
          fields.attempts ?? null,
          fields.nextAttemptAt,
          error.code,
          error.message,
          now,
          seq,
        ],
      );
      const [row] = tx.all('SELECT job_id FROM outbox WHERE seq = ?', [seq]);
      if (row !== undefined) {
        this.reproject(tx, text(row, 'job_id'));
      }
    });
  }

  /**
   * Replaces the local working set with the server's snapshot, in one transaction:
   * - every job in it becomes the new server copy (pending commands re-applied on top);
   * - a local job missing from it is no longer the worker's (reassigned, or closed long
   *   ago) and is removed, unless commands for it are still pending: those are resolved
   *   first, and the next snapshot removes it.
   */
  async applyWorkingSet(set: JobWorkingSet): Promise<void> {
    const now = this.now().toISOString();
    await this.write(tx => {
      const incoming = new Set<string>();
      for (const job of set.jobs) {
        incoming.add(job.id);
        this.storeServerJob(tx, job, now);
      }
      const local = tx.all('SELECT id FROM jobs').map(row => text(row, 'id'));
      for (const id of local) {
        if (incoming.has(id)) {
          continue;
        }
        const [active] = tx.all(
          `SELECT count(*) AS n FROM outbox WHERE job_id = ? AND status IN ${ACTIVE}`,
          [id],
        );
        if (active === undefined || integer(active, 'n') === 0) {
          tx.run('DELETE FROM jobs WHERE id = ?', [id]);
        }
      }
      this.setMeta(tx, 'last_pull_at', set.generatedAt);
    });
  }

  /** Keeps synced entries for a while for diagnostics, then removes them. */
  async pruneSynced(olderThan: Date): Promise<void> {
    await this.write(tx => {
      tx.run("DELETE FROM outbox WHERE status = 'synced' AND updated_at < ?", [
        olderThan.toISOString(),
      ]);
    });
  }

  async setSyncMeta(key: string, value: string): Promise<void> {
    await this.write(tx => this.setMeta(tx, key, value));
  }

  private setMeta(tx: SqlTransaction, key: string, value: string): void {
    tx.run(
      `INSERT INTO sync_state (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  /**
   * Stores a job from the server as the new server copy, unless the stored copy is newer
   * (versions only grow; a field note does not change the version, so an equal version
   * still replaces the copy).
   */
  private storeServerJob(
    tx: SqlTransaction,
    job: JobDetail,
    receivedAt: string,
  ): void {
    const [existing] = tx.all('SELECT server_version FROM jobs WHERE id = ?', [
      job.id,
    ]);
    if (
      existing !== undefined &&
      integer(existing, 'server_version') > job.version
    ) {
      return;
    }
    const json = JSON.stringify(job);
    tx.run(
      `INSERT INTO jobs (id, server_json, local_json, status, scheduled_at, server_version, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET server_json = excluded.server_json,
         server_version = excluded.server_version, received_at = excluded.received_at`,
      [
        job.id,
        json,
        json,
        job.status,
        job.scheduledAt,
        job.version,
        receivedAt,
      ],
    );
    this.reproject(tx, job.id);
  }

  /** Recomputes a job's local view from its server copy and its pending commands. */
  private reproject(tx: SqlTransaction, jobId: string): void {
    const [row] = tx.all('SELECT server_json FROM jobs WHERE id = ?', [jobId]);
    if (row === undefined) {
      return;
    }
    const pending = tx
      .all(
        `SELECT * FROM outbox WHERE job_id = ? AND status IN ${ACTIVE} ORDER BY seq`,
        [jobId],
      )
      .map(toEntry);
    const local = projectJob(
      parseJob(text(row, 'server_json')),
      pending,
      this.me,
    );
    tx.run(
      'UPDATE jobs SET local_json = ?, status = ?, scheduled_at = ? WHERE id = ?',
      [JSON.stringify(local), local.status, local.scheduledAt, jobId],
    );
  }
}
