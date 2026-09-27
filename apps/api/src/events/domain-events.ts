import { Injectable, Logger } from '@nestjs/common';

import type { JobType } from '@fieldops/types';

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
  | 'accepted'
  | 'declined'
  | 'departed'
  | 'arrived'
  | 'started'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rescheduled'
  | 'note'
  | 'evidence';

export interface JobChangedEvent {
  readonly type: 'job.changed';
  readonly organizationId: string;
  readonly jobId: string;
  readonly jobTitle: string;
  readonly jobType: JobType;
  readonly change: JobChangeKind;
  readonly status: string;
  readonly version: number;
  readonly actorId: string;
  /** For notification texts ("Rahul submitted..."). */
  readonly actorName: string;
  readonly createdById: string;
  /** The responsible manager (told about submissions, failures, declines). */
  readonly managerId: string;
  readonly shopId: string | null;
  readonly shopName: string | null;
  /** Money involved (a submitted collection), minor units of `currency`. */
  readonly amount: number | null;
  readonly currency: string;
  /** Why (declined, rejected, failed, rescheduled, cancelled). */
  readonly reason: string | null;
  /** The assignee after the change. */
  readonly assignedWorkerId: string | null;
  /** On reassignment: the worker the job was taken from. */
  readonly previousAssigneeId: string | null;
}

export interface JobMessageCreatedEvent {
  readonly type: 'job.message.created';
  readonly organizationId: string;
  readonly jobId: string;
  readonly jobTitle: string;
  readonly messageId: string;
  readonly authorId: string;
  readonly authorRole: Role;
  readonly createdById: string;
  readonly managerId: string;
  readonly assignedWorkerId: string | null;
}

/** An order passed its due date unpaid (published once per order by the overdue scan). */
export interface PaymentOverdueEvent {
  readonly type: 'payment.overdue';
  readonly organizationId: string;
  readonly shopId: string;
  readonly shopName: string;
  readonly orderId: string;
  readonly orderNumber: string;
  /** Minor units of `currency`. */
  readonly outstanding: number;
  readonly currency: string;
  /** Who to tell (decided by the publisher: the shop's managers and the admins). */
  readonly recipientIds: readonly string[];
}

/** A session stopped being valid (sign-out, refresh-token reuse). */
export interface SessionEndedEvent {
  readonly type: 'session.ended';
  readonly sessionId: string;
}

export type DomainEvent =
  | JobChangedEvent
  | JobMessageCreatedEvent
  | PaymentOverdueEvent
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
