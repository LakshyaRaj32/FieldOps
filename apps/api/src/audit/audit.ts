import type { Prisma } from '../generated/prisma/client.js';

/**
 * The audit log's write side: one function every module calls INSIDE the transaction of the
 * change it records, so an action and its audit entry commit or roll back together. The
 * table is append-only (a database trigger refuses UPDATE and DELETE).
 *
 * Operation lifecycle steps are recorded in each operation's own history (job_events); the
 * audit log covers everything around them (docs/business-domain.md, "Audit").
 */

export type AuditAction =
  | 'organization.created'
  | 'organization.updated'
  | 'organization.suspended'
  | 'organization.activated'
  | 'member.created'
  | 'member.updated'
  | 'member.deactivated'
  | 'member.password_changed'
  | 'team.worker_assigned'
  | 'team.worker_removed'
  | 'shop.created'
  | 'shop.updated'
  | 'shop.assignment_added'
  | 'shop.assignment_ended'
  | 'product.created'
  | 'product.updated'
  | 'order.created'
  | 'order.cancelled'
  | 'order.delivery_recorded'
  | 'payment.submitted'
  | 'payment.verified'
  | 'payment.rejected'
  | 'payment.overdue_notified'
  | 'operation.created'
  | 'operation.cancelled'
  | 'operation.verified';

export type AuditEntityType =
  | 'organization'
  | 'user'
  | 'shop'
  | 'product'
  | 'order'
  | 'payment'
  | 'operation';

export interface AuditRecord {
  /** Null only for platform actions outside any organization. */
  readonly organizationId: string | null;
  /** Null when the system acted on its own. */
  readonly actorId: string | null;
  readonly action: AuditAction;
  readonly entityType: AuditEntityType;
  readonly entityId: string;
  /** One line for people. At most 300 characters (longer text is cut). */
  readonly summary: string;
  /** Details for investigation. Never passwords, tokens or other secrets. */
  readonly data?: Prisma.InputJsonValue;
}

type AuditWriter = Pick<Prisma.TransactionClient, 'auditLog'>;

/** A request's changes as JSON for `data` (drops undefined fields and class prototypes). */
export function changesOf(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const SUMMARY_MAX = 300;

export async function writeAudit(
  tx: AuditWriter,
  ...records: readonly AuditRecord[]
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  await tx.auditLog.createMany({
    data: records.map(record => ({
      organizationId: record.organizationId,
      actorId: record.actorId,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      summary:
        record.summary.length <= SUMMARY_MAX
          ? record.summary
          : `${record.summary.slice(0, SUMMARY_MAX - 1)}…`,
      ...(record.data !== undefined && { data: record.data }),
    })),
  });
}
