import {
  REALTIME_EVENT,
  REALTIME_PATH,
  type RealtimeEnvelope,
} from '@fieldops/types';
import { io, type Socket } from 'socket.io-client';

import { logger } from '../../utils/logger';
import {
  classifyConnectError,
  parseRealtimeEnvelope,
  RecentIds,
} from './realtimeEvents';

/**
 * The app's realtime connection (the only importer of socket.io-client, enforced by ESLint).
 *
 * Realtime is a hint channel: an event means "something changed, look again", and the app
 * then reads through its normal path (sync for workers, REST for managers). The client
 * therefore never needs to recover missed events: on every (re)connection it simply asks
 * for a resync (`onConnected`), which covers whatever happened while it was away
 * (docs/realtime.md).
 *
 * Status:
 * - `connecting` → `connected`
 * - connection lost → `reconnecting` (Socket.IO retries with jittered exponential backoff,
 *   1 s up to 30 s)
 * - the server refused an expired token → refresh the session once, then reconnect
 * - the server refused the session → `unauthorized`; stops for good (the API layer signs
 *   the user out)
 * - `stop()` (app in background, offline, signed out) → `stopped`
 */
export type RealtimeStatus =
  | 'stopped'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'unauthorized';

export interface RealtimeClientOptions {
  /** API origin, for example http://localhost:3000. */
  readonly url: string;
  /** The current access token (read on every connection attempt). */
  readonly getAccessToken: () => string | undefined;
  /**
   * Refreshes the session through the API layer (one shared refresh for the whole app).
   * Resolves true when a usable token is available again.
   */
  readonly refreshSession: () => Promise<boolean>;
  readonly onEvent: (event: RealtimeEnvelope) => void;
  /** After every successful (re)connection: resynchronize. */
  readonly onConnected: () => void;
  readonly onStatus: (status: RealtimeStatus) => void;
  /** For tests. */
  readonly connect?: typeof io;
}

/** Bounded: at most one refresh attempt per refusal in a row. */
const MAX_REFRESHES_IN_A_ROW = 1;

export class RealtimeClient {
  private socket: Socket | null = null;
  private status: RealtimeStatus = 'stopped';
  private refreshesInARow = 0;
  private readonly recent = new RecentIds();

  constructor(private readonly options: RealtimeClientOptions) {}

  currentStatus(): RealtimeStatus {
    return this.status;
  }

  start(): void {
    if (this.socket !== null || this.status === 'unauthorized') {
      return;
    }
    const connect = this.options.connect ?? io;
    const socket = connect(this.options.url, {
      path: REALTIME_PATH,
      transports: ['websocket'],
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
      timeout: 10_000,
      // Evaluated on every attempt, so a refreshed token is picked up.
      auth: callback =>
        callback({ token: this.options.getAccessToken() ?? '' }),
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.refreshesInARow = 0;
      this.setStatus('connected');
      this.options.onConnected();
    });
    socket.on('disconnect', reason => {
      if (this.socket !== socket) {
        return;
      }
      // "io server disconnect": the server closed it (token expiry, sign-out). Socket.IO
      // does not retry those by itself; try again, and the handshake decides.
      this.setStatus('reconnecting');
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    });
    socket.on('connect_error', error => {
      this.handleConnectError(socket, error);
    });
    socket.on(REALTIME_EVENT, (payload: unknown) => {
      const event = parseRealtimeEnvelope(payload);
      if (event === null) {
        logger.warn('Ignoring a malformed realtime event');
        return;
      }
      if (this.recent.add(event.id)) {
        this.options.onEvent(event);
      }
    });

    this.setStatus('connecting');
    socket.connect();
  }

  /** Disconnects and forgets the socket. `start()` opens a new one. */
  stop(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    if (this.status !== 'unauthorized') {
      this.setStatus('stopped');
    }
  }

  /** After signing in again: allow connecting once more. */
  reset(): void {
    this.stop();
    this.status = 'stopped';
    this.refreshesInARow = 0;
  }

  private handleConnectError(socket: Socket, error: unknown): void {
    if (this.socket !== socket) {
      return;
    }
    switch (classifyConnectError(error)) {
      case 'unreachable':
        // Socket.IO keeps retrying with backoff while `socket.active` is true.
        this.setStatus('reconnecting');
        return;
      case 'unauthorized':
        this.giveUp();
        return;
      case 'token_expired':
        if (this.refreshesInARow >= MAX_REFRESHES_IN_A_ROW) {
          this.giveUp();
          return;
        }
        this.refreshesInARow += 1;
        this.setStatus('reconnecting');
        this.options.refreshSession().then(
          refreshed => {
            if (this.socket !== socket) {
              return;
            }
            if (refreshed) {
              // A refused handshake is not retried automatically: connect again.
              socket.connect();
            } else {
              this.giveUp();
            }
          },
          () => this.giveUp(),
        );
    }
  }

  private giveUp(): void {
    this.stop();
    this.setStatus('unauthorized');
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.options.onStatus(status);
    }
  }
}
