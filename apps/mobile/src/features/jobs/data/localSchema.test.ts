/**
 * @jest-environment node
 */
import { serverJob, WORKER } from '../../../testing/fakeJobServer';
import { removeDatabaseFile, tempDatabasePath } from '../../../testing/localDb';
import { openNodeSqliteDatabase } from '../../../testing/nodeSqliteDatabase';
import { currentVersion, migrate } from '../../../services/db/migrations';
import { JOB_MIGRATIONS } from './localSchema';
import { LocalJobStore } from './localJobStore';

/**
 * Upgrading a phone that ran Phase 3 (schema v1) with unsynced work on it: migration 2 must
 * keep every outbox entry exactly (same seq, mutation ID and status), and jobs stored before
 * Phase 4 must still be readable.
 */
describe('local schema migration 2 (field operations)', () => {
  let file: string;

  beforeEach(() => {
    file = tempDatabasePath();
  });

  afterEach(() => {
    removeDatabaseFile(file);
  });

  /** A v1 database with one job (Phase 3 JSON, no Phase 4 fields) and a pending start. */
  async function phase3Database() {
    const db = openNodeSqliteDatabase(file);
    await migrate(db, JOB_MIGRATIONS.slice(0, 1));
    const phase3Job: Record<string, unknown> = { ...serverJob() };
    for (const field of [
      'startLocation',
      'completeLocation',
      'evidence',
      'messages',
    ]) {
      delete phase3Job[field];
    }
    const json = JSON.stringify(phase3Job);
    await db.transaction(tx => {
      tx.run(
        `INSERT INTO jobs (id, server_json, local_json, status, scheduled_at, server_version, received_at)
         VALUES ('job-1', ?, ?, 'ASSIGNED', ?, 2, '2026-09-27T08:00:00.000Z')`,
        [json, json, serverJob().scheduledAt],
      );
      tx.run(
        `INSERT INTO outbox (mutation_id, type, job_id, job_title, payload, base_version,
           occurred_at, status, created_at, updated_at)
         VALUES ('0190c3b1-7a2e-7cc1-9f00-3b1d2e4f5a60', 'job.start', 'job-1', 'AC repair', NULL,
           2, '2026-09-27T08:05:00.000Z', 'pending', '2026-09-27T08:05:00.000Z',
           '2026-09-27T08:05:00.000Z')`,
      );
    });
    return db;
  }

  it('keeps the pending outbox and reads jobs stored before Phase 4', async () => {
    const db = await phase3Database();

    expect(await migrate(db, JOB_MIGRATIONS)).toBe(3);
    expect(await currentVersion(db)).toBe(3);

    const store = new LocalJobStore({ db, me: WORKER });
    const [entry] = await store.pendingEntries();
    expect(entry).toMatchObject({
      seq: 1,
      mutationId: '0190c3b1-7a2e-7cc1-9f00-3b1d2e4f5a60',
      type: 'job.start',
      payload: null,
      status: 'pending',
    });
    const job = await store.getJob('job-1');
    expect(job?.job).toMatchObject({
      status: 'ASSIGNED',
      startLocation: null,
      evidence: [],
      messages: [],
    });
    db.close();
  });

  it('accepts the new commands after the upgrade, continuing the outbox order', async () => {
    const db = await phase3Database();
    await migrate(db, JOB_MIGRATIONS);
    const store = new LocalJobStore({ db, me: WORKER });

    const message = await store.sendMessage('job-1', 'On my way');
    const photo = await store.addEvidence('job-1', {
      evidenceId: 'evidence-1',
      fileUri: 'file:///data/files/evidence/evidence-1.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
      width: 10,
      height: 10,
    });

    expect(message.seq).toBeGreaterThan(1);
    expect(photo.seq).toBeGreaterThan(message.seq);
    expect((await store.pendingEntries()).map(item => item.type)).toEqual([
      'job.start',
      'job.message.send',
      'job.evidence.add',
    ]);
    // Replaying the start from Phase 3 still projects the job as in progress.
    expect((await store.getJob('job-1'))?.job.status).toBe('IN_PROGRESS');
    db.close();
  });

  it('still refuses unknown command types', async () => {
    const db = openNodeSqliteDatabase(file);
    await migrate(db, JOB_MIGRATIONS);
    await expect(
      db.transaction(tx => {
        tx.run(
          `INSERT INTO outbox (mutation_id, type, job_id, job_title, base_version, occurred_at,
             status, created_at, updated_at)
           VALUES ('m', 'job.delete', 'j', 't', 1, 'x', 'pending', 'x', 'x')`,
        );
      }),
    ).rejects.toThrow();
    db.close();
  });
});

/**
 * Upgrading a phone that ran Phase 4 (schema v2) with unsynced work: migration 3 must keep
 * the outbox exactly, jobs stored before operations must read as GENERAL jobs whose manager
 * is their creator, and the field lifecycle's commands must be accepted afterwards.
 */
describe('local schema migration 3 (operations)', () => {
  let file: string;

  beforeEach(() => {
    file = tempDatabasePath();
  });

  afterEach(() => {
    removeDatabaseFile(file);
  });

  async function phase4Database() {
    const db = openNodeSqliteDatabase(file);
    await migrate(db, JOB_MIGRATIONS.slice(0, 2));
    const phase4Job: Record<string, unknown> = { ...serverJob() };
    for (const field of [
      'type',
      'manager',
      'shop',
      'expectedAmount',
      'order',
      'lines',
      'payments',
      'requiresPhoto',
      'submissionNote',
      'siteRadiusMeters',
      'arrivalLocation',
      'acceptedAt',
      'arrivedAt',
      'submittedAt',
      'failedAt',
      'failureReason',
    ]) {
      delete phase4Job[field];
    }
    phase4Job['checklist'] = [
      { id: 'c1', position: 0, label: 'Clean filters' },
    ];
    const json = JSON.stringify(phase4Job);
    await db.transaction(tx => {
      tx.run(
        `INSERT INTO jobs (id, server_json, local_json, status, scheduled_at, server_version, received_at)
         VALUES ('job-1', ?, ?, 'ASSIGNED', ?, 2, '2026-09-27T08:00:00.000Z')`,
        [json, json, serverJob().scheduledAt],
      );
      tx.run(
        `INSERT INTO outbox (mutation_id, type, job_id, job_title, payload, base_version,
           occurred_at, status, created_at, updated_at)
         VALUES ('0190c3b1-7a2e-7cc1-9f00-3b1d2e4f5a61', 'job.message.send', 'job-1', 'AC repair',
           '{"messageId":"m1","body":"Hello"}', 2, '2026-09-27T08:05:00.000Z', 'pending',
           '2026-09-27T08:05:00.000Z', '2026-09-27T08:05:00.000Z')`,
      );
    });
    return db;
  }

  it('keeps the pending outbox and reads older jobs as GENERAL jobs', async () => {
    const db = await phase4Database();
    expect(await migrate(db, JOB_MIGRATIONS)).toBe(3);

    const store = new LocalJobStore({ db, me: WORKER });
    expect((await store.pendingEntries()).map(entry => entry.type)).toEqual([
      'job.message.send',
    ]);
    const local = await store.getJob('job-1');
    expect(local?.job).toMatchObject({
      type: 'GENERAL',
      manager: serverJob().createdBy,
      lines: [],
      payments: [],
      checklist: [{ id: 'c1', checked: null, responseNote: null }],
    });
    db.close();
  });

  it('accepts the field lifecycle commands afterwards', async () => {
    const db = await phase4Database();
    await migrate(db, JOB_MIGRATIONS);
    const store = new LocalJobStore({ db, me: WORKER });
    await store.applyWorkingSet({
      jobs: [
        serverJob({ id: 'visit', type: 'SHOP_VISIT', status: 'ASSIGNED' }),
      ],
      products: [],
      generatedAt: '2026-09-27T09:00:00.000Z',
    });

    await store.acceptJob('visit');
    await store.departJob('visit');
    await store.arriveJob('visit');
    expect((await store.getJob('visit'))?.job.status).toBe('ARRIVED');
    expect(
      (await store.pendingEntries()).map(entry => entry.type).slice(-3),
    ).toEqual(['job.accept', 'job.depart', 'job.arrive']);
    db.close();
  });
});
