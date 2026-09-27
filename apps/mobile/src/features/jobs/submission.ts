import { parseMoney } from '@fieldops/shared/money';
import {
  submissionProblems,
  type SubmissionProblem,
} from '@fieldops/shared/requirements';
import {
  JobType,
  PaymentMethod,
  type JobDetail,
  type Product,
  type SubmitJobRequest,
} from '@fieldops/types';

import { uuidv7 } from '../../utils/uuid';
import { parseQuantity } from '../shops/orderForm';

/**
 * The worker's result form, as typed. Pure functions turn it into the submission the server
 * expects and list what is still missing, with the same rules the server applies
 * (@fieldops/shared/requirements): the phone never queues a submission the server would
 * refuse for a reason the phone can know.
 */

export interface SubmissionDraft {
  /** Checklist item ID → answer (unset: not answered yet). */
  readonly answers: Readonly<Record<string, boolean>>;
  readonly answerNotes: Readonly<Record<string, string>>;
  /** Line ID → quantity as typed (delivered, or counted). */
  readonly counts: Readonly<Record<string, string>>;
  /** Product ID → quantity as typed (order collection). */
  readonly orderQuantities: Readonly<Record<string, string>>;
  /** Payment collection. */
  readonly amount: string;
  readonly method: PaymentMethod;
  readonly reference: string;
  readonly note: string;
  /**
   * Created once per draft, so every attempt to submit this payment (a double tap, a resend
   * after a lost response) is the same payment on the server.
   */
  readonly paymentId: string;
}

export function emptyDraft(
  job: JobDetail,
  currencyDigits = 2,
): SubmissionDraft {
  const expected =
    job.expectedAmount === null
      ? ''
      : (job.expectedAmount / 10 ** currencyDigits).toFixed(
          job.expectedAmount % 10 ** currencyDigits === 0 ? 0 : currencyDigits,
        );
  return {
    answers: {},
    answerNotes: {},
    counts: Object.fromEntries(
      job.lines.map(line => [
        line.id,
        line.expectedQuantity === null ? '' : String(line.expectedQuantity),
      ]),
    ),
    orderQuantities: {},
    amount: expected,
    method: PaymentMethod.CASH,
    reference: '',
    note: '',
    paymentId: uuidv7(),
  };
}

export interface BuiltSubmission {
  readonly request: Omit<SubmitJobRequest, 'location'>;
  /** Names of ordered products, so the phone can show them offline. */
  readonly productNames: Readonly<
    Record<string, { readonly name: string; readonly sku: string }>
  >;
  /** What stops it from being submitted (empty: ready). */
  readonly problems: readonly SubmissionProblem[];
}

const count = (text: string): number =>
  text.trim() === '' ? Number.NaN : Number(text.trim());

/** The submission for the draft, and what is still missing. */
export function buildSubmission(
  job: JobDetail,
  draft: SubmissionDraft,
  catalog: readonly Product[],
  currency: string,
  collectedAt: Date = new Date(),
): BuiltSubmission {
  const note = draft.note.trim();
  const answered = job.checklist.filter(item => item.id in draft.answers);
  const checklist = answered.map(item => {
    const itemNote = (draft.answerNotes[item.id] ?? '').trim();
    return {
      itemId: item.id,
      checked: draft.answers[item.id] === true,
      ...(itemNote !== '' && { note: itemNote }),
    };
  });

  const counting =
    job.type === JobType.DELIVERY || job.type === JobType.INVENTORY_CHECK;
  const lineCounts = counting
    ? job.lines.map(line => ({
        lineId: line.id,
        quantity: count(draft.counts[line.id] ?? ''),
      }))
    : undefined;

  const ordered =
    job.type === JobType.ORDER_COLLECTION
      ? catalog.flatMap(product => {
          const quantity = parseQuantity(
            draft.orderQuantities[product.id] ?? '',
          );
          return quantity === undefined ? [] : [{ product, quantity }];
        })
      : [];

  const amount = parseMoney(draft.amount, currency);
  const reference = draft.reference.trim();
  const payment =
    job.type === JobType.PAYMENT_COLLECTION
      ? {
          id: draft.paymentId,
          amount: amount ?? 0,
          method: draft.method,
          ...(reference !== '' && { reference }),
          collectedAt: collectedAt.toISOString(),
        }
      : undefined;

  const request: Omit<SubmitJobRequest, 'location'> = {
    ...(note !== '' && { note }),
    ...(checklist.length > 0 && { checklist }),
    ...(lineCounts !== undefined && { lineCounts }),
    ...(job.type === JobType.ORDER_COLLECTION && {
      orderLines: ordered.map(line => ({
        productId: line.product.id,
        quantity: line.quantity,
      })),
    }),
    ...(payment !== undefined && { payment }),
  };

  return {
    request,
    productNames: Object.fromEntries(
      ordered.map(line => [
        line.product.id,
        { name: line.product.name, sku: line.product.sku },
      ]),
    ),
    problems: submissionProblems(
      {
        type: job.type,
        requiresPhoto: job.requiresPhoto,
        photoCount: job.evidence.length,
        checklist: job.checklist,
        lines: job.lines,
        expectedAmount: job.expectedAmount,
      },
      request,
    ),
  };
}
