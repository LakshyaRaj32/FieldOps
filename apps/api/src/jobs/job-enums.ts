import type {
  JobAction as SharedJobAction,
  JobEventType as SharedJobEventType,
  JobPriority as SharedJobPriority,
  JobStatus as SharedJobStatus,
  JobType as SharedJobType,
  PaymentMethod as SharedPaymentMethod,
  PaymentStatus as SharedPaymentStatus,
} from '@fieldops/types';

import {
  JobEventType,
  JobPriority,
  JobStatus,
  JobType,
  PaymentMethod,
  PaymentStatus,
} from '../generated/prisma/enums.js';

/**
 * The operation vocabularies used by the API. Status, type, priority, event type and the
 * payment enums come from the database schema (Prisma-generated); actions exist only in
 * code. Each must stay identical to the shared vocabulary in @fieldops/types: these
 * assignments fail to compile if either side gains or loses a value (the same pattern as
 * src/users/role.ts).
 */
export const JobAction = {
  ACCEPT: 'accept',
  DECLINE: 'decline',
  DEPART: 'depart',
  ARRIVE: 'arrive',
  START: 'start',
  COMPLETE: 'complete',
  SUBMIT: 'submit',
  FAIL: 'fail',
  VERIFY: 'verify',
  REJECT: 'reject',
  RESCHEDULE: 'reschedule',
  ASSIGN: 'assign',
  EDIT: 'edit',
  CANCEL: 'cancel',
  DELETE: 'delete',
  NOTE: 'note',
  EVIDENCE: 'evidence',
  MESSAGE: 'message',
} as const;

export type JobAction = (typeof JobAction)[keyof typeof JobAction];

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const contracts: [
  Same<JobStatus, SharedJobStatus>,
  Same<JobType, SharedJobType>,
  Same<JobPriority, SharedJobPriority>,
  Same<JobEventType, SharedJobEventType>,
  Same<JobAction, SharedJobAction>,
  Same<PaymentMethod, SharedPaymentMethod>,
  Same<PaymentStatus, SharedPaymentStatus>,
] = [true, true, true, true, true, true, true];
void contracts;

export {
  JobEventType,
  JobPriority,
  JobStatus,
  JobType,
  PaymentMethod,
  PaymentStatus,
};
