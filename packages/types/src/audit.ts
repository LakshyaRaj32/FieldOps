/**
 * The audit log: an append-only record of important business actions (who did what to
 * which entity, when). Operation lifecycle steps are in each operation's own history; the
 * audit log covers everything around them: people, teams, shops, products, orders, payments
 * and organizations. See docs/business-domain.md, "Audit".
 */

import type { UserSummary } from './jobs';

export interface AuditEntry {
  readonly id: string;
  /** `entity.verb`, for example `payment.verified`. */
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  /** One line for people ("Payment of ₹2,00,000.00 verified"). */
  readonly summary: string;
  /** Null for actions the system took on its own. */
  readonly actor: UserSummary | null;
  /** ISO 8601. */
  readonly createdAt: string;
}

export interface AuditPage {
  readonly items: readonly AuditEntry[];
  readonly nextCursor: string | null;
}
