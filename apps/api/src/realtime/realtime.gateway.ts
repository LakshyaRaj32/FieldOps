import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { RealtimeEnvelope, RealtimeRefusal } from '@fieldops/types';
import type { Server, Socket } from 'socket.io';
import { v7 as uuidv7 } from 'uuid';

import { AccessTokenVerifier } from '../auth/access-token-verifier.js';
import { AppException, AuthErrors } from '../common/errors/app-exception.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { DomainEvents } from '../events/domain-events.js';
import { PresenceService } from './presence.service.js';
import {
  jobChangedDeliveries,
  messageDeliveries,
  roomsFor,
  sessionRoom,
  type Delivery,
} from './realtime-audience.js';

/** Socket.IO path on the API origin (the same value as REALTIME_PATH in @fieldops/types). */
export const REALTIME_PATH = '/realtime';
/** Every envelope is emitted under this event name (REALTIME_EVENT in @fieldops/types). */
export const REALTIME_EVENT = 'event';

interface SocketData {
  user: AuthenticatedUser;
  /** Epoch milliseconds when the access token used to connect expires. */
  expiresAt: number;
}

const REFUSALS: readonly RealtimeRefusal[] = [
  'UNAUTHENTICATED',
  'ACCESS_TOKEN_EXPIRED',
  'ACCESS_TOKEN_INVALID',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'ACCOUNT_DISABLED',
  'ORGANIZATION_SUSPENDED',
];

/** The error a refused handshake reports to the client (`connect_error`). */
function refusal(error: unknown): Error {
  const code: RealtimeRefusal =
    error instanceof AppException &&
    (REFUSALS as readonly string[]).includes(error.code)
      ? (error.code as RealtimeRefusal)
      : 'ACCESS_TOKEN_INVALID';
  return Object.assign(new Error(code), { data: { code } });
}

/**
 * The realtime channel: server → client hints over Socket.IO (WebSocket transport only, no
 * HTTP long-polling, so no sticky sessions are ever needed). See docs/realtime.md.
 *
 * - **Authentication** on the handshake with the same access token and session checks as
 *   REST (AccessTokenVerifier). A connection lives at most until its token expires; the
 *   client then reconnects with a refreshed token, so a revoked session or a changed role
 *   takes effect within one access-token lifetime at the latest. Signing out closes the
 *   session's connections at once (session.ended).
 * - **Authorization** by rooms derived from the job policy (realtime-audience.ts).
 * - **Nothing is received from clients.** The channel carries hints only; every write goes
 *   through the REST API and its authorization.
 */
@WebSocketGateway({
  path: REALTIME_PATH,
  transports: ['websocket'],
  serveClient: false,
  // Clients send nothing; a small buffer bounds what an attacker could push at the server.
  maxHttpBufferSize: 4_096,
})
export class RealtimeGateway
  implements
    OnGatewayInit<Server>,
    OnGatewayConnection<Socket>,
    OnGatewayDisconnect<Socket>,
    OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly expiryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly subscriptions: (() => void)[] = [];

  @WebSocketServer()
  private readonly server: Server;

  constructor(
    private readonly verifier: AccessTokenVerifier,
    private readonly events: DomainEvents,
    private readonly presence: PresenceService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authenticate(socket).then(
        () => next(),
        (error: unknown) => next(refusal(error)),
      );
    });
    this.subscriptions.push(
      this.events.subscribe('job.changed', event => {
        this.deliver(jobChangedDeliveries(event));
      }),
      this.events.subscribe('job.message.created', event => {
        this.deliver(messageDeliveries(event));
      }),
      this.events.subscribe('session.ended', event => {
        this.server.in(sessionRoom(event.sessionId)).disconnectSockets(true);
      }),
    );
  }

  handleConnection(socket: Socket): void {
    const data = socket.data as Partial<SocketData>;
    if (data.user === undefined || data.expiresAt === undefined) {
      // The middleware refuses unauthenticated handshakes; this is defense in depth.
      socket.disconnect(true);
      return;
    }
    void socket.join(roomsFor(data.user));
    this.presence.connected(data.user.userId);
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, data.expiresAt - Date.now()),
    );
    timer.unref();
    this.expiryTimers.set(socket.id, timer);
  }

  handleDisconnect(socket: Socket): void {
    const data = socket.data as Partial<SocketData>;
    if (data.user !== undefined && data.expiresAt !== undefined) {
      this.presence.disconnected(data.user.userId);
    }
    const timer = this.expiryTimers.get(socket.id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.expiryTimers.delete(socket.id);
    }
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    for (const timer of this.expiryTimers.values()) {
      clearTimeout(timer);
    }
    this.expiryTimers.clear();
  }

  private async authenticate(socket: Socket): Promise<void> {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    const token = auth?.['token'];
    if (typeof token !== 'string' || token === '') {
      throw AuthErrors.unauthenticated();
    }
    const verified = await this.verifier.verify(token);
    const data: SocketData = {
      user: verified.user,
      expiresAt: verified.expiresAt.getTime(),
    };
    Object.assign(socket.data as object, data);
  }

  private deliver(deliveries: readonly Delivery[]): void {
    for (const delivery of deliveries) {
      const envelope: RealtimeEnvelope = {
        id: uuidv7(),
        type: delivery.type,
        version: 1,
        occurredAt: new Date().toISOString(),
        data: delivery.data,
      } as RealtimeEnvelope;
      this.server.to([...delivery.rooms]).emit(REALTIME_EVENT, envelope);
    }
    this.logger.debug(`Delivered ${deliveries.length} realtime event(s)`);
  }
}
