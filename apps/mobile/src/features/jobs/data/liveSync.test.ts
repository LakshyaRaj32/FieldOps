/**
 * @jest-environment node
 */
import type { AuthResult, JobDetail, JobHistoryEntry } from '@fieldops/types';

import { createCredentialStore } from '../../../services/auth/credentialStore';
import type { SecureValueStore } from '../../../services/storage/secureStorage';
import { createAppStore } from '../../../store';
import {
  openStore,
  removeDatabaseFile,
  tempDatabasePath,
  testClock,
} from '../../../testing/localDb';
import { createApiTransport } from './apiTransport';
import { LocalJobStore } from './localJobStore';
import { JobSyncEngine } from './syncEngine';

/**
 * The critical offline demo, automated against the REAL API and PostgreSQL: the app's own
 * local store, sync engine and API transport (tokens, refresh, Idempotency-Key), with SQLite
 * through node:sqlite. Only the native SQLite binding and the UI differ from the phone.
 *
 * Skipped unless FIELDOPS_LIVE_API=1. It needs the API on http://localhost:3000 (the URL the
 * test configuration uses) and FIELDOPS_LIVE_DATABASE_URL pointing at the same database, to
 * grant the manager role. See docs/mobile-development.md, "Live offline sync test".
 */
// The mobile workspace has no Node typings; Jest runs this file in Node.
declare const __dirname: string;
const { FIELDOPS_LIVE_API, FIELDOPS_LIVE_DATABASE_URL } = (
  globalThis as unknown as { process: { env: Record<string, string> } }
).process.env;

const LIVE = FIELDOPS_LIVE_API === '1';
const API = 'http://localhost:3000/api/v1';
const PASSWORD = 'correct horse battery staple';

const realFetch = globalThis.fetch;
const offlineFetch = (async () => {
  throw new TypeError('Network request failed');
}) as typeof fetch;

/** Delivers the next `count` commands but loses their responses. */
function losingResponses(count: number): typeof fetch {
  let remaining = count;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await realFetch(input as RequestInfo, init);
    const method = input instanceof Request ? input.method : init?.method;
    if (method === 'POST' && remaining > 0) {
      remaining -= 1;
      throw new TypeError('Network request failed');
    }
    return response;
  }) as typeof fetch;
}

async function call<T>(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const response = await realFetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.token !== undefined && {
        Authorization: `Bearer ${init.token}`,
      }),
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
  const body = (await response.json()) as { data: T };
  if (!response.ok) {
    throw new Error(`${path} → ${response.status} ${JSON.stringify(body)}`);
  }
  return body.data;
}

function grantRole(email: string, role: string): void {
  const { execSync } = require('node:child_process') as {
    execSync(command: string, options: object): void;
  };
  execSync(`npm run user:set-role -w @fieldops/api -- ${email} ${role}`, {
    cwd: `${__dirname}/../../../../../..`,
    env: {
      ...(globalThis as unknown as { process: { env: object } }).process.env,
      DATABASE_URL: FIELDOPS_LIVE_DATABASE_URL,
    },
    stdio: 'ignore',
  });
}

/** A signed-in phone: credentials in (simulated) secure storage and the app's API layer. */
async function phoneFor(session: AuthResult) {
  let stored: string | null = null;
  const storage: SecureValueStore = {
    get: async () => stored,
    set: async value => {
      stored = value;
    },
    clear: async () => {
      stored = null;
    },
  };
  const credentials = createCredentialStore(storage);
  await credentials.save(session);
  return credentials;
}

const noTimers = { set: () => 0, clear: () => undefined };

(LIVE ? describe : describe.skip)(
  'live offline sync against the real API',
  () => {
    const clock = testClock(new Date().toISOString());
    const run = Date.now().toString(36);
    let managerToken: string;
    let worker: AuthResult;
    let warn: jest.SpyInstance;

    beforeAll(async () => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const manager = await call<AuthResult>('/auth/register', {
        method: 'POST',
        body: {
          email: `live-manager-${run}@example.com`,
          password: PASSWORD,
          firstName: 'Live',
          lastName: 'Manager',
        },
      });
      grantRole(manager.user.email, 'MANAGER');
      managerToken = manager.tokens.accessToken;
      worker = await call<AuthResult>('/auth/register', {
        method: 'POST',
        body: {
          email: `live-worker-${run}@example.com`,
          password: PASSWORD,
          firstName: 'Live',
          lastName: 'Worker',
        },
      });
    });

    afterAll(() => {
      globalThis.fetch = realFetch;
      warn.mockRestore();
    });

    async function assignedJob(title: string): Promise<JobDetail> {
      const job = await call<JobDetail>('/jobs', {
        method: 'POST',
        token: managerToken,
        body: {
          title,
          customerName: 'ABC Ltd',
          address: '12 MG Road',
          scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      });
      return call<JobDetail>(`/jobs/${job.id}/assign`, {
        method: 'POST',
        token: managerToken,
        body: { workerId: worker.user.id },
      });
    }

    function device(
      file: string,
      credentials: Awaited<ReturnType<typeof phoneFor>>,
    ) {
      return openStore(clock, file).then(({ db, store }) => {
        const app = createAppStore({ services: { credentials } });
        const engine = new JobSyncEngine({
          store: new LocalJobStore({ db, me: worker.user }),
          transport: createApiTransport(app.dispatch),
          timers: noTimers,
        });
        return { db, store: store as LocalJobStore, engine };
      });
    }

    it('online → download → offline work → restart → reconnect with lost responses → converged, no duplicates', async () => {
      const file = tempDatabasePath();
      const credentials = await phoneFor(worker);
      const job = await assignedJob(`Live offline job ${run}`);
      const opened: { close(): void }[] = [];
      try {
        // 1-3. Online: the phone downloads its jobs into SQLite.
        const first = await device(file, credentials);
        opened.push(first.db);
        expect((await first.engine.sync()).phase).toBe('idle');
        expect((await first.store.getJob(job.id))?.job.status).toBe('ASSIGNED');

        // 4-9. The internet disappears; the worker starts, writes a note and completes.
        globalThis.fetch = offlineFetch;
        await first.store.startJob(job.id);
        await first.store.addNote(job.id, 'Replaced the capacitor (offline)');
        await first.store.completeJob(job.id);
        expect((await first.engine.sync()).phase).toBe('offline');
        expect((await first.store.getJob(job.id))?.job.status).toBe(
          'COMPLETED',
        );

        // 11-13. Force close and reopen, still offline: the outbox is intact.
        first.engine.dispose();
        first.db.close();
        opened.pop();
        const second = await device(file, credentials);
        opened.push(second.db);
        expect(await second.store.getJob(job.id)).toMatchObject({
          job: { status: 'COMPLETED' },
          pendingChanges: 3,
        });

        // 14-15. Back online, but the first two responses get lost on the way back.
        globalThis.fetch = losingResponses(2);
        let status = await second.engine.sync();
        for (let cycle = 0; cycle < 6 && status.phase !== 'idle'; cycle += 1) {
          status = await second.engine.sync();
        }
        globalThis.fetch = realFetch;
        expect(status).toMatchObject({
          phase: 'idle',
          pending: 0,
          failed: 0,
          conflicts: 0,
        });

        // 16-20. The server applied each command exactly once, and the phone converged on it.
        const server = await call<JobDetail>(`/jobs/${job.id}`, {
          token: managerToken,
        });
        expect(server.status).toBe('COMPLETED');
        expect(
          server.history.map((entry: JobHistoryEntry) => entry.type),
        ).toEqual(['CREATED', 'ASSIGNED', 'STARTED', 'COMPLETED']);
        expect(server.fieldNotes.map(note => note.body)).toEqual([
          'Replaced the capacitor (offline)',
        ]);
        const local = await second.store.getJob(job.id);
        expect(local).toMatchObject({ pendingChanges: 0, problems: 0 });
        expect(local?.job).toMatchObject({
          status: server.status,
          version: server.version,
          fieldNotes: [
            expect.objectContaining({ id: server.fieldNotes[0]?.id }),
          ],
        });
        second.engine.dispose();
      } finally {
        globalThis.fetch = realFetch;
        opened.forEach(db => db.close());
        removeDatabaseFile(file);
      }
    });

    it('keeps the server state when the manager cancelled while the phone was offline', async () => {
      const file = tempDatabasePath();
      const credentials = await phoneFor(worker);
      const job = await assignedJob(`Live conflict job ${run}`);
      const phone = await device(file, credentials);
      try {
        await phone.engine.sync();
        globalThis.fetch = offlineFetch;
        const start = await phone.store.startJob(job.id);
        await call(`/jobs/${job.id}/cancel`, {
          method: 'POST',
          token: managerToken,
        });

        globalThis.fetch = realFetch;
        const status = await phone.engine.sync();

        expect(status.conflicts).toBe(1);
        expect(await phone.store.entry(start.seq)).toMatchObject({
          status: 'conflict',
          lastError: { code: 'INVALID_STATUS_TRANSITION' },
        });
        expect((await phone.store.getJob(job.id))?.job.status).toBe(
          'CANCELLED',
        );
        const server = await call<JobDetail>(`/jobs/${job.id}`, {
          token: managerToken,
        });
        expect(server.status).toBe('CANCELLED');
        expect(server.history.map(entry => entry.type)).not.toContain(
          'STARTED',
        );
        phone.engine.dispose();
      } finally {
        globalThis.fetch = realFetch;
        phone.db.close();
        removeDatabaseFile(file);
      }
    });
  },
);
