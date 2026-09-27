import type {
  JobType,
  PaymentMethod,
  SubmitJobRequest,
} from '@fieldops/types';

/**
 * What a worker must hand in before an operation's result can be submitted, per operation
 * type. Pure and dependency-free: the phone checks a submission offline with exactly the
 * rules the server enforces again when it arrives (docs/business-domain.md, "Evidence and
 * submission requirements").
 *
 * Rules that need server data (the order's remaining balance, whether a payment reference
 * was used before, whether a product is still active) are checked by the server only.
 */

/** Largest single quantity on a line (a guard against typos such as 10000000). */
export const MAX_LINE_QUANTITY = 1_000_000;
/** Largest amount in minor units (a guard against typos; far above any real order). */
export const MAX_AMOUNT = 1_000_000_000_000;

/** The operation facts the rules look at. */
export interface SubmissionFacts {
  readonly type: JobType;
  /** The manager asked for a photo even where the type does not need one. */
  readonly requiresPhoto: boolean;
  /** Photos attached so far (on the phone: uploaded plus waiting to upload). */
  readonly photoCount: number;
  readonly checklist: readonly { readonly id: string }[];
  readonly lines: readonly {
    readonly id: string;
    readonly expectedQuantity: number | null;
  }[];
  readonly expectedAmount: number | null;
}

export interface SubmissionProblem {
  /** Dotted path in the submission, as in validation errors (`payment.reference`). */
  readonly field: string;
  readonly message: string;
}

/** Types whose result is only credible with a photo (proof of delivery, a receipt). */
const PHOTO_REQUIRED: ReadonlySet<JobType> = new Set([
  'DELIVERY',
  'PAYMENT_COLLECTION',
]);

/** Types whose whole point is the checklist: every item must be answered. */
const CHECKLIST_REQUIRED: ReadonlySet<JobType> = new Set([
  'SHOP_VISIT',
  'INVENTORY_CHECK',
]);

/** Whether the operation needs at least one photo before it can be submitted. */
export function needsPhoto(type: JobType, requiresPhoto: boolean): boolean {
  return PHOTO_REQUIRED.has(type) || requiresPhoto;
}

/** Everything but cash leaves a trace that can be checked later. */
export function needsPaymentReference(method: PaymentMethod): boolean {
  return method !== 'CASH';
}

const isWholeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

const hasText = (value: string | undefined): boolean =>
  value !== undefined && value.trim() !== '';

/**
 * The problems that stop `submission` from being accepted for an operation described by
 * `facts`. An empty list means the submission is complete.
 */
export function submissionProblems(
  facts: SubmissionFacts,
  submission: SubmitJobRequest,
): SubmissionProblem[] {
  const problems: SubmissionProblem[] = [];
  const add = (field: string, message: string) =>
    problems.push({ field, message });

  if (needsPhoto(facts.type, facts.requiresPhoto) && facts.photoCount === 0) {
    add(
      'evidence',
      facts.type === 'PAYMENT_COLLECTION'
        ? 'Add a photo of the receipt or payment confirmation.'
        : facts.type === 'DELIVERY'
          ? 'Add a photo as proof of delivery.'
          : 'Add at least one photo.',
    );
  }

  checkChecklist(facts, submission, add);

  switch (facts.type) {
    case 'DELIVERY':
      checkLineCounts(facts, submission, add, 'delivered');
      break;
    case 'INVENTORY_CHECK':
      checkLineCounts(facts, submission, add, 'counted');
      break;
    case 'ORDER_COLLECTION':
      checkOrderLines(submission, add);
      break;
    case 'PAYMENT_COLLECTION':
      checkPayment(facts, submission, add);
      break;
    case 'SHOP_VISIT':
    case 'GENERAL':
      break;
  }

  if (facts.type !== 'PAYMENT_COLLECTION' && submission.payment !== undefined) {
    add('payment', 'Only a payment collection records a payment.');
  }
  if (facts.type !== 'ORDER_COLLECTION' && submission.orderLines !== undefined) {
    add('orderLines', 'Only an order collection takes new order lines.');
  }
  return problems;
}

type Add = (field: string, message: string) => void;

function checkChecklist(
  facts: SubmissionFacts,
  submission: SubmitJobRequest,
  add: Add,
): void {
  const answers = submission.checklist ?? [];
  const known = new Set(facts.checklist.map(item => item.id));
  const answered = new Set<string>();
  for (const answer of answers) {
    if (!known.has(answer.itemId)) {
      add('checklist', 'An answer refers to an item this operation does not have.');
      return;
    }
    if (answered.has(answer.itemId)) {
      add('checklist', 'An item is answered twice.');
      return;
    }
    answered.add(answer.itemId);
  }
  if (
    CHECKLIST_REQUIRED.has(facts.type) &&
    facts.checklist.some(item => !answered.has(item.id))
  ) {
    add('checklist', 'Answer every checklist item.');
  }
}

function checkLineCounts(
  facts: SubmissionFacts,
  submission: SubmitJobRequest,
  add: Add,
  verb: 'delivered' | 'counted',
): void {
  const counts = submission.lineCounts ?? [];
  const byLine = new Map<string, number>();
  for (const count of counts) {
    if (byLine.has(count.lineId)) {
      add('lineCounts', 'A line is counted twice.');
      return;
    }
    byLine.set(count.lineId, count.quantity);
  }
  if (facts.lines.length === 0) {
    add('lineCounts', 'This operation has no products to report on.');
    return;
  }
  let short = false;
  for (const line of facts.lines) {
    const quantity = byLine.get(line.id);
    if (quantity === undefined) {
      add('lineCounts', `Enter the quantity ${verb} for every product.`);
      return;
    }
    if (!isWholeNumber(quantity) || quantity < 0 || quantity > MAX_LINE_QUANTITY) {
      add('lineCounts', 'Quantities must be whole numbers, 0 or more.');
      return;
    }
    if (line.expectedQuantity !== null && quantity > line.expectedQuantity) {
      add(
        'lineCounts',
        "You can't deliver more than the order contains.",
      );
      return;
    }
    if (line.expectedQuantity !== null && quantity < line.expectedQuantity) {
      short = true;
    }
    byLine.delete(line.id);
  }
  if (byLine.size > 0) {
    add('lineCounts', 'A count refers to a product this operation does not have.');
    return;
  }
  if (short && !hasText(submission.note)) {
    add('note', 'Explain why less was delivered than ordered.');
  }
}

function checkOrderLines(submission: SubmitJobRequest, add: Add): void {
  const lines = submission.orderLines ?? [];
  if (lines.length === 0) {
    add('orderLines', 'Add at least one product to the order.');
    return;
  }
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.productId)) {
      add('orderLines', 'A product is listed twice; combine the quantities.');
      return;
    }
    seen.add(line.productId);
    if (!isWholeNumber(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) {
      add('orderLines', 'Quantities must be whole numbers, 1 or more.');
      return;
    }
  }
}

function checkPayment(
  facts: SubmissionFacts,
  submission: SubmitJobRequest,
  add: Add,
): void {
  const { payment } = submission;
  if (payment === undefined) {
    add('payment', 'Record the payment you collected.');
    return;
  }
  if (!isWholeNumber(payment.amount) || payment.amount < 1 || payment.amount > MAX_AMOUNT) {
    add('payment.amount', 'Enter the amount collected.');
    return;
  }
  if (needsPaymentReference(payment.method) && !hasText(payment.reference)) {
    add(
      'payment.reference',
      'Enter the transaction, UPI or cheque reference.',
    );
  }
  if (
    facts.expectedAmount !== null &&
    payment.amount !== facts.expectedAmount &&
    !hasText(submission.note)
  ) {
    add('note', 'Explain why the amount differs from the amount to collect.');
  }
}
