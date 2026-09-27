import type {
  JobChangedData,
  JobMessageCreatedData,
  RealtimeEventMap,
  RealtimeEventType,
} from '@fieldops/types';

import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import type {
  JobChangedEvent,
  JobMessageCreatedEvent,
} from '../events/domain-events.js';
import { hasPermission } from '../jobs/domain/job.policy.js';

/**
 * Who receives which realtime event. Pure, so the rules are unit-tested, and derived from the
 * job policy so that a socket never receives a hint about a job its user may not see through
 * REST (docs/realtime.md, "Authorization"):
 *
 * - every connection joins `user:<id>` and `session:<id>`;
 * - users who may read every job (job:read:all: managers, admins) also join `managers`;
 * - a job's events go to `managers` and to its assigned worker, and nobody else;
 * - a worker a job was taken from gets one `unassigned` hint without the job's status.
 */

export const MANAGERS_ROOM = 'managers';
export const userRoom = (userId: string): string => `user:${userId}`;
export const sessionRoom = (sessionId: string): string =>
  `session:${sessionId}`;

export function roomsFor(user: AuthenticatedUser): string[] {
  return [
    userRoom(user.userId),
    sessionRoom(user.sessionId),
    ...(hasPermission(user.role, 'job:read:all') ? [MANAGERS_ROOM] : []),
  ];
}

export interface Delivery<Type extends RealtimeEventType = RealtimeEventType> {
  readonly rooms: readonly string[];
  readonly type: Type;
  readonly data: RealtimeEventMap[Type];
}

function jobAudience(assignedWorkerId: string | null): string[] {
  return [
    MANAGERS_ROOM,
    ...(assignedWorkerId === null ? [] : [userRoom(assignedWorkerId)]),
  ];
}

export function jobChangedDeliveries(
  event: JobChangedEvent,
): Delivery<'job.changed'>[] {
  const data: JobChangedData = {
    jobId: event.jobId,
    change: event.change,
    status: event.status,
    version: event.version,
  };
  const deliveries: Delivery<'job.changed'>[] = [
    { rooms: jobAudience(event.assignedWorkerId), type: 'job.changed', data },
  ];
  if (
    event.previousAssigneeId !== null &&
    event.previousAssigneeId !== event.assignedWorkerId
  ) {
    deliveries.push({
      rooms: [userRoom(event.previousAssigneeId)],
      type: 'job.changed',
      data: { jobId: event.jobId, change: 'unassigned' },
    });
  }
  return deliveries;
}

export function messageDeliveries(
  event: JobMessageCreatedEvent,
): Delivery<'job.message.created'>[] {
  const data: JobMessageCreatedData = {
    jobId: event.jobId,
    messageId: event.messageId,
  };
  return [
    {
      rooms: jobAudience(event.assignedWorkerId),
      type: 'job.message.created',
      data,
    },
  ];
}
