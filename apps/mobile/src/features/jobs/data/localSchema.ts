import type { Migration } from '../../../services/db/migrations';

/**
 * The worker's local database (one file per user, see offlineSession.ts).
 *
 * `jobs` keeps two copies of each job:
 * - `server_json`: the last JobDetail the server sent. Never edited locally, so the server
 *   stays the source of truth and a refresh can always replace it.
 * - `local_json`: what the UI shows, the server copy with the pending outbox commands
 *   applied on top (projection.ts). Recomputed in the same transaction as every change to
 *   either input.
 * `status` and `scheduled_at` are copies of local_json fields for filtering and sorting.
 *
 * `outbox` holds the worker's commands until the server has ruled on them. `seq` is the
 * local order (commands for a job are sent strictly in this order); `mutation_id` is created
 * once and sent as Idempotency-Key on every attempt.
 *
 * `evidence_files` (v2) lists photos stored in app-private files: the outbox entry carries
 * the upload, this table lets the files be removed once nothing needs them any more.
 */
export const JOB_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'jobs, outbox, sync metadata',
    statements: [
      `CREATE TABLE jobs (
        id TEXT PRIMARY KEY NOT NULL,
        server_json TEXT NOT NULL,
        local_json TEXT NOT NULL,
        status TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        server_version INTEGER NOT NULL,
        received_at TEXT NOT NULL
      )`,
      'CREATE INDEX jobs_status_scheduled_at_idx ON jobs (status, scheduled_at)',
      `CREATE TABLE outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        mutation_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK (type IN ('job.start', 'job.complete', 'job.note.add')),
        job_id TEXT NOT NULL,
        job_title TEXT NOT NULL,
        payload TEXT,
        base_version INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK (status IN ('pending', 'in_flight', 'synced', 'failed', 'conflict')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_attempt_at TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      'CREATE INDEX outbox_status_seq_idx ON outbox (status, seq)',
      'CREATE INDEX outbox_job_id_seq_idx ON outbox (job_id, seq)',
      `CREATE TABLE sync_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    description:
      'field operations: evidence and message commands, evidence files',
    statements: [
      // SQLite cannot change a CHECK constraint in place: the outbox is rebuilt with the new
      // command types, rows copied unchanged (same seq, mutation IDs and statuses).
      `CREATE TABLE outbox_v2 (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        mutation_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK (type IN (
          'job.start', 'job.complete', 'job.note.add', 'job.evidence.add', 'job.message.send'
        )),
        job_id TEXT NOT NULL,
        job_title TEXT NOT NULL,
        payload TEXT,
        base_version INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK (status IN ('pending', 'in_flight', 'synced', 'failed', 'conflict')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_attempt_at TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      'INSERT INTO outbox_v2 SELECT * FROM outbox',
      'DROP TABLE outbox',
      'ALTER TABLE outbox_v2 RENAME TO outbox',
      'CREATE INDEX outbox_status_seq_idx ON outbox (status, seq)',
      'CREATE INDEX outbox_job_id_seq_idx ON outbox (job_id, seq)',
      // Photos kept on the device (app-private files) until their upload is settled, linked
      // to the outbox entry that uploads them. (Jobs stored by v1 lack the Phase 4 fields;
      // localJobStore fills them in when reading, so no JSON rewriting is needed here.)
      `CREATE TABLE evidence_files (
        evidence_id TEXT PRIMARY KEY NOT NULL,
        mutation_id TEXT NOT NULL UNIQUE,
        job_id TEXT NOT NULL,
        file_uri TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ],
  },
];
