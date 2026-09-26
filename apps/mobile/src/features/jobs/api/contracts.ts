import {
  JobAction,
  JobEventType,
  JobPriority,
  JobStatus,
  type JobDetail,
  type JobPage,
  type JobSummary,
  type JobWorkingSet,
  type UserSummary,
  type WorkerSummary,
} from '@fieldops/types';

/**
 * Runtime checks for the job payloads the app receives. TypeScript types are erased at
 * runtime, so data crossing the network boundary is checked before screens trust it (the
 * same rule as services/auth/contracts.ts).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): boolean =>
  value === null || isString(value);
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isArrayOf = (value: unknown, guard: (item: unknown) => boolean) =>
  Array.isArray(value) && value.every(guard);

const oneOf =
  (vocabulary: Readonly<Record<string, string>>) =>
  (value: unknown): boolean =>
    Object.values(vocabulary).includes(value as string);

const isStatus = oneOf(JobStatus);
const isPriority = oneOf(JobPriority);
const isAction = oneOf(JobAction);
const isEventType = oneOf(JobEventType);

function isUserSummary(value: unknown): value is UserSummary {
  if (!isRecord(value)) {
    return false;
  }
  const { id, firstName, lastName } = value;
  return [id, firstName, lastName].every(isString);
}

const isNullableUser = (value: unknown): boolean =>
  value === null || isUserSummary(value);

function isJobNote(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const { id, body, author, occurredAt, createdAt } = value;
  return (
    [id, body, occurredAt, createdAt].every(isString) && isUserSummary(author)
  );
}

export function isJobSummary(value: unknown): value is JobSummary {
  if (!isRecord(value)) {
    return false;
  }
  const {
    id,
    title,
    customerName,
    address,
    scheduledAt,
    updatedAt,
    status,
    priority,
    version,
    assignedWorker,
    allowedActions,
  } = value;
  return (
    [id, title, customerName, address, scheduledAt, updatedAt].every(
      isString,
    ) &&
    isStatus(status) &&
    isPriority(priority) &&
    isNumber(version) &&
    isNullableUser(assignedWorker) &&
    isArrayOf(allowedActions, isAction)
  );
}

function isChecklistItem(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const { id, position, label } = value;
  return isString(id) && isNumber(position) && isString(label);
}

function isHistoryEntry(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const { id, type, fromStatus, toStatus, actor, assignee, createdAt } = value;
  return (
    isString(id) &&
    isEventType(type) &&
    (fromStatus === null || isStatus(fromStatus)) &&
    isStatus(toStatus) &&
    isUserSummary(actor) &&
    isNullableUser(assignee) &&
    isString(createdAt)
  );
}

function isLocation(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  const { latitude, longitude } = value;
  return isNumber(latitude) && isNumber(longitude);
}

export function isJobDetail(value: unknown): value is JobDetail {
  if (!isJobSummary(value) || !isRecord(value)) {
    return false;
  }
  const {
    description,
    notes,
    cancellationReason,
    startedAt,
    completedAt,
    cancelledAt,
    createdAt,
    location,
    createdBy,
    checklist,
    history,
    fieldNotes,
  } = value as Record<string, unknown>;
  return (
    [
      description,
      notes,
      cancellationReason,
      startedAt,
      completedAt,
      cancelledAt,
    ].every(isNullableString) &&
    isString(createdAt) &&
    isLocation(location) &&
    isUserSummary(createdBy) &&
    isArrayOf(checklist, isChecklistItem) &&
    isArrayOf(history, isHistoryEntry) &&
    isArrayOf(fieldNotes, isJobNote)
  );
}

export function isJobWorkingSet(value: unknown): value is JobWorkingSet {
  if (!isRecord(value)) {
    return false;
  }
  const { jobs, generatedAt } = value;
  return isArrayOf(jobs, isJobDetail) && isString(generatedAt);
}

export function isJobPage(value: unknown): value is JobPage {
  if (!isRecord(value)) {
    return false;
  }
  const { items, nextCursor } = value;
  return isArrayOf(items, isJobSummary) && isNullableString(nextCursor);
}

function isWorkerSummary(value: unknown): value is WorkerSummary {
  if (!isUserSummary(value) || !isRecord(value)) {
    return false;
  }
  const { email } = value as Record<string, unknown>;
  return isString(email);
}

export function isWorkerList(value: unknown): value is WorkerSummary[] {
  return isArrayOf(value, isWorkerSummary);
}
