import {
  needsPhoto,
  submissionProblems,
  type SubmissionFacts,
} from './operation-requirements';

const base: SubmissionFacts = {
  type: 'SHOP_VISIT',
  requiresPhoto: false,
  photoCount: 0,
  checklist: [],
  lines: [],
  expectedAmount: null,
};

const fields = (facts: SubmissionFacts, submission: object) =>
  submissionProblems(facts, submission).map(problem => problem.field);

describe('operation requirements', () => {
  it('needs proof of delivery and a receipt photo; others only when asked', () => {
    expect(needsPhoto('DELIVERY', false)).toBe(true);
    expect(needsPhoto('PAYMENT_COLLECTION', false)).toBe(true);
    expect(needsPhoto('SHOP_VISIT', false)).toBe(false);
    expect(needsPhoto('SHOP_VISIT', true)).toBe(true);
    expect(needsPhoto('GENERAL', false)).toBe(false);
  });

  it('accepts a complete shop visit', () => {
    const facts = { ...base, checklist: [{ id: 'a' }, { id: 'b' }] };
    expect(
      submissionProblems(facts, {
        checklist: [
          { itemId: 'a', checked: true },
          { itemId: 'b', checked: false, note: 'Display damaged' },
        ],
      }),
    ).toEqual([]);
  });

  it('requires every checklist item of a visit to be answered, once', () => {
    const facts = { ...base, checklist: [{ id: 'a' }, { id: 'b' }] };
    expect(
      fields(facts, { checklist: [{ itemId: 'a', checked: true }] }),
    ).toEqual(['checklist']);
    expect(
      fields(facts, {
        checklist: [
          { itemId: 'a', checked: true },
          { itemId: 'a', checked: false },
        ],
      }),
    ).toEqual(['checklist']);
    expect(
      fields(facts, { checklist: [{ itemId: 'x', checked: true }] }),
    ).toEqual(['checklist']);
  });

  it('asks for the photo the manager required', () => {
    expect(fields({ ...base, requiresPhoto: true }, {})).toEqual(['evidence']);
    expect(
      fields({ ...base, requiresPhoto: true, photoCount: 1 }, {}),
    ).toEqual([]);
  });

  describe('delivery', () => {
    const delivery: SubmissionFacts = {
      ...base,
      type: 'DELIVERY',
      photoCount: 1,
      lines: [
        { id: 'l1', expectedQuantity: 10 },
        { id: 'l2', expectedQuantity: 5 },
      ],
    };

    it('accepts a full delivery with proof', () => {
      expect(
        fields(delivery, {
          lineCounts: [
            { lineId: 'l1', quantity: 10 },
            { lineId: 'l2', quantity: 5 },
          ],
        }),
      ).toEqual([]);
    });

    it('is not complete without proof of delivery', () => {
      expect(
        fields(
          { ...delivery, photoCount: 0 },
          {
            lineCounts: [
              { lineId: 'l1', quantity: 10 },
              { lineId: 'l2', quantity: 5 },
            ],
          },
        ),
      ).toEqual(['evidence']);
    });

    it('needs a quantity for every line, never more than ordered', () => {
      expect(
        fields(delivery, { lineCounts: [{ lineId: 'l1', quantity: 10 }] }),
      ).toEqual(['lineCounts']);
      expect(
        fields(delivery, {
          lineCounts: [
            { lineId: 'l1', quantity: 11 },
            { lineId: 'l2', quantity: 5 },
          ],
        }),
      ).toEqual(['lineCounts']);
      expect(
        fields(delivery, {
          lineCounts: [
            { lineId: 'l1', quantity: 1.5 },
            { lineId: 'l2', quantity: 5 },
          ],
        }),
      ).toEqual(['lineCounts']);
    });

    it('asks why a delivery is short', () => {
      const short = {
        lineCounts: [
          { lineId: 'l1', quantity: 8 },
          { lineId: 'l2', quantity: 5 },
        ],
      };
      expect(fields(delivery, short)).toEqual(['note']);
      expect(
        fields(delivery, { ...short, note: 'Two cartons damaged' }),
      ).toEqual([]);
    });
  });

  describe('payment collection', () => {
    const collection: SubmissionFacts = {
      ...base,
      type: 'PAYMENT_COLLECTION',
      photoCount: 1,
      expectedAmount: 20_000_000,
    };
    const payment = {
      id: '0192a7b2-0000-7000-8000-000000000001',
      amount: 20_000_000,
      method: 'BANK_TRANSFER' as const,
      reference: 'UTR123456',
      collectedAt: '2026-09-30T10:00:00.000Z',
    };

    it('accepts the expected amount with a reference and receipt', () => {
      expect(fields(collection, { payment })).toEqual([]);
    });

    it('requires the payment itself', () => {
      expect(fields(collection, {})).toEqual(['payment']);
    });

    it('requires a reference for everything but cash', () => {
      expect(
        fields(collection, { payment: { ...payment, reference: ' ' } }),
      ).toEqual(['payment.reference']);
      const { reference: _unused, ...cash } = payment;
      expect(
        fields(collection, { payment: { ...cash, method: 'CASH' } }),
      ).toEqual([]);
    });

    it('rejects zero, negative and fractional amounts', () => {
      for (const amount of [0, -5, 10.5]) {
        expect(
          fields(collection, { payment: { ...payment, amount } }),
        ).toEqual(['payment.amount']);
      }
    });

    it('asks why the amount differs from the amount to collect', () => {
      const partial = { payment: { ...payment, amount: 10_000_000 } };
      expect(fields(collection, partial)).toEqual(['note']);
      expect(
        fields(collection, { ...partial, note: 'Rest next week' }),
      ).toEqual([]);
    });

    it('needs a receipt photo', () => {
      expect(fields({ ...collection, photoCount: 0 }, { payment })).toEqual([
        'evidence',
      ]);
    });
  });

  it('takes new order lines only on an order collection', () => {
    const facts = { ...base, type: 'ORDER_COLLECTION' as const };
    expect(fields(facts, {})).toEqual(['orderLines']);
    expect(
      fields(facts, { orderLines: [{ productId: 'p', quantity: 3 }] }),
    ).toEqual([]);
    expect(
      fields(facts, {
        orderLines: [
          { productId: 'p', quantity: 3 },
          { productId: 'p', quantity: 1 },
        ],
      }),
    ).toEqual(['orderLines']);
    expect(
      fields(base, { orderLines: [{ productId: 'p', quantity: 3 }] }),
    ).toEqual(['orderLines']);
  });

  it('refuses a payment on anything but a payment collection', () => {
    expect(
      fields(base, {
        payment: {
          id: 'x',
          amount: 1,
          method: 'CASH',
          collectedAt: '2026-09-30T10:00:00.000Z',
        },
      }),
    ).toEqual(['payment']);
  });

  it('needs a count for every product of an inventory check (zero counts too)', () => {
    const facts: SubmissionFacts = {
      ...base,
      type: 'INVENTORY_CHECK',
      lines: [{ id: 'l1', expectedQuantity: null }],
    };
    expect(fields(facts, {})).toEqual(['lineCounts']);
    expect(
      fields(facts, { lineCounts: [{ lineId: 'l1', quantity: 0 }] }),
    ).toEqual([]);
  });
});
