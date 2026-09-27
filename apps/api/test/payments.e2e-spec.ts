import type {
  AppNotification,
  AuditPage,
  JobDetail,
  NotificationPage,
  OrderDetail,
  ShopAccount,
  ShopDetail,
} from '@fieldops/types';

import { OverdueService } from '../src/shops/overdue.service.js';
import {
  createTestApp,
  eventually,
  resetDatabase,
  type TestApp,
} from './helpers/test-app.js';
import {
  api,
  assignToShop,
  bringToWork,
  codeOf,
  createMember,
  createOperation,
  createOrder,
  createProduct,
  createShop,
  createTenant,
  dataOf,
  newId,
  step,
  superAdmin,
  uploadPhoto,
  type Actor,
  type Tenant,
} from './helpers/world.js';

/** ₹1,00,000 in paise. */
const LAKH = 10_000_000;

/**
 * Payment collection and the ledger (docs/business-domain.md, "Money"): balances derived from
 * verified payments only, partial payments, no overpayment, no duplicate, verification and
 * rejection, overdue notifications.
 */
describe('Payments and collections (e2e)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let nike: Tenant;
  let manager: Actor;
  let rahul: Actor;
  let priya: Actor;
  let shop: ShopDetail;
  let order: OrderDetail;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t);
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.push.reset();
    const root = await superAdmin(t);
    nike = await createTenant(t, root, 'Nike Operations');
    manager = await createMember(t, nike.admin, 'Raj', 'MANAGER');
    rahul = await createMember(t, nike.admin, 'Rahul', 'WORKER', {
      managerId: manager.id,
    });
    priya = await createMember(t, nike.admin, 'Priya', 'WORKER', {
      managerId: manager.id,
    });
    shop = await createShop(t, nike.admin, 'Nike Chandigarh');
    await assignToShop(t, nike.admin, shop.id, manager.id);
    const shoes = await createProduct(t, nike.admin, 'Pegasus 41', LAKH);
    // ₹10,00,000: ten pairs at ₹1,00,000 (a wholesale lot).
    order = await createOrder(t, manager, shop.id, [
      { productId: shoes.id, quantity: 10 },
    ]);
  });

  const account = async (): Promise<ShopAccount> =>
    dataOf<ShopAccount>(await http.get(manager, `/shops/${shop.id}/account`));

  const collection = (expectedAmount: number) =>
    createOperation(t, manager, {
      type: 'PAYMENT_COLLECTION',
      title: 'Collect September dues',
      shopId: shop.id,
      orderId: order.id,
      expectedAmount,
      priority: 'HIGH',
    });

  const payment = (
    amount: number,
    reference: string | undefined = newId(),
  ) => ({
    id: newId(),
    amount,
    method: reference === undefined ? 'CASH' : 'BANK_TRANSFER',
    ...(reference !== undefined && { reference }),
    collectedAt: new Date().toISOString(),
  });

  /** Brings a collection to IN_PROGRESS with a receipt photo, ready to submit. */
  async function readyToSubmit(
    expectedAmount: number,
    worker: Actor = rahul,
  ): Promise<JobDetail> {
    const job = await collection(expectedAmount);
    await bringToWork(t, manager, worker, job.id);
    await uploadPhoto(t, worker, job.id);
    return job;
  }

  async function collect(
    amount: number,
    worker: Actor = rahul,
  ): Promise<JobDetail> {
    const job = await readyToSubmit(amount, worker);
    await step(t, worker, job.id, 'submit', { payment: payment(amount) });
    return step(t, manager, job.id, 'verify');
  }

  it('starts with the full order outstanding', async () => {
    expect(order).toMatchObject({
      orderNumber: 'ORD-1001',
      totalAmount: 10 * LAKH,
      paidAmount: 0,
      outstandingAmount: 10 * LAKH,
      paymentState: 'UNPAID',
    });
    expect(await account()).toMatchObject({
      totalOrdered: 10 * LAKH,
      outstanding: 10 * LAKH,
      pendingVerification: 0,
    });
  });

  it('collects a payment: submitted, verified, then the balance falls', async () => {
    const job = await readyToSubmit(2 * LAKH);

    const submitted = await step(t, rahul, job.id, 'submit', {
      payment: payment(2 * LAKH, 'utr 0001 2345'),
    });
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.payments).toEqual([
      expect.objectContaining({
        amount: 2 * LAKH,
        method: 'BANK_TRANSFER',
        // Normalized, so the duplicate check ignores spacing and case.
        reference: 'UTR00012345',
        status: 'PENDING_VERIFICATION',
      }),
    ]);
    // Not money yet: only pending.
    expect(await account()).toMatchObject({
      outstanding: 10 * LAKH,
      pendingVerification: 2 * LAKH,
    });

    // The manager is asked to verify.
    await eventually(async () => {
      const inbox = dataOf<NotificationPage>(
        await http.get(manager, '/notifications'),
      );
      expect(inbox.items[0]).toMatchObject({
        type: 'JOB_SUBMITTED',
        title: 'Payment collection requires verification',
        body: 'Rahul Test submitted a ₹2,00,000 collection from Nike Chandigarh.',
        jobId: job.id,
        shopId: shop.id,
      });
    });

    const verified = await step(t, manager, job.id, 'verify');
    expect(verified.status).toBe('COMPLETED');
    expect(verified.payments[0]).toMatchObject({
      status: 'VERIFIED',
      verifiedBy: expect.objectContaining({ id: manager.id }),
    });
    expect(await account()).toMatchObject({
      totalPaid: 2 * LAKH,
      outstanding: 8 * LAKH,
      pendingVerification: 0,
    });
    const after = dataOf<OrderDetail>(
      await http.get(manager, `/orders/${order.id}`),
    );
    expect(after).toMatchObject({
      paidAmount: 2 * LAKH,
      outstandingAmount: 8 * LAKH,
      paymentState: 'PARTIALLY_PAID',
    });

    // The history tells the whole story.
    expect(verified.history.map(entry => [entry.type, entry.actor.id])).toEqual(
      [
        ['CREATED', manager.id],
        ['ASSIGNED', manager.id],
        ['ACCEPTED', rahul.id],
        ['DEPARTED', rahul.id],
        ['ARRIVED', rahul.id],
        ['STARTED', rahul.id],
        ['SUBMITTED', rahul.id],
        ['VERIFIED', manager.id],
      ],
    );
    const audit = dataOf<AuditPage>(
      await http.get(nike.admin, `/audit-logs?entityType=payment`),
    );
    expect(audit.items.map(entry => entry.action).sort()).toEqual([
      'payment.submitted',
      'payment.verified',
    ]);
  });

  it('supports multiple partial payments down to zero', async () => {
    await collect(2 * LAKH);
    await collect(1 * LAKH, priya);
    expect((await account()).outstanding).toBe(7 * LAKH);
    await collect(7 * LAKH);
    const done = dataOf<OrderDetail>(
      await http.get(manager, `/orders/${order.id}`),
    );
    expect(done).toMatchObject({
      paidAmount: 10 * LAKH,
      outstandingAmount: 0,
      paymentState: 'PAID',
    });
    expect(done.payments.map(p => p.amount)).toEqual([
      2 * LAKH,
      LAKH,
      7 * LAKH,
    ]);
    // Nothing left to send anyone to collect.
    const more = await http.post(manager, '/jobs', {
      type: 'PAYMENT_COLLECTION',
      title: 'Again',
      shopId: shop.id,
      orderId: order.id,
      expectedAmount: 1,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(codeOf(more)).toBe('AMOUNT_EXCEEDS_BALANCE');
  });

  it('never sends two workers to collect the same money', async () => {
    await collection(6 * LAKH);
    const second = await http.post(manager, '/jobs', {
      type: 'PAYMENT_COLLECTION',
      title: 'Also collect',
      shopId: shop.id,
      orderId: order.id,
      expectedAmount: 5 * LAKH,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(second.status).toBe(422);
    expect(codeOf(second)).toBe('AMOUNT_EXCEEDS_BALANCE');
    expect((second.body as { error: { message: string } }).error.message).toBe(
      'The amount exceeds what is left to collect: ₹4,00,000.',
    );
  });

  it('refuses an amount above the remaining balance', async () => {
    const first = await readyToSubmit(8 * LAKH);
    await step(t, rahul, first.id, 'submit', { payment: payment(8 * LAKH) });
    // ₹8,00,000 waits for verification: only ₹2,00,000 can still be collected.
    const second = await readyToSubmit(2 * LAKH, priya);
    const response = await http.post(priya, `/jobs/${second.id}/submit`, {
      payment: payment(3 * LAKH),
      note: 'Owner paid extra',
    });
    expect(response.status).toBe(422);
    expect(codeOf(response)).toBe('AMOUNT_EXCEEDS_BALANCE');
    expect(
      (response.body as { error: { message: string } }).error.message,
    ).toBe('Amount exceeds the remaining balance of ₹2,00,000.');
    // Nothing was recorded, and the operation is still in progress.
    expect(
      dataOf<JobDetail>(await http.get(priya, `/jobs/${second.id}`)).status,
    ).toBe('IN_PROGRESS');
  });

  it('rejects invalid amounts and incomplete payments', async () => {
    const job = await readyToSubmit(2 * LAKH);
    for (const amount of [0, -100, 1.5]) {
      const response = await http.post(rahul, `/jobs/${job.id}/submit`, {
        payment: payment(amount),
      });
      expect([amount, response.status]).toEqual([amount, 400]);
    }
    const noReference = await http.post(rahul, `/jobs/${job.id}/submit`, {
      payment: { ...payment(2 * LAKH), reference: undefined },
    });
    expect(codeOf(noReference)).toBe('REQUIREMENTS_NOT_MET');
    const noPayment = await http.post(rahul, `/jobs/${job.id}/submit`, {});
    expect(codeOf(noPayment)).toBe('REQUIREMENTS_NOT_MET');
    // A different amount than asked for needs an explanation.
    const unexplained = await http.post(rahul, `/jobs/${job.id}/submit`, {
      payment: payment(LAKH),
    });
    expect(codeOf(unexplained)).toBe('REQUIREMENTS_NOT_MET');
    const explained = await http.post(rahul, `/jobs/${job.id}/submit`, {
      payment: payment(LAKH),
      note: 'Owner will pay the rest next week',
    });
    expect(explained.status).toBe(200);
  });

  it('needs a receipt photo before a collection can be submitted', async () => {
    const job = await collection(2 * LAKH);
    await bringToWork(t, manager, rahul, job.id);
    const response = await http.post(rahul, `/jobs/${job.id}/submit`, {
      payment: payment(2 * LAKH),
    });
    expect(response.status).toBe(422);
    expect(codeOf(response)).toBe('REQUIREMENTS_NOT_MET');
    expect(
      (response.body as { error: { details: { field: string }[] } }).error
        .details,
    ).toEqual([
      {
        field: 'evidence',
        message: 'Add a photo of the receipt or payment confirmation.',
      },
    ]);
  });

  it('records a payment once, however often it is sent', async () => {
    const job = await readyToSubmit(2 * LAKH);
    const body = { payment: payment(2 * LAKH) };
    const key = newId();

    // A retry after a lost response (same key)...
    await step(t, rahul, job.id, 'submit', body, key);
    await step(t, rahul, job.id, 'submit', body, key);
    expect(await t.prisma.payment.count()).toBe(1);

    // ...and taps at once on a fresh collection (same payment ID, no key).
    const racing = await readyToSubmit(LAKH, priya);
    const raced = { payment: payment(LAKH) };
    const taps = await Promise.all(
      Array.from({ length: 5 }, () =>
        http.post(priya, `/jobs/${racing.id}/submit`, raced),
      ),
    );
    expect(taps.map(response => response.status)).toEqual([
      200, 200, 200, 200, 200,
    ]);

    expect(await t.prisma.payment.count()).toBe(2);
    expect((await account()).pendingVerification).toBe(3 * LAKH);
  });

  it('refuses a payment reference that was already recorded', async () => {
    const first = await readyToSubmit(LAKH);
    await step(t, rahul, first.id, 'submit', {
      payment: payment(LAKH, 'UTR-777'),
    });
    const second = await readyToSubmit(LAKH, priya);
    const duplicate = await http.post(priya, `/jobs/${second.id}/submit`, {
      payment: payment(LAKH, ' utr-777 '),
    });
    expect(duplicate.status).toBe(409);
    expect(codeOf(duplicate)).toBe('DUPLICATE_PAYMENT_REFERENCE');
  });

  it('rejects a payment: it never counts, and the worker can correct it', async () => {
    const job = await readyToSubmit(2 * LAKH);
    await step(t, rahul, job.id, 'submit', {
      payment: payment(2 * LAKH, 'UTR-1'),
    });

    const rejected = await step(t, manager, job.id, 'reject', {
      reason: 'The receipt photo is unreadable',
    });
    expect(rejected.status).toBe('IN_PROGRESS');
    expect(rejected.payments[0]).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'The receipt photo is unreadable',
    });
    expect(await account()).toMatchObject({
      outstanding: 10 * LAKH,
      pendingVerification: 0,
    });
    await eventually(async () => {
      const inbox = dataOf<NotificationPage>(
        await http.get(rahul, '/notifications'),
      );
      expect(inbox.items[0]).toMatchObject<Partial<AppNotification>>({
        type: 'JOB_REJECTED',
        body: 'Your payment collection for Nike Chandigarh was sent back. Reason: The receipt photo is unreadable',
      });
    });

    // A rejected reference is free again; the corrected submission counts once verified.
    await uploadPhoto(t, rahul, job.id);
    await step(t, rahul, job.id, 'submit', {
      payment: payment(2 * LAKH, 'UTR-1'),
    });
    await step(t, manager, job.id, 'verify');
    expect((await account()).outstanding).toBe(8 * LAKH);
  });

  it('keeps the money unchanged when a collection is cancelled or fails', async () => {
    const cancelled = await collection(2 * LAKH);
    await step(t, manager, cancelled.id, 'cancel', { reason: 'Paid online' });
    const failed = await readyToSubmit(2 * LAKH);
    await step(t, rahul, failed.id, 'fail', { reason: 'Shop closed' });
    expect(await account()).toMatchObject({
      outstanding: 10 * LAKH,
      pendingVerification: 0,
    });
    // A submitted collection must be decided, not cancelled.
    const submitted = await readyToSubmit(LAKH, priya);
    await step(t, priya, submitted.id, 'submit', { payment: payment(LAKH) });
    const cancel = await http.post(manager, `/jobs/${submitted.id}/cancel`, {});
    expect(cancel.status).toBe(409);
    expect(codeOf(cancel)).toBe('INVALID_STATUS_TRANSITION');
  });

  it("doesn't let an order with payments be cancelled", async () => {
    await collect(LAKH);
    const response = await http.post(manager, `/orders/${order.id}/cancel`, {
      reason: 'Mistake',
    });
    expect(response.status).toBe(409);
    expect(codeOf(response)).toBe('ORDER_NOT_CANCELLABLE');
  });

  it("keeps the database's invariant even if code tried to overpay", async () => {
    await expect(
      t.prisma.order.update({
        where: { id: order.id },
        data: { paidAmount: 11 * LAKH },
      }),
    ).rejects.toThrow();
  });

  it('notifies the shop’s managers of an overdue payment, once', async () => {
    const overdueOrder = await createOrder(
      t,
      manager,
      shop.id,
      [{ productId: order.items[0]!.productId, quantity: 3 }],
      { orderDate: '2026-08-01', dueDate: '2026-08-31' },
    );
    expect(overdueOrder.isOverdue).toBe(true);
    expect((await account()).overdue).toBe(3 * LAKH);

    const scanner = t.app.get(OverdueService);
    expect(await scanner.scan()).toBe(1);
    expect(await scanner.scan()).toBe(0);

    for (const person of [manager, nike.admin]) {
      await eventually(async () => {
        const inbox = dataOf<NotificationPage>(
          await http.get(person, '/notifications'),
        );
        expect(inbox.items[0]).toMatchObject({
          type: 'PAYMENT_OVERDUE',
          jobId: null,
          shopId: shop.id,
          body: `Nike Chandigarh has an overdue payment of ₹3,00,000 (${overdueOrder.orderNumber}).`,
        });
      });
    }
    // Workers are not told about money.
    const workerInbox = dataOf<NotificationPage>(
      await http.get(rahul, '/notifications'),
    );
    expect(workerInbox.items.some(n => n.type === 'PAYMENT_OVERDUE')).toBe(
      false,
    );
  });
});
