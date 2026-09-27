import { Injectable, Logger } from '@nestjs/common';

import type { Role } from '../users/role.js';

/**
 * Things that happened, published by the module that owns them AFTER its transaction
 * committed, and consumed by modules with side effects (realtime delivery, notifications).
 * Publishers never know their subscribers (docs/backend-architecture.md, "Inside a module").
 *
 * In-process and not durable: if the process dies between a commit and a handler, that
 * side effect is lost. This is acceptable because every side effect is a hint (a WebSocket
 * event, a push); the state itself is in PostgreSQL and devices converge through sync.
 * Phase 5 replaces the transport with a transactional outbox and BullMQ without changing
 * publishers or subscribers.
 */

export type JobChangeKind =
  | 'assigned'
  | 'updated'
  | 'started'
  | 'completed'
  | 'cancelled'
  | 'note'
  | 'evidence';

export interface JobChangedEvent {
  readonly type: 'job.changed';
  readonly jobId: string;
  readonly jobTitle: string;
  readonly change: JobChangeKind;
  readonly status: string;
  readonly version: number;
  readonly actorId: string;
  readonly createdById: string;
  /** The assignee after the change. */
  readonly assignedWorkerId: string | null;
  /** On reassignment: the worker the job was taken from. */
  readonly previousAssigneeId: string | null;
}

export interface JobMessageCreatedEvent {
  readonly type: 'job.message.created';
  readonly jobId: string;
  readonly jobTitle: string;
  readonly messageId: string;
  readonly authorId: string;
  readonly authorRole: Role;
  readonly createdById: string;
  readonly assignedWorkerId: string | null;
}

/** A session stopped being valid (sign-out, refresh-token reuse). */
export interface SessionEndedEvent {
  readonly type: 'session.ended';
  readonly sessionId: string;
}

export type DomainEvent =
  | JobChangedEvent
  | JobMessageCreatedEvent
  | SessionEndedEvent;

type EventOf<Type extends DomainEvent['type']> = Extract<
  DomainEvent,
  { type: Type }
>;

type Handler<Event> = (event: Event) => void | Promise<void>;

@Injectable()
export class DomainEvents {
  private readonly logger = new Logger(DomainEvents.name);
  private readonly handlers = new Map<string, Set<Handler<never>>>();

  /** Registers a handler; returns the function that removes it. */
  subscribe<Type extends DomainEvent['type']>(
    type: Type,
    handler: Handler<EventOf<Type>>,
  ): () => void {
    let set = this.handlers.get(type);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const entry = handler as Handler<never>;
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  /**
   * Delivers the event to every handler. Never throws and never waits: a failing or slow
   * subscriber (FCM being down, for example) must not fail or delay the request that
   * already committed its change.
   */
  publish(event: DomainEvent): void {
    for (const handler of this.handlers.get(event.type) ?? []) {
      try {
        const result = (handler as Handler<DomainEvent>)(event);
        if (result instanceof Promise) {
          result.catch((error: unknown) => this.report(event, error));
        }
      } catch (error) {
        this.report(event, error);
      }
    }
  }

  private report(event: DomainEvent, error: unknown): void {
    this.logger.error(
      `Handler for ${event.type} failed`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
