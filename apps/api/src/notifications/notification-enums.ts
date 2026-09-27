import type { NotificationType as SharedNotificationType } from '@fieldops/types';

import { NotificationType } from '../generated/prisma/enums.js';

/**
 * The notification types come from the database schema (Prisma-generated) and must stay
 * identical to @fieldops/types; this assignment fails to compile if either side changes.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const contract: Same<NotificationType, SharedNotificationType> = true;
void contract;

export { NotificationType };
