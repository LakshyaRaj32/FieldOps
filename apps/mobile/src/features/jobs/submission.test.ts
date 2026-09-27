import type { JobDetail, Product } from '@fieldops/types';

import { serverJob } from '../../testing/fakeJobServer';
import { buildSubmission, emptyDraft } from './submission';

const product = (id: string, name: string): Product => ({
  id,
  name,
  sku: `SKU-${id}`,
  category: null,
  unitPrice: 100_000,
  status: 'ACTIVE',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

const job = (overrides: Partial<JobDetail>): JobDetail =>
  serverJob({ status: 'IN_PROGRESS', ...overrides });

describe('buildSubmission', () => {
  it('prefills a collection with the amount to collect, in rupees', () => {
    const draft = emptyDraft(
      job({ type: 'PAYMENT_COLLECTION', expectedAmount: 20_000_000 }),
    );
    expect(draft.amount).toBe('200000');
    expect(draft.method).toBe('CASH');
  });

  it('turns typed money into exact minor units and keeps one payment ID', () => {
    const collection = job({
      type: 'PAYMENT_COLLECTION',
      expectedAmount: 20_000_000,
      evidence: [
        {
          id: 'e1',
          contentType: 'image/jpeg',
          sizeBytes: 1,
          width: 1,
          height: 1,
          uploadedBy: serverJob().createdBy,
          capturedAt: '2026-09-27T09:00:00.000Z',
          createdAt: '2026-09-27T09:00:00.000Z',
        },
      ],
    });
    const draft = {
      ...emptyDraft(collection),
      amount: '1,50,000.50',
      method: 'UPI' as const,
      reference: ' UPI-42 ',
      note: 'Rest next week',
    };
    const first = buildSubmission(collection, draft, [], 'INR');
    const again = buildSubmission(collection, draft, [], 'INR');
    expect(first.problems).toEqual([]);
    expect(first.request.payment).toMatchObject({
      amount: 15_000_050,
      method: 'UPI',
      reference: 'UPI-42',
    });
    // A resubmission of the same draft is the same payment on the server.
    expect(again.request.payment?.id).toBe(first.request.payment?.id);
  });

  it('asks for the reference, the photo and an explanation where needed', () => {
    const collection = job({
      type: 'PAYMENT_COLLECTION',
      expectedAmount: 20_000_000,
    });
    const built = buildSubmission(
      collection,
      { ...emptyDraft(collection), amount: '1000', method: 'BANK_TRANSFER' },
      [],
      'INR',
    );
    expect(built.problems.map(problem => problem.field).sort()).toEqual(
      ['evidence', 'note', 'payment.reference'].sort(),
    );
  });

  it('prefills delivered quantities with what is to deliver', () => {
    const delivery = job({
      type: 'DELIVERY',
      lines: [
        {
          id: 'l1',
          position: 0,
          productId: 'p1',
          productName: 'Pegasus 41',
          sku: 'NK-41',
          expectedQuantity: 10,
          quantity: null,
        },
      ],
    });
    const built = buildSubmission(delivery, emptyDraft(delivery), [], 'INR');
    expect(built.request.lineCounts).toEqual([{ lineId: 'l1', quantity: 10 }]);
    // Only the proof of delivery is missing.
    expect(built.problems.map(problem => problem.field)).toEqual(['evidence']);
  });

  it('collects the ordered products with their names for the offline view', () => {
    const order = job({ type: 'ORDER_COLLECTION' });
    const catalog = [product('p1', 'Pegasus 41'), product('p2', 'Crew socks')];
    const built = buildSubmission(
      order,
      { ...emptyDraft(order), orderQuantities: { p1: '4', p2: '' } },
      catalog,
      'INR',
    );
    expect(built.problems).toEqual([]);
    expect(built.request.orderLines).toEqual([
      { productId: 'p1', quantity: 4 },
    ]);
    expect(built.productNames).toEqual({
      p1: { name: 'Pegasus 41', sku: 'SKU-p1' },
    });
  });

  it('needs every checklist item answered on a shop visit', () => {
    const visit = job({
      type: 'SHOP_VISIT',
      checklist: [
        {
          id: 'c1',
          position: 0,
          label: 'Stock?',
          checked: null,
          responseNote: null,
        },
        {
          id: 'c2',
          position: 1,
          label: 'Display?',
          checked: null,
          responseNote: null,
        },
      ],
    });
    const half = buildSubmission(
      visit,
      { ...emptyDraft(visit), answers: { c1: true } },
      [],
      'INR',
    );
    expect(half.problems.map(problem => problem.field)).toEqual(['checklist']);
    const full = buildSubmission(
      visit,
      {
        ...emptyDraft(visit),
        answers: { c1: true, c2: false },
        answerNotes: { c2: ' Banner torn ' },
      },
      [],
      'INR',
    );
    expect(full.problems).toEqual([]);
    expect(full.request.checklist).toEqual([
      { itemId: 'c1', checked: true },
      { itemId: 'c2', checked: false, note: 'Banner torn' },
    ]);
  });
});
