import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuditEntry, AuditPage } from '@fieldops/types';

import { AuthErrors, AppException } from '../common/errors/app-exception.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { Role } from '../users/role.js';

export interface AuditQuery {
  readonly entityType?: string;
  readonly entityId?: string;
  /** SUPER_ADMIN only: one organization's log. */
  readonly organizationId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 30;

const actorSelect = {
  select: { id: true, firstName: true, lastName: true },
} as const;

/**
 * Reading the audit log. ORGANIZATION_ADMINs read their own organization's log; SUPER_ADMINs
 * read every organization's (and the platform's own entries). Nobody else: the log names
 * people and amounts across the whole organization.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser, query: AuditQuery): Promise<AuditPage> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entityType !== undefined && { entityType: query.entityType }),
      ...(query.entityId !== undefined && { entityId: query.entityId }),
    };
    if (user.role === Role.ORGANIZATION_ADMIN && user.organizationId !== null) {
      // Tenant isolation: the organization filter is forced, never taken from the query.
      where.organizationId = user.organizationId;
    } else if (user.role === Role.SUPER_ADMIN) {
      if (query.organizationId !== undefined) {
        where.organizationId = query.organizationId;
      }
    } else {
      throw AuthErrors.forbidden();
    }

    const cursor =
      query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (query.cursor !== undefined && cursor === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Some fields are missing or invalid.',
        [{ field: 'cursor', message: 'Cursor is invalid.' }],
      );
    }
    if (cursor !== undefined) {
      where.OR = [
        { createdAt: { lt: cursor.at } },
        { createdAt: cursor.at, id: { lt: cursor.id } },
      ];
    }

    const limit = query.limit ?? DEFAULT_LIMIT;
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { actor: actorSelect },
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map((row): AuditEntry => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        summary: row.summary,
        actor: row.actor,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor({ at: last.createdAt, id: last.id })
          : null,
    };
  }
}
