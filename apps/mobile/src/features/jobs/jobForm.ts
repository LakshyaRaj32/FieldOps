import { parseMoney } from '@fieldops/shared/money';
import {
  JobPriority,
  JobStatus,
  JobType,
  type CreateJobRequest,
  type JobDetail,
  type UpdateJobRequest,
} from '@fieldops/types';

import type { FieldErrors } from '../auth/validation';

/**
 * The staff's operation form: field values as typed, client-side checks that mirror the API's
 * rules (the server stays the authority) and conversion to API requests. Pure functions.
 *
 * A GENERAL job takes a customer and address. Every other type takes a shop (its name,
 * address and coordinates are the shop's); deliveries and payment collections an order of
 * that shop, a collection the amount to collect, an inventory check the products to count
 * and a shop visit a checklist (the same rules the server applies).
 *
 * The schedule is chosen with the native date and time pickers (components/common/
 * DateTimeField) and kept here as a date (YYYY-MM-DD) and a 24-hour time (HH:MM) in the
 * device's time zone, then sent as an ISO timestamp. Keeping the two parts as text keeps
 * these rules pure and lets the date and the time be changed independently.
 */

export const LIMITS = {
  title: 200,
  customerName: 200,
  address: 500,
  description: 5000,
  notes: 5000,
  checklistItems: 50,
  checklistItem: 200,
} as const;

export interface JobForm {
  readonly type: JobType;
  readonly shopId: string;
  readonly orderId: string;
  /** PAYMENT_COLLECTION: as typed ("2,00,000"); parsed to minor units on submit. */
  readonly expectedAmount: string;
  /** INVENTORY_CHECK: the products to count. */
  readonly productIds: readonly string[];
  readonly requiresPhoto: boolean;
  readonly title: string;
  readonly customerName: string;
  readonly address: string;
  /** YYYY-MM-DD */
  readonly date: string;
  /** HH:MM, 24-hour */
  readonly time: string;
  readonly priority: JobPriority;
  readonly description: string;
  readonly notes: string;
  /** One checklist item per line. */
  readonly checklist: string;
}

export type JobFormErrors = FieldErrors<keyof JobForm>;

/** Operation types that need an order of the shop. */
export const ORDER_TYPES: readonly JobType[] = [
  JobType.DELIVERY,
  JobType.PAYMENT_COLLECTION,
];

const pad = (value: number) => String(value).padStart(2, '0');
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function formatDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

export function formatTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A new form, scheduled at the next full hour. */
export function emptyJobForm(now: Date = new Date()): JobForm {
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0);
  return {
    type: JobType.GENERAL,
    shopId: '',
    orderId: '',
    expectedAmount: '',
    productIds: [],
    requiresPhoto: false,
    title: '',
    customerName: '',
    address: '',
    date: formatDateInput(next),
    time: formatTimeInput(next),
    priority: JobPriority.NORMAL,
    description: '',
    notes: '',
    checklist: '',
  };
}

/** The form filled with an existing job, for editing. */
export function jobToForm(job: JobDetail): JobForm {
  const scheduled = new Date(job.scheduledAt);
  return {
    type: job.type,
    shopId: job.shop?.id ?? '',
    orderId: job.order?.id ?? '',
    expectedAmount: '',
    productIds: job.lines.map(line => line.productId),
    requiresPhoto: job.requiresPhoto,
    title: job.title,
    customerName: job.customerName,
    address: job.address,
    date: formatDateInput(scheduled),
    time: formatTimeInput(scheduled),
    priority: job.priority,
    description: job.description ?? '',
    notes: job.notes ?? '',
    checklist: job.checklist.map(item => item.label).join('\n'),
  };
}

/** The checklist is fixed once the worker starts (the server enforces the same rule). */
export function canEditChecklist(status: JobStatus): boolean {
  return status === JobStatus.PENDING || status === JobStatus.ASSIGNED;
}

export function parseChecklist(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
}

/** The local date and time as a Date, or undefined when either is not a real value. */
export function parseSchedule(date: string, time: string): Date | undefined {
  const dateMatch = DATE.exec(date.trim());
  const timeMatch = TIME.exec(time.trim());
  if (dateMatch === null || timeMatch === null) {
    return undefined;
  }
  const [, year, month, day] = dateMatch.map(Number);
  const [, hours, minutes] = timeMatch.map(Number);
  const result = new Date(year!, month! - 1, day, hours, minutes);
  // Rejects dates that roll over, such as 2026-02-30.
  return result.getMonth() === month! - 1 && result.getDate() === day
    ? result
    : undefined;
}

function required(
  value: string,
  label: string,
  max: number,
): string | undefined {
  const length = value.trim().length;
  if (length === 0) {
    return `Enter the ${label.toLowerCase()}.`;
  }
  return length > max
    ? `${label} must be at most ${max} characters.`
    : undefined;
}

function optional(
  value: string,
  label: string,
  max: number,
): string | undefined {
  return value.trim().length > max
    ? `${label} must be at most ${max} characters.`
    : undefined;
}

export function validateJobForm(
  form: JobForm,
  currency = 'INR',
): JobFormErrors {
  const general = form.type === JobType.GENERAL;
  const errors: Partial<Record<keyof JobForm, string | undefined>> = {
    title: required(form.title, 'Title', LIMITS.title),
    description: optional(form.description, 'Description', LIMITS.description),
    notes: optional(form.notes, 'Notes', LIMITS.notes),
  };
  if (general) {
    errors.customerName = required(
      form.customerName,
      'Customer',
      LIMITS.customerName,
    );
    errors.address = required(form.address, 'Address', LIMITS.address);
  } else if (form.shopId === '') {
    errors.shopId = 'Choose the shop.';
  }
  if (ORDER_TYPES.includes(form.type) && form.orderId === '') {
    errors.orderId = 'Choose the order.';
  }
  if (form.type === JobType.PAYMENT_COLLECTION) {
    const amount = parseMoney(form.expectedAmount, currency);
    if (amount === undefined || amount < 1) {
      errors.expectedAmount = 'Enter the amount to collect.';
    }
  }
  if (form.type === JobType.INVENTORY_CHECK && form.productIds.length === 0) {
    errors.productIds = 'Choose at least one product to count.';
  }

  if (!DATE.test(form.date.trim())) {
    errors.date = 'Use the format YYYY-MM-DD.';
  } else if (!TIME.test(form.time.trim())) {
    errors.time = 'Use the 24-hour format HH:MM.';
  } else if (parseSchedule(form.date, form.time) === undefined) {
    errors.date = 'Enter a real date.';
  }

  const items = parseChecklist(form.checklist);
  if (form.type === JobType.SHOP_VISIT && items.length === 0) {
    errors.checklist = 'A shop visit needs a checklist: one item per line.';
  } else if (items.length > LIMITS.checklistItems) {
    errors.checklist = `Use at most ${LIMITS.checklistItems} items.`;
  } else if (items.some(item => item.length > LIMITS.checklistItem)) {
    errors.checklist = `Each item must be at most ${LIMITS.checklistItem} characters.`;
  }

  const result: JobFormErrors = {};
  for (const [field, message] of Object.entries(errors) as [
    keyof JobForm,
    string | undefined,
  ][]) {
    if (message !== undefined) {
      result[field] = message;
    }
  }
  return result;
}

/** Call after validateJobForm reported no errors. */
export function toCreateJobRequest(
  form: JobForm,
  currency = 'INR',
): CreateJobRequest {
  const scheduledAt = parseSchedule(form.date, form.time);
  if (scheduledAt === undefined) {
    throw new Error('toCreateJobRequest called with an invalid schedule');
  }
  const description = form.description.trim();
  const notes = form.notes.trim();
  const checklist = parseChecklist(form.checklist);
  const general = form.type === JobType.GENERAL;
  const amount = parseMoney(form.expectedAmount, currency);
  return {
    // A GENERAL job's request is exactly the Phase 2 one (the type is the default).
    ...(!general && { type: form.type, shopId: form.shopId }),
    ...(ORDER_TYPES.includes(form.type) && { orderId: form.orderId }),
    ...(form.type === JobType.PAYMENT_COLLECTION &&
      amount !== undefined && { expectedAmount: amount }),
    ...(form.type === JobType.INVENTORY_CHECK && {
      productIds: [...form.productIds],
    }),
    ...(form.requiresPhoto && { requiresPhoto: true }),
    title: form.title.trim(),
    ...(general && {
      customerName: form.customerName.trim(),
      address: form.address.trim(),
    }),
    scheduledAt: scheduledAt.toISOString(),
    priority: form.priority,
    ...(description !== '' && { description }),
    ...(notes !== '' && { notes }),
    ...(checklist.length > 0 && { checklist }),
  };
}

/**
 * Only the fields that changed, plus the version the form was loaded from (the server
 * rejects the edit with VERSION_CONFLICT if someone changed the job meanwhile). Cleared
 * optional texts are sent as null.
 */
export function toUpdateJobRequest(
  form: JobForm,
  job: JobDetail,
): UpdateJobRequest {
  const request = toCreateJobRequest(form);
  const original = toCreateJobRequest(jobToForm(job));
  const changed = <K extends keyof CreateJobRequest>(key: K) =>
    request[key] !== original[key];

  const description = request.description ?? null;
  const notes = request.notes ?? null;
  const checklist = request.checklist ?? [];
  const checklistChanged =
    canEditChecklist(job.status) &&
    checklist.join('\n') !== (original.checklist ?? []).join('\n');

  const general = job.type === JobType.GENERAL;
  return {
    version: job.version,
    ...(changed('title') && { title: request.title }),
    // Shop operations take the shop's name and address: never sent.
    ...(general &&
      changed('customerName') && { customerName: request.customerName }),
    ...(general && changed('address') && { address: request.address }),
    // Compared through the form, so seconds the form cannot show don't count as a change.
    // After assignment a shop operation is rescheduled instead (the worker is told).
    ...(changed('scheduledAt') &&
      (general || job.status === JobStatus.PENDING) && {
        scheduledAt: request.scheduledAt,
      }),
    ...(changed('priority') && { priority: request.priority }),
    ...(description !== job.description && { description }),
    ...(notes !== job.notes && { notes }),
    ...(checklistChanged && { checklist }),
  };
}
