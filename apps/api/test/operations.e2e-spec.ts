import type {
  JobDetail,
  JobOverview,
  JobPage,
  JobWorkingSet,
  NotificationPage,
  OrderDetail,
  Product,
  ShopDetail,
} from '@fieldops/types';

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

const LAKH = 10_000_000;
const HOUR = 3_600_000;

/**
 * Operations of every type through their lifecycle (docs/business-domain.md,
 * "Operations"): the state machine, per-type requirements and what verification makes true.
 */
describe('Operations (e2e)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let nike: Tenant;
  let manager: Actor;
  let rahul: Actor;
  let priya: Actor;
  let shop: ShopDetail;
  let shoes: Product;
  let socks: Product;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t);
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
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
    shoes = await createProduct(t, nike.admin, 'Pegasus 41', LAKH);
    socks = await createProduct(t, nike.admin, 'Crew socks', 50_000);
  });

  const visit = () =>
    createOperation(t, manager, {
      type: 'SHOP_VISIT',
      title: 'Routine inspection',
      shopId: shop.id,
      checklist: [
        'Stock available?',
        'Display correct?',
        'New orders required?',
      ],
    });

  const inbox = async (actor: Actor) =>
    dataOf<NotificationPage>(await http.get(actor, '/notifications'));

  describe('lifecycle', () => {
    it('takes the shop’s details and walks the field lifecycle', async () => {
      const job = await visit();
      expect(job).toMatchObject({
        type: 'SHOP_VISIT',
        status: 'PENDING',
        customerName: 'Nike Chandigarh',
        address: 'Nike Chandigarh, Sector 17',
        shop: { id: shop.id, name: 'Nike Chandigarh' },
        manager: { id: manager.id },
        location: { latitude: 30.7333, longitude: 76.7794 },
        siteRadiusMeters: 300,
      });

      const assigned = await step(t, manager, job.id, 'assign', {
        workerId: rahul.id,
      });
      expect(assigned.status).toBe('ASSIGNED');
      await eventually(async () => {
        expect((await inbox(rahul)).items[0]).toMatchObject({
          type: 'JOB_ASSIGNED',
          body: 'You have been assigned a shop visit for Nike Chandigarh.',
        });
      });

      // The worker sees exactly the next step.
      const forWorker = dataOf<JobDetail>(
        await http.get(rahul, `/jobs/${job.id}`),
      );
      expect(forWorker.allowedActions).toEqual([
        'accept',
        'note',
        'evidence',
        'message',
        'decline',
      ]);

      await step(t, rahul, job.id, 'accept');
      await step(t, rahul, job.id, 'depart', {
        location: {
          latitude: 30.72,
          longitude: 76.77,
          accuracyMeters: 20,
          capturedAt: new Date().toISOString(),
        },
      });
      const arrived = await step(t, rahul, job.id, 'arrive', {
        location: {
          latitude: 30.7334,
          longitude: 76.7795,
          accuracyMeters: 8,
          capturedAt: new Date().toISOString(),
        },
      });
      expect(arrived.status).toBe('ARRIVED');
      // The server computed the distance from the shop itself.
      expect(arrived.arrivalLocation?.distanceMeters).toBeLessThan(50);
      expect(arrived.arrivedAt).not.toBeNull();

      await step(t, rahul, job.id, 'start');
      const [stock, display, orders] = arrived.checklist;
      const submitted = await step(t, rahul, job.id, 'submit', {
        note: 'All fine, display needs a new banner.',
        checklist: [
          { itemId: stock!.id, checked: true },
          { itemId: display!.id, checked: false, note: 'Banner torn' },
          { itemId: orders!.id, checked: false },
        ],
      });
      expect(submitted.status).toBe('SUBMITTED');
      expect(submitted.checklist.map(item => item.checked)).toEqual([
        true,
        false,
        false,
      ]);
      expect(submitted.checklist[1]?.responseNote).toBe('Banner torn');
      await eventually(async () => {
        expect((await inbox(manager)).items[0]?.type).toBe('JOB_SUBMITTED');
      });

      const done = await step(t, manager, job.id, 'verify');
      expect(done.status).toBe('COMPLETED');
      expect(done.allowedActions).toEqual(['message']);
      await eventually(async () => {
        expect((await inbox(rahul)).items[0]).toMatchObject({
          type: 'JOB_COMPLETED',
          body: 'Your shop visit for Nike Chandigarh was verified.',
        });
      });
    });

    it('refuses every step out of order', async () => {
      const job = await visit();
      const attempt = async (
        actor: Actor,
        action: string,
        body: object = {},
      ) => {
        const response = await http.post(
          actor,
          `/jobs/${job.id}/${action}`,
          body,
        );
        return [action, response.status, codeOf(response)];
      };
      await step(t, manager, job.id, 'assign', { workerId: rahul.id });
      expect(await attempt(rahul, 'start')).toEqual([
        'start',
        409,
        'INVALID_STATUS_TRANSITION',
      ]);
      expect(await attempt(rahul, 'depart')).toEqual([
        'depart',
        409,
        'INVALID_STATUS_TRANSITION',
      ]);
      await step(t, rahul, job.id, 'accept');
      expect((await attempt(rahul, 'arrive'))[1]).toBe(409);
      expect((await attempt(rahul, 'complete'))[1]).toBe(409);
      expect((await attempt(manager, 'verify'))[1]).toBe(409);
      await step(t, rahul, job.id, 'depart');
      await step(t, rahul, job.id, 'arrive');
      await step(t, rahul, job.id, 'start');
      expect((await attempt(rahul, 'submit'))[2]).toBe('REQUIREMENTS_NOT_MET');

      // Terminal: nothing moves a completed operation.
      const answers = dataOf<JobDetail>(
        await http.get(rahul, `/jobs/${job.id}`),
      ).checklist.map(item => ({ itemId: item.id, checked: true }));
      await step(t, rahul, job.id, 'submit', { checklist: answers });
      await step(t, manager, job.id, 'verify');
      for (const action of ['depart', 'start', 'submit']) {
        const [, status] = await attempt(rahul, action);
        expect([action, status]).toEqual([action, 409]);
      }
      expect((await attempt(rahul, 'fail', { reason: 'x' }))[1]).toBe(409);
      expect((await attempt(manager, 'cancel'))[1]).toBe(409);
    });

    it('lets the worker decline, and the manager hear why', async () => {
      const job = await visit();
      await step(t, manager, job.id, 'assign', { workerId: rahul.id });
      await step(t, rahul, job.id, 'accept');
      const declined = await step(t, rahul, job.id, 'decline', {
        reason: 'On leave that day',
      });
      expect(declined).toMatchObject({
        status: 'PENDING',
        assignedWorker: null,
      });
      expect((await http.get(rahul, `/jobs/${job.id}`)).status).toBe(404);
      await eventually(async () => {
        expect((await inbox(manager)).items[0]).toMatchObject({
          type: 'JOB_DECLINED',
          body: 'Rahul Test declined the shop visit for Nike Chandigarh. Reason: On leave that day',
        });
      });
      // Someone else can take it.
      await step(t, manager, job.id, 'assign', { workerId: priya.id });
      await step(t, priya, job.id, 'accept');
    });

    it('reschedules: an accepted operation is confirmed again', async () => {
      const job = await visit();
      await step(t, manager, job.id, 'assign', { workerId: rahul.id });
      await step(t, rahul, job.id, 'accept');
      const newTime = new Date(Date.now() + 48 * HOUR).toISOString();
      const moved = await step(t, manager, job.id, 'reschedule', {
        scheduledAt: newTime,
        reason: 'Owner away until Friday',
      });
      expect(moved).toMatchObject({
        status: 'ASSIGNED',
        scheduledAt: newTime,
        acceptedAt: null,
      });
      expect(moved.history.at(-1)).toMatchObject({
        type: 'RESCHEDULED',
        reason: 'Owner away until Friday',
      });
      await eventually(async () => {
        expect((await inbox(rahul)).items[0]?.type).toBe('JOB_RESCHEDULED');
      });
      // Not once the worker set off.
      await step(t, rahul, job.id, 'accept');
      await step(t, rahul, job.id, 'depart');
      const late = await http.post(manager, `/jobs/${job.id}/reschedule`, {
        scheduledAt: newTime,
      });
      expect(late.status).toBe(409);
      // And a PATCH can't move it silently either.
      const current = dataOf<JobDetail>(
        await http.get(manager, `/jobs/${job.id}`),
      );
      const patch = await http.patch(manager, `/jobs/${job.id}`, {
        version: current.version,
        scheduledAt: newTime,
      });
      expect(patch.status).toBe(400);
      expect(codeOf(patch)).toBe('VALIDATION_ERROR');
    });

    it('records a failure with its reason', async () => {
      const job = await visit();
      await step(t, manager, job.id, 'assign', { workerId: rahul.id });
      await step(t, rahul, job.id, 'accept');
      await step(t, rahul, job.id, 'depart');
      const failed = await step(t, rahul, job.id, 'fail', {
        reason: 'Shop closed for a festival',
      });
      expect(failed).toMatchObject({
        status: 'FAILED',
        failureReason: 'Shop closed for a festival',
      });
      await eventually(async () => {
        expect((await inbox(manager)).items[0]?.type).toBe('JOB_FAILED');
      });
    });

    it('cancels an open operation and tells the worker', async () => {
      const job = await visit();
      await step(t, manager, job.id, 'assign', { workerId: rahul.id });
      await step(t, rahul, job.id, 'accept');
      const cancelled = await step(t, manager, job.id, 'cancel', {
        reason: 'Shop closed permanently',
      });
      expect(cancelled.status).toBe('CANCELLED');
      await eventually(async () => {
        expect((await inbox(rahul)).items[0]?.type).toBe('JOB_CANCELLED');
      });
    });

    it('replays a retried worker command instead of applying it twice', async () => {
      const job = await visit();
      await step(t, manager, job.id, 'assign', { workerId: rahul.id });
      const key = newId();
      await step(t, rahul, job.id, 'accept', {}, key);
      await step(t, rahul, job.id, 'depart');
      // The lost response's retry, after the job moved on: still a success, no new event.
      const replay = await step(t, rahul, job.id, 'accept', {}, key);
      expect(replay.status).toBe('EN_ROUTE');
      expect(
        replay.history.filter(entry => entry.type === 'ACCEPTED'),
      ).toHaveLength(1);
    });

    it("never lets a worker change an operation's parameters", async () => {
      const order = await createOrder(t, manager, shop.id, [
        { productId: shoes.id, quantity: 5 },
      ]);
      const job = await createOperation(t, manager, {
        type: 'PAYMENT_COLLECTION',
        shopId: shop.id,
        orderId: order.id,
        expectedAmount: 2 * LAKH,
      });
      await step(t, manager, job.id, 'assign', { workerId: rahul.id });
      const patch = await http.patch(rahul, `/jobs/${job.id}`, {
        version: job.version + 1,
        title: 'Collect less',
      });
      expect(patch.status).toBe(403);
      // Even staff can't move an operation to another shop: it isn't an editable field.
      const move = await http.patch(manager, `/jobs/${job.id}`, {
        version: job.version + 1,
        address: 'Elsewhere',
      });
      expect(move.status).toBe(400);
    });
  });

  describe('delivery', () => {
    let order: OrderDetail;
    beforeEach(async () => {
      order = await createOrder(t, manager, shop.id, [
        { productId: shoes.id, quantity: 10 },
        { productId: socks.id, quantity: 20 },
      ]);
    });

    const delivery = () =>
      createOperation(t, manager, {
        type: 'DELIVERY',
        title: 'Deliver ORD',
        shopId: shop.id,
        orderId: order.id,
      });

    it("carries the order's undelivered items as lines", async () => {
      const job = await delivery();
      expect(job.order?.orderNumber).toBe(order.orderNumber);
      expect(
        job.lines.map(line => [line.productName, line.expectedQuantity]),
      ).toEqual([
        ['Pegasus 41', 10],
        ['Crew socks', 20],
      ]);
      expect(job.requiresPhoto).toBe(false);
    });

    it('is not complete without proof of delivery and the delivered quantities', async () => {
      const job = await delivery();
      await bringToWork(t, manager, rahul, job.id);
      const [shoeLine, sockLine] = job.lines;
      const counts = [
        { lineId: shoeLine!.id, quantity: 10 },
        { lineId: sockLine!.id, quantity: 20 },
      ];

      const noPhoto = await http.post(rahul, `/jobs/${job.id}/submit`, {
        lineCounts: counts,
      });
      expect(codeOf(noPhoto)).toBe('REQUIREMENTS_NOT_MET');
      expect(
        (noPhoto.body as { error: { message: string } }).error.message,
      ).toBe("Can't submit yet: add a photo as proof of delivery.");

      await uploadPhoto(t, rahul, job.id);
      const tooMany = await http.post(rahul, `/jobs/${job.id}/submit`, {
        lineCounts: [{ lineId: shoeLine!.id, quantity: 11 }, counts[1]],
      });
      expect(codeOf(tooMany)).toBe('REQUIREMENTS_NOT_MET');
      const missing = await http.post(rahul, `/jobs/${job.id}/submit`, {
        lineCounts: [counts[0]],
      });
      expect(codeOf(missing)).toBe('REQUIREMENTS_NOT_MET');
    });

    it('records a partial delivery on verification, and the rest later', async () => {
      const first = await delivery();
      await bringToWork(t, manager, rahul, first.id);
      await uploadPhoto(t, rahul, first.id);
      const [shoeLine, sockLine] = first.lines;
      const unexplained = await http.post(rahul, `/jobs/${first.id}/submit`, {
        lineCounts: [
          { lineId: shoeLine!.id, quantity: 8 },
          { lineId: sockLine!.id, quantity: 20 },
        ],
      });
      expect(codeOf(unexplained)).toBe('REQUIREMENTS_NOT_MET');
      await step(t, rahul, first.id, 'submit', {
        note: 'Two pairs damaged in transit',
        lineCounts: [
          { lineId: shoeLine!.id, quantity: 8 },
          { lineId: sockLine!.id, quantity: 20 },
        ],
      });

      // Nothing counts before verification.
      let current = dataOf<OrderDetail>(
        await http.get(manager, `/orders/${order.id}`),
      );
      expect(current.items.map(item => item.deliveredQuantity)).toEqual([0, 0]);

      await step(t, manager, first.id, 'verify');
      current = dataOf<OrderDetail>(
        await http.get(manager, `/orders/${order.id}`),
      );
      expect(current.status).toBe('PARTIALLY_DELIVERED');
      expect(current.items.map(item => item.deliveredQuantity)).toEqual([
        8, 20,
      ]);

      // The next delivery carries only what is left.
      const second = await delivery();
      expect(
        second.lines.map(line => [line.productName, line.expectedQuantity]),
      ).toEqual([['Pegasus 41', 2]]);
      await bringToWork(t, manager, priya, second.id);
      await uploadPhoto(t, priya, second.id);
      await step(t, priya, second.id, 'submit', {
        lineCounts: [{ lineId: second.lines[0]!.id, quantity: 2 }],
      });
      await step(t, manager, second.id, 'verify');
      current = dataOf<OrderDetail>(
        await http.get(manager, `/orders/${order.id}`),
      );
      expect(current.status).toBe('DELIVERED');

      const nothingLeft = await http.post(manager, '/jobs', {
        type: 'DELIVERY',
        title: 'Again',
        shopId: shop.id,
        orderId: order.id,
        scheduledAt: new Date(Date.now() + HOUR).toISOString(),
      });
      expect(codeOf(nothingLeft)).toBe('INVALID_REFERENCE');
    });
  });

  describe('inventory check and order collection', () => {
    it('counts the chosen products', async () => {
      const job = await createOperation(t, manager, {
        type: 'INVENTORY_CHECK',
        shopId: shop.id,
        productIds: [shoes.id, socks.id],
        checklist: ['Storeroom checked?'],
      });
      await bringToWork(t, manager, rahul, job.id);
      const submitted = await step(t, rahul, job.id, 'submit', {
        checklist: [{ itemId: job.checklist[0]!.id, checked: true }],
        lineCounts: [
          { lineId: job.lines[0]!.id, quantity: 14 },
          { lineId: job.lines[1]!.id, quantity: 0 },
        ],
      });
      expect(submitted.lines.map(line => line.quantity)).toEqual([14, 0]);
    });

    it('turns a verified order collection into an order', async () => {
      const job = await createOperation(t, manager, {
        type: 'ORDER_COLLECTION',
        title: 'Take the October order',
        shopId: shop.id,
      });
      await bringToWork(t, manager, rahul, job.id);

      // The catalog is part of the worker's offline working set now.
      const set = dataOf<JobWorkingSet>(
        await http.get(rahul, '/jobs/working-set'),
      );
      expect(set.products.map(product => product.name)).toEqual([
        'Crew socks',
        'Pegasus 41',
      ]);

      await step(t, rahul, job.id, 'submit', {
        orderLines: [
          { productId: shoes.id, quantity: 4 },
          { productId: socks.id, quantity: 10 },
        ],
      });
      const verified = await step(t, manager, job.id, 'verify', {
        orderDueDate: '2099-10-31',
      });
      expect(verified.order).not.toBeNull();
      const order = dataOf<OrderDetail>(
        await http.get(manager, `/orders/${verified.order!.id}`),
      );
      expect(order).toMatchObject({
        totalAmount: 4 * LAKH + 10 * 50_000,
        dueDate: '2099-10-31',
        sourceJobId: job.id,
        status: 'OPEN',
      });
    });
  });

  describe('lists and dashboard', () => {
    it('filters by shop and type', async () => {
      const shopVisit = await visit();
      await createOperation(t, manager, {
        type: 'ORDER_COLLECTION',
        shopId: shop.id,
      });
      const other = await createShop(t, nike.admin, 'Nike Mohali');
      await assignToShop(t, nike.admin, other.id, manager.id);
      await createOperation(t, manager, {
        type: 'SHOP_VISIT',
        shopId: other.id,
        checklist: ['x'],
      });
      const atShop = dataOf<JobPage>(
        await http.get(manager, `/jobs?shopId=${shop.id}&type=SHOP_VISIT`),
      );
      expect(atShop.items.map(job => job.id)).toEqual([shopVisit.id]);
    });

    it('builds the dashboard from real data in the manager’s scope', async () => {
      const order = await createOrder(t, manager, shop.id, [
        { productId: shoes.id, quantity: 6 },
      ]);
      // An overdue order of 3 lakh too.
      await createOrder(
        t,
        manager,
        shop.id,
        [{ productId: shoes.id, quantity: 3 }],
        {
          orderDate: '2026-08-01',
          dueDate: '2026-08-31',
        },
      );
      const collection = await createOperation(t, manager, {
        type: 'PAYMENT_COLLECTION',
        shopId: shop.id,
        orderId: order.id,
        expectedAmount: 2 * LAKH,
      });
      await bringToWork(t, manager, rahul, collection.id);
      await uploadPhoto(t, rahul, collection.id);
      await step(t, rahul, collection.id, 'submit', {
        payment: {
          id: newId(),
          amount: 2 * LAKH,
          method: 'UPI',
          reference: 'UPI-42',
          collectedAt: new Date().toISOString(),
        },
      });
      const pendingVisit = await visit();
      await step(t, manager, pendingVisit.id, 'assign', { workerId: priya.id });

      let overview = dataOf<JobOverview>(
        await http.get(manager, '/jobs/overview'),
      );
      expect(overview).toMatchObject({
        scope: 'team',
        awaitingVerification: 1,
        workers: { total: 2, busy: 0, available: 2 },
        collections: {
          currency: 'INR',
          outstanding: 9 * LAKH,
          overdue: 3 * LAKH,
          collectedToday: 0,
          pendingVerification: 2 * LAKH,
        },
        shops: { total: 1, visitedToday: 1, pendingVisits: 1 },
      });

      await step(t, manager, collection.id, 'verify');
      overview = dataOf<JobOverview>(await http.get(manager, '/jobs/overview'));
      expect(overview.collections).toMatchObject({
        outstanding: 7 * LAKH,
        collectedToday: 2 * LAKH,
        pendingVerification: 0,
      });

      // Another manager's scope doesn't include any of it.
      const other = await createMember(t, nike.admin, 'Meera', 'MANAGER');
      const theirs = dataOf<JobOverview>(
        await http.get(other, '/jobs/overview'),
      );
      expect(theirs).toMatchObject({
        workers: { total: 0 },
        collections: { outstanding: 0 },
        shops: { total: 0 },
        recentActivity: [],
      });
      // The organization admin sees the whole organization.
      const all = dataOf<JobOverview>(
        await http.get(nike.admin, '/jobs/overview'),
      );
      expect(all.scope).toBe('organization');
      expect(all.collections.outstanding).toBe(7 * LAKH);
    });
  });
});
