import type { RealtimeEnvelope } from '@fieldops/types';
import type { io } from 'socket.io-client';

import { RealtimeClient, type RealtimeStatus } from './realtimeClient';
import {
  classifyConnectError,
  parseRealtimeEnvelope,
  RecentIds,
} from './realtimeEvents';

/** Just enough of a Socket.IO client socket for the client's logic. */
class FakeSocket {
  readonly handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  connects = 0;
  disconnected = false;
  options: Record<string, unknown> = {};

  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
  connect() {
    this.connects += 1;
    return this;
  }
  disconnect() {
    this.disconnected = true;
    return this;
  }
  removeAllListeners() {
    this.handlers.clear();
    return this;
  }
}

const envelope = (
  overrides: Partial<RealtimeEnvelope> = {},
): RealtimeEnvelope => ({
  id: 'event-1',
  type: 'job.changed',
  version: 1,
  occurredAt: '2026-09-27T08:00:00.000Z',
  data: { jobId: 'job-1', change: 'assigned', status: 'ASSIGNED', version: 2 },
  ...overrides,
});

function setup(refreshSession: () => Promise<boolean> = async () => true) {
  const socket = new FakeSocket();
  const statuses: RealtimeStatus[] = [];
  const events: RealtimeEnvelope[] = [];
  const onConnected = jest.fn();
  const connect = jest.fn((_url: string, options: Record<string, unknown>) => {
    socket.options = options;
    return socket;
  }) as unknown as typeof io;
  const refresh = jest.fn(refreshSession);
  const client = new RealtimeClient({
    url: 'http://localhost:3000',
    getAccessToken: () => 'access-token',
    refreshSession: refresh,
    onEvent: event => events.push(event),
    onConnected,
    onStatus: status => statuses.push(status),
    connect,
  });
  return { client, socket, statuses, events, onConnected, refresh, connect };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('RealtimeClient', () => {
  it('connects over WebSocket only, with the access token, and resyncs on connect', () => {
    const { client, socket, statuses, onConnected } = setup();
    client.start();

    expect(socket.options).toMatchObject({
      path: '/realtime',
      transports: ['websocket'],
      reconnectionDelayMax: 30_000,
    });
    const auth = socket.options.auth as (cb: (data: object) => void) => void;
    const received: object[] = [];
    auth(data => received.push(data));
    expect(received).toEqual([{ token: 'access-token' }]);

    socket.emit('connect');
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('delivers valid events once and ignores malformed ones', () => {
    const { client, socket, events } = setup();
    client.start();
    socket.emit('connect');

    socket.emit('event', envelope());
    socket.emit('event', envelope()); // duplicate delivery
    socket.emit('event', { type: 'job.changed' }); // malformed
    socket.emit('event', envelope({ id: 'event-2' }));

    expect(events.map(event => event.id)).toEqual(['event-1', 'event-2']);
  });

  it('refreshes an expired token once, then reconnects', async () => {
    const { client, socket, refresh, statuses } = setup();
    client.start();
    const before = socket.connects;

    socket.emit('connect_error', new Error('ACCESS_TOKEN_EXPIRED'));
    await flush();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(socket.connects).toBe(before + 1);
    expect(statuses.at(-1)).toBe('reconnecting');

    // A second refusal in a row, without a successful connection: give up.
    socket.emit('connect_error', new Error('ACCESS_TOKEN_EXPIRED'));
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('unauthorized');
  });

  it('stops for good when the server refuses the session', () => {
    const { client, socket, statuses } = setup();
    client.start();
    socket.emit('connect_error', new Error('SESSION_REVOKED'));

    expect(statuses.at(-1)).toBe('unauthorized');
    expect(socket.disconnected).toBe(true);
    client.start(); // no effect until reset (the user signs in again)
    expect(client.currentStatus()).toBe('unauthorized');
  });

  it('gives up when the session cannot be refreshed', async () => {
    const { client, socket, statuses } = setup(async () => false);
    client.start();
    socket.emit('connect_error', new Error('ACCESS_TOKEN_EXPIRED'));
    await flush();
    expect(statuses.at(-1)).toBe('unauthorized');
  });

  it('keeps retrying (with Socket.IO backoff) while the server is unreachable', () => {
    const { client, socket, statuses, refresh } = setup();
    client.start();
    socket.emit('connect_error', new Error('websocket error'));
    expect(statuses.at(-1)).toBe('reconnecting');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reconnects itself after the server closed the connection (token expiry)', () => {
    const { client, socket, statuses } = setup();
    client.start();
    socket.emit('connect');
    const before = socket.connects;

    socket.emit('disconnect', 'io server disconnect');

    expect(statuses.at(-1)).toBe('reconnecting');
    expect(socket.connects).toBe(before + 1);
  });

  it('stops cleanly', () => {
    const { client, socket, statuses } = setup();
    client.start();
    client.stop();
    expect(socket.disconnected).toBe(true);
    expect(statuses.at(-1)).toBe('stopped');
  });
});

describe('parseRealtimeEnvelope', () => {
  it('accepts both event types and keeps only known fields', () => {
    expect(parseRealtimeEnvelope({ ...envelope(), extra: 'x' })).toEqual(
      envelope(),
    );
    expect(
      parseRealtimeEnvelope({
        id: 'e',
        type: 'job.message.created',
        version: 1,
        occurredAt: '2026-09-27T08:00:00.000Z',
        data: { jobId: 'job-1', messageId: 'm-1' },
      }),
    ).toMatchObject({ data: { jobId: 'job-1', messageId: 'm-1' } });
  });

  it('refuses unknown types, versions and changes', () => {
    expect(parseRealtimeEnvelope({ ...envelope(), type: 'user.deleted' })).toBeNull();
    expect(parseRealtimeEnvelope({ ...envelope(), version: 2 })).toBeNull();
    expect(
      parseRealtimeEnvelope({
        ...envelope(),
        data: { jobId: 'job-1', change: 'exploded' },
      }),
    ).toBeNull();
    expect(parseRealtimeEnvelope('event')).toBeNull();
  });
});

describe('classifyConnectError', () => {
  it.each([
    ['ACCESS_TOKEN_EXPIRED', 'token_expired'],
    ['SESSION_REVOKED', 'unauthorized'],
    ['ACCESS_TOKEN_INVALID', 'unauthorized'],
    ['UNAUTHENTICATED', 'unauthorized'],
    ['xhr poll error', 'unreachable'],
  ])('%s → %s', (message, kind) => {
    expect(classifyConnectError(new Error(message))).toBe(kind);
  });
});

describe('RecentIds', () => {
  it('forgets the oldest IDs beyond its capacity', () => {
    const ids = new RecentIds(2);
    expect(ids.add('a')).toBe(true);
    expect(ids.add('a')).toBe(false);
    ids.add('b');
    ids.add('c');
    expect(ids.add('a')).toBe(true);
  });
});
