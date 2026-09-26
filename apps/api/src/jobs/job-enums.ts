import type {
  JobAction as SharedJobAction,
  JobEventType as SharedJobEventType,
  JobPriority as SharedJobPriority,
  JobStatus as SharedJobStatus,
} from '@fieldops/types';

import {
  JobEventType,
  JobPriority,
  JobStatus,
} from '../generated/prisma/enums.js';

/**
 * The job vocabularies used by the API. Status, priority and event type come from the
 * database schema (Prisma-generated); actions exist only in code. Each must stay identical to
 * the shared vocabulary in @fieldops/types: these assignments fail to compile if either side
 * gains or loses a value (the same pattern as src/users/role.ts).
 */
export const JobAction = {
  START: 'start',
  COMPLETE: 'complete',
  ASSIGN: 'assign',
  EDIT: 'edit',
  CANCEL: 'cancel',
  DELETE: 'delete',
  NOTE: 'note',
} as const;

export type JobAction = (typeof JobAction)[keyof typeof JobAction];

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const contracts: [
  Same<JobStatus, SharedJobStatus>,
  Same<JobPriority, SharedJobPriority>,
  Same<JobEventType, SharedJobEventType>,
  Same<JobAction, SharedJobAction>,
] = [true, true, true, true];
void contracts;

export { JobEventType, JobPriority, JobStatus };
