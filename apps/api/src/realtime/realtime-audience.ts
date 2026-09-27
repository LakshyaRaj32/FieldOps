import type {
  JobChangedData,
  JobMessageCreatedData,
  RealtimeEventMap,
  RealtimeEventType,
} from '@fieldops/types';

import { isOrganizationWide } from '../common/tenancy/scope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import type {
  JobChangedEvent,
  JobMessageCreatedEvent,
} from '../events/domain-events.js';

/**
 * Who receives which realtime event. Pure, so the rules are unit-tested, and derived from the
 * operation policy so that a socket never receives a hint about an operation its user may
 * not see through REST (docs/realtime.md, "Authorization"):
 *
 * - every connection joins `user:<id>` and `session:<id>`;
 * - organization-wide staff (organization admins, managers with organization-wide access)
 *   also join their organization's staff room, `org:<id>:staff`. There is no global room:
 *   one organization's events never reach another's sockets;
 * - an operation's events go to its organization's staff room, its responsible manager
 *   and its assigned worker, and nobody else;
 * - a worker an operation was taken from (reassigned, or declined) gets one `unassigned`
 *   hint without the status.
 */

export const userRoom = (userId: string): string => `user:${userId}`;
export const sessionRoom = (sessionId: string): string =>
  `session:${sessionId}`;
export const organizationStaffRoom = (organizationId: string): string =>
  `org:${organizationId}:staff`;

export function roomsFor(user: AuthenticatedUser): string[] {
  return [
    userRoom(user.userId),
    sessionRoom(user.sessionId),
    ...(user.organizationId !== null && isOrganizationWide(user)
      ? [organizationStaffRoom(user.organizationId)]
      : []),
  ];
}

export interface Delivery<Type extends RealtimeEventType = RealtimeEventType> {
  readonly rooms: readonly string[];
  readonly type: Type;
  readonly data: RealtimeEventMap[Type];
}

function jobAudience(event: {
  readonly organizationId: string;
  readonly managerId: string;
  readonly assignedWorkerId: string | null;
}): string[] {
  return [
    organizationStaffRoom(event.organizationId),
    userRoom(event.managerId),
    ...(event.assignedWorkerId === null
      ? []
      : [userRoom(event.assignedWorkerId)]),
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
    { rooms: jobAudience(event), type: 'job.changed', data },
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
  return [{ rooms: jobAudience(event), type: 'job.message.created', data }];
}
