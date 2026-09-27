/**
 * @jest-environment node
 */
import type { JobDetail } from '@fieldops/types';

import {
  FakeJobServer,
  serverJob,
  WORKER,
} from '../../../testing/fakeJobServer';
import { openStore, testClock } from '../../../testing/localDb';
import { buildSubmission, emptyDraft } from '../submission';
import { projectJob } from './projection';
import { JobSyncEngine, type Timers } from './syncEngine';
import { LocalCommandError, type OutboxEntry } from './types';

const timers: Timers = { set: () => 0, clear: () => undefined };

/** A payment collection assigned to the worker: ₹2,00,000 on an order. */
const collection = (overrides: Partial<JobDetail> = {}): JobDetail =>
  serverJob({
    id: 'collect',
    type: 'PAYMENT_COLLECTION',
    title: 'Collect September dues',
    status: 'ASSIGNED',
    shop: {
      id: 'shop-1',
      name: 'Nike Chandigarh',
      ownerName: null,
      phone: null,
      address: 'Sector 17',
    },
    order: { id: 'order-1', orderNumber: 'ORD-1001' },
    expectedAmount: 20_000_000,
    ...overrides,
  });

async function setup(jobs: JobDetail[]) {
  const clock = testClock();
  const server = new FakeJobServer(jobs);
  const { db, store } = await openStore(clock);
  const engine = new JobSyncEngine({
    store,
    transport: server,
    now: clock.now,
    random: () => 0.5,
    timers,
  });
  await engine.sync();
  return { db, store, engine, server };
}

describe('the field lifecycle offline', () => {
  it('walks accept → on my way → arrived → start → submit on the phone, then syncs each once', async () => {
    const { db, store, engine, server } = await setup([collection()]);
    server.online = false;

    await store.acceptJob('collect');
    await store.departJob('collect', null);
    await store.arriveJob('collect', {
      latitude: 30.73,
      longitude: 76.78,
      accuracyMeters: 10,
      capturedAt: '2026-09-27T09:00:00.000Z',
    });
    await store.startJob('collect');
    expect((await store.getJob('collect'))?.job.status).toBe('IN_PROGRESS');

    // No receipt yet: the phone refuses the submission with the server's own rule.
    const local = (await store.getJob('collect'))!.job;
    const draft = { ...emptyDraft(local), method: 'CASH' as const };
    const noPhoto = buildSubmission(local, draft, [], 'INR');
    expect(noPhoto.problems.map(problem => problem.field)).toEqual([
      'evidence',
    ]);
    await expect(
      store.submitJob('collect', noPhoto.request),
    ).rejects.toBeInstanceOf(LocalCommandError);

    await store.addEvidence('collect', {
      evidenceId: 'receipt-1',
      fileUri: 'file:///receipt.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
      width: 10,
      height: 10,
    });
    const withPhoto = (await store.getJob('collect'))!.job;
    const ready = buildSubmission(withPhoto, draft, [], 'INR');
    expect(ready.problems).toEqual([]);
    await store.submitJob('collect', ready.request);

    const submitted = (await store.getJob('collect'))!.job;
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.payments).toEqual([
      expect.objectContaining({
        amount: 20_000_000,
        method: 'CASH',
        status: 'PENDING_VERIFICATION',
      }),
    ]);
    expect(submitted.allowedActions).toEqual(['note', 'evidence', 'message']);

    server.online = true;
    await engine.sync();
    expect(
      server.calls
        .filter(call => call.operation !== 'pull')
        .map(call => call.operation),
    ).toEqual([
      'job.accept',
      'job.depart',
      'job.arrive',
      'job.start',
      'job.evidence.add',
      'job.submit',
    ]);
    expect(server.jobs.get('collect')?.status).toBe('SUBMITTED');
    // The server's state is the phone's now.
    expect((await store.getJob('collect'))?.pendingChanges).toBe(0);
    db.close();
  });

  it('refuses a step out of order before anything is written', async () => {
    const { db, store } = await setup([collection()]);
    await expect(store.startJob('collect')).rejects.toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
    });
    await expect(store.arriveJob('collect')).rejects.toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
    });
    expect(await store.pendingEntries()).toEqual([]);
    db.close();
  });

  it('hands an operation back with a reason, and it offers nothing afterwards', async () => {
    const { db, store, engine, server } = await setup([collection()]);
    await store.declineJob('collect', 'On leave that day');
    const declined = (await store.getJob('collect'))!.job;
    expect(declined).toMatchObject({ status: 'PENDING', assignedWorker: null });
    expect(declined.allowedActions).toEqual([]);

    await engine.sync();
    const sent = server.calls.find(call => call.operation === 'job.decline');
    expect(sent?.body).toEqual({ reason: 'On leave that day' });
    db.close();
  });

  it('keeps the basic lifecycle for general jobs', async () => {
    const { db, store } = await setup([serverJob()]);
    await expect(store.acceptJob('job-1')).rejects.toBeInstanceOf(
      LocalCommandError,
    );
    await store.startJob('job-1');
    await store.completeJob('job-1');
    expect((await store.getJob('job-1'))?.job.status).toBe('COMPLETED');
    db.close();
  });
});

describe('projection of a submission', () => {
  const entry = (payload: object): OutboxEntry =>
    ({
      seq: 1,
      mutationId: 'm1',
      jobId: 'visit',
      jobTitle: 'Visit',
      baseVersion: 1,
      occurredAt: '2026-09-27T10:00:00.000Z',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      lastAttemptAt: null,
      lastError: null,
      createdAt: '2026-09-27T10:00:00.000Z',
      type: 'job.submit',
      payload,
    } as OutboxEntry);

  it('shows the answers, counts and new order lines at once', () => {
    const visit = serverJob({
      id: 'visit',
      type: 'ORDER_COLLECTION',
      status: 'IN_PROGRESS',
      startedAt: '2026-09-27T09:00:00.000Z',
      checklist: [
        {
          id: 'c1',
          position: 0,
          label: 'Display correct?',
          checked: null,
          responseNote: null,
        },
      ],
    });
    const projected = projectJob(
      visit,
      [
        entry({
          location: null,
          request: {
            note: 'Owner wants delivery on Friday',
            checklist: [{ itemId: 'c1', checked: false, note: 'Banner torn' }],
            orderLines: [{ productId: 'p1', quantity: 4 }],
          },
          productNames: { p1: { name: 'Pegasus 41', sku: 'NK-41' } },
        }),
      ],
      WORKER,
    );
    expect(projected.status).toBe('SUBMITTED');
    expect(projected.submissionNote).toBe('Owner wants delivery on Friday');
    expect(projected.checklist[0]).toMatchObject({
      checked: false,
      responseNote: 'Banner torn',
    });
    expect(projected.lines).toEqual([
      expect.objectContaining({
        productName: 'Pegasus 41',
        sku: 'NK-41',
        quantity: 4,
      }),
    ]);
  });
});
