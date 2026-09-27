import {
  EVIDENCE_CONTENT_TYPES,
  JobAction,
  JobEventType,
  JobPriority,
  JobStatus,
  JobType,
  PaymentMethod,
  PaymentStatus,
  type JobDetail,
  type JobOverview,
  type JobPage,
  type JobSummary,
  type JobWorkingSet,
  type PaymentRecord,
  type WorkerSummary,
} from '@fieldops/types';

import {
  isArrayOf,
  isBoolean,
  isNullableGeoPoint,
  isNullableNumber,
  isNullableString,
  isNullableUser,
  isNumber,
  isRecord,
  isString,
  isUserSummary,
  oneOf,
} from '../../../services/api/guards';
import { isProduct } from '../../catalog/api/contracts';

/**
 * Runtime checks for the operation payloads the app receives. TypeScript types are erased at
 * runtime, so data crossing the network boundary is checked before screens trust it (the
 * same rule as services/auth/contracts.ts).
 */

const isStatus = oneOf(JobStatus);
const isType = oneOf(JobType);
const isPriority = oneOf(JobPriority);
const isAction = oneOf(JobAction);
const isEventType = oneOf(JobEventType);
const isMethod = oneOf(PaymentMethod);
const isPaymentStatus = oneOf(PaymentStatus);

function isJobNote(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const { id, body, author, occurredAt, createdAt } = value;
  return (
    [id, body, occurredAt, createdAt].every(isString) && isUserSummary(author)
  );
}

function isJobShop(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  const { id, name, ownerName, phone, address } = value;
  return (
    [id, name, address].every(isString) &&
    [ownerName, phone].every(isNullableString)
  );
}

export function isJobSummary(value: unknown): value is JobSummary {
  if (!isRecord(value)) {
    return false;
  }
  const {
    id,
    type,
    title,
    customerName,
    address,
    scheduledAt,
    updatedAt,
    status,
    priority,
    version,
    assignedWorker,
    manager,
    shop,
    expectedAmount,
    allowedActions,
  } = value;
  return (
    [id, title, customerName, address, scheduledAt, updatedAt].every(
      isString,
    ) &&
    isType(type) &&
    isStatus(status) &&
    isPriority(priority) &&
    isNumber(version) &&
    isNullableUser(assignedWorker) &&
    isUserSummary(manager) &&
    isJobShop(shop) &&
    isNullableNumber(expectedAmount) &&
    isArrayOf(allowedActions, isAction)
  );
}

function isChecklistItem(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const { id, position, label, checked, responseNote } = value;
  return (
    isString(id) &&
    isNumber(position) &&
    isString(label) &&
    (checked === null || isBoolean(checked)) &&
    isNullableString(responseNote)
  );
}

function isHistoryEntry(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const { id, type, fromStatus, toStatus, actor, assignee, reason, createdAt } =
    value;
  return (
    isString(id) &&
    isEventType(type) &&
    (fromStatus === null || isStatus(fromStatus)) &&
    isStatus(toStatus) &&
    isUserSummary(actor) &&
    isNullableUser(assignee) &&
    isNullableString(reason) &&
    isString(createdAt)
  );
}

function isActionLocation(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  const { latitude, longitude, accuracyMeters, capturedAt, distanceMeters } =
    value;
  return (
    [latitude, longitude, accuracyMeters].every(isNumber) &&
    isString(capturedAt) &&
    isNullableNumber(distanceMeters)
  );
}

function isEvidence(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const {
    id,
    contentType,
    sizeBytes,
    width,
    height,
    uploadedBy,
    capturedAt,
    createdAt,
  } = value;
  return (
    [id, capturedAt, createdAt].every(isString) &&
    (EVIDENCE_CONTENT_TYPES as readonly unknown[]).includes(contentType) &&
    [sizeBytes, width, height].every(isNumber) &&
    isUserSummary(uploadedBy)
  );
}

function isLine(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const {
    id,
    position,
    productId,
    productName,
    sku,
    expectedQuantity,
    quantity,
  } = value;
  return (
    [id, productId, productName, sku].every(isString) &&
    isNumber(position) &&
    isNullableNumber(expectedQuantity) &&
    isNullableNumber(quantity)
  );
}

export function isPaymentRecord(value: unknown): value is PaymentRecord {
  if (!isRecord(value)) {
    return false;
  }
  const {
    id,
    orderId,
    jobId,
    amount,
    method,
    reference,
    status,
    collectedAt,
    recordedBy,
    verifiedBy,
    verifiedAt,
    rejectionReason,
    createdAt,
  } = value;
  return (
    [id, orderId, collectedAt, createdAt].every(isString) &&
    [jobId, reference, verifiedAt, rejectionReason].every(isNullableString) &&
    isNumber(amount) &&
    isMethod(method) &&
    isPaymentStatus(status) &&
    isUserSummary(recordedBy) &&
    isNullableUser(verifiedBy)
  );
}

function isJobOrder(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) && isString(value['id']) && isString(value['orderNumber']))
  );
}

export function isJobDetail(value: unknown): value is JobDetail {
  if (!isJobSummary(value) || !isRecord(value)) {
    return false;
  }
  const {
    description,
    notes,
    cancellationReason,
    acceptedAt,
    arrivedAt,
    startedAt,
    submittedAt,
    completedAt,
    cancelledAt,
    failedAt,
    failureReason,
    submissionNote,
    createdAt,
    location,
    createdBy,
    order,
    lines,
    payments,
    requiresPhoto,
    siteRadiusMeters,
    checklist,
    history,
    fieldNotes,
    arrivalLocation,
    startLocation,
    completeLocation,
    evidence,
    messages,
  } = value as Record<string, unknown>;
  return (
    [
      description,
      notes,
      cancellationReason,
      acceptedAt,
      arrivedAt,
      startedAt,
      submittedAt,
      completedAt,
      cancelledAt,
      failedAt,
      failureReason,
      submissionNote,
    ].every(isNullableString) &&
    isString(createdAt) &&
    isNullableGeoPoint(location) &&
    isUserSummary(createdBy) &&
    isJobOrder(order) &&
    isArrayOf(lines, isLine) &&
    isArrayOf(payments, isPaymentRecord) &&
    isBoolean(requiresPhoto) &&
    isNumber(siteRadiusMeters) &&
    isArrayOf(checklist, isChecklistItem) &&
    isArrayOf(history, isHistoryEntry) &&
    isArrayOf(fieldNotes, isJobNote) &&
    isActionLocation(arrivalLocation) &&
    isActionLocation(startLocation) &&
    isActionLocation(completeLocation) &&
    isArrayOf(evidence, isEvidence) &&
    // Messages have the same shape as notes (id, body, author, two timestamps).
    isArrayOf(messages, isJobNote)
  );
}

export function isJobWorkingSet(value: unknown): value is JobWorkingSet {
  if (!isRecord(value)) {
    return false;
  }
  const { jobs, products, generatedAt } = value;
  return (
    isArrayOf(jobs, isJobDetail) &&
    isArrayOf(products, isProduct) &&
    isString(generatedAt)
  );
}

export function isJobPage(value: unknown): value is JobPage {
  if (!isRecord(value)) {
    return false;
  }
  const { items, nextCursor } = value;
  return isArrayOf(items, isJobSummary) && isNullableString(nextCursor);
}

function isWorkerSummary(value: unknown): value is WorkerSummary {
  return isUserSummary(value) && isRecord(value) && isString(value['email']);
}

export function isWorkerList(value: unknown): value is WorkerSummary[] {
  return isArrayOf(value, isWorkerSummary);
}

function isActivity(value: unknown): boolean {
  if (!isHistoryEntry(value) || !isRecord(value)) {
    return false;
  }
  return isString(value['jobId']) && isString(value['jobTitle']);
}

function isWorkload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const { worker, assigned, inProgress } = value;
  return isUserSummary(worker) && isNumber(assigned) && isNumber(inProgress);
}

const allNumbers = (value: unknown, keys: readonly string[]): boolean =>
  isRecord(value) && keys.every(key => isNumber(value[key]));

/** The manager dashboard's figures (GET /jobs/overview). */
export function isJobOverview(value: unknown): value is JobOverview {
  if (!isRecord(value)) {
    return false;
  }
  const {
    scope,
    statusCounts,
    workers,
    collections,
    shops,
    workload,
    recentActivity,
    generatedAt,
  } = value;
  return (
    (scope === 'organization' || scope === 'team') &&
    allNumbers(statusCounts, Object.values(JobStatus)) &&
    allNumbers(value, [
      'overdue',
      'dueNext24Hours',
      'awaitingVerification',
      'completedLast7Days',
      'cancelledLast7Days',
      'failedLast7Days',
    ]) &&
    allNumbers(workers, ['total', 'busy', 'available', 'online']) &&
    allNumbers(collections, [
      'outstanding',
      'dueToday',
      'overdue',
      'collectedToday',
      'pendingVerification',
    ]) &&
    isRecord(collections) &&
    isString(collections['currency']) &&
    allNumbers(shops, ['total', 'visitedToday', 'pendingVisits']) &&
    isArrayOf(workload, isWorkload) &&
    isArrayOf(recentActivity, isActivity) &&
    isString(generatedAt)
  );
}
