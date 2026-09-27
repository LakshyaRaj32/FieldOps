import type {
  AuditPage,
  JobPage,
  Member,
  Organization,
  ShopDetail,
  WorkerSummary,
} from '@fieldops/types';

import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './helpers/test-app.js';
import {
  api,
  assignToShop,
  codeOf,
  createMember,
  createOperation,
  createOrder,
  createProduct,
  createShop,
  createTenant,
  dataOf,
  PASSWORD,
  registerAccount,
  superAdmin,
  type Actor,
  type Tenant,
} from './helpers/world.js';

/**
 * Tenant isolation and scoped authorization (docs/business-domain.md, "Tenant isolation"):
 * every check here is made against the server, never trusting a client-sent organization,
 * manager, worker or shop.
 */
describe('Tenancy and authorization (e2e)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;

  let root: Actor;
  let nike: Tenant;
  let adidas: Tenant;
  let managerA: Actor;
  let managerB: Actor;
  let rahul: Actor;
  let vikram: Actor;
  let adidasManager: Actor;
  let adidasWorker: Actor;
  let chandigarh: ShopDetail;
  let mohali: ShopDetail;
  let adidasShop: ShopDetail;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t);
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    root = await superAdmin(t);
    nike = await createTenant(t, root, 'Nike Operations');
    adidas = await createTenant(t, root, 'Adidas Retail');

    managerA = await createMember(t, nike.admin, 'Raj', 'MANAGER');
    managerB = await createMember(t, nike.admin, 'Meera', 'MANAGER');
    rahul = await createMember(t, nike.admin, 'Rahul', 'WORKER', {
      managerId: managerA.id,
    });
    vikram = await createMember(t, nike.admin, 'Vikram', 'WORKER', {
      managerId: managerB.id,
    });
    chandigarh = await createShop(t, nike.admin, 'Nike Chandigarh');
    mohali = await createShop(t, nike.admin, 'Nike Mohali');
    await assignToShop(t, nike.admin, chandigarh.id, managerA.id);
    await assignToShop(t, nike.admin, mohali.id, managerB.id);

    adidasManager = await createMember(t, adidas.admin, 'Sam', 'MANAGER', {
      organizationWideAccess: true,
    });
    adidasWorker = await createMember(t, adidas.admin, 'Kiran', 'WORKER', {
      managerId: adidasManager.id,
    });
    adidasShop = await createShop(t, adidas.admin, 'Adidas Delhi');
  });

  describe('super admin', () => {
    it('manages organizations', async () => {
      const list = await http.get(root, '/organizations');
      expect(list.status).toBe(200);
      expect(dataOf<Organization[]>(list).map(org => org.name)).toEqual([
        'Adidas Retail',
        'Nike Operations',
      ]);
      expect(
        dataOf<Organization[]>(list).find(org => org.name === 'Nike Operations')
          ?.memberCount,
      ).toBe(5);

      const renamed = await http.patch(
        root,
        `/organizations/${adidas.organization.id}`,
        { contactPhone: '+91 11 4000 0000', arrivalRadiusMeters: 150 },
      );
      expect(renamed.status).toBe(200);
      expect(dataOf<Organization>(renamed).arrivalRadiusMeters).toBe(150);

      const duplicate = await http.post(root, '/organizations', {
        name: 'Nike Operations',
      });
      expect(duplicate.status).toBe(409);
      expect(codeOf(duplicate)).toBe('ALREADY_EXISTS');
    });

    it('creates organization admins', async () => {
      const response = await http.post(
        root,
        `/organizations/${adidas.organization.id}/admins`,
        {
          email: 'second.admin@example.com',
          password: PASSWORD,
          firstName: 'Second',
          lastName: 'Admin',
        },
      );
      expect(response.status).toBe(201);
      expect(dataOf<Member>(response).role).toBe('ORGANIZATION_ADMIN');
    });

    it('does no field operations', async () => {
      const jobs = await http.get(root, '/jobs');
      expect(jobs.status).toBe(403);
      expect(codeOf(jobs)).toBe('NOT_IN_ORGANIZATION');
      expect((await http.get(root, '/shops')).status).toBe(403);
      expect((await http.post(root, '/jobs', { title: 'x' })).status).toBe(403);
    });

    it('suspends and reactivates an organization', async () => {
      const suspended = await http.post(
        root,
        `/organizations/${adidas.organization.id}/suspend`,
      );
      expect(dataOf<Organization>(suspended).status).toBe('SUSPENDED');

      // Existing sessions stop at the next request; sign-in is refused.
      const blocked = await http.get(adidas.admin, '/shops');
      expect(blocked.status).toBe(403);
      expect(codeOf(blocked)).toBe('ORGANIZATION_SUSPENDED');
      const login = await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: adidas.admin.email, password: PASSWORD });
      expect(codeOf(login)).toBe('ORGANIZATION_SUSPENDED');
      // Other organizations are untouched.
      expect((await http.get(nike.admin, '/shops')).status).toBe(200);

      await http.post(
        root,
        `/organizations/${adidas.organization.id}/activate`,
      );
      expect((await http.get(adidas.admin, '/shops')).status).toBe(200);
    });

    it('is the only role that may manage the platform', async () => {
      for (const actor of [nike.admin, managerA, rahul]) {
        const response = await http.get(actor, '/organizations');
        expect(response.status).toBe(403);
      }
    });
  });

  describe('isolation between organizations', () => {
    it("never shows one organization's shops, members, products or orders to another", async () => {
      const product = await createProduct(t, nike.admin, 'Pegasus', 1_000_000);
      const order = await createOrder(t, nike.admin, chandigarh.id, [
        { productId: product.id, quantity: 2 },
      ]);

      for (const [path, what] of [
        [`/shops/${chandigarh.id}`, 'shop'],
        [`/shops/${chandigarh.id}/account`, 'account'],
        [`/orders/${order.id}`, 'order'],
        [`/products/${product.id}`, 'product'],
        [`/organization/members/${rahul.id}`, 'member'],
      ] as const) {
        const response = await http.get(adidas.admin, path);
        expect([what, response.status]).toEqual([what, 404]);
      }
      const shops = dataOf<ShopDetail[]>(
        await http.get(adidas.admin, '/shops'),
      );
      expect(shops.map(shop => shop.name)).toEqual(['Adidas Delhi']);
      const members = dataOf<Member[]>(
        await http.get(adidas.admin, '/organization/members'),
      );
      expect(members.map(member => member.id)).not.toContain(rahul.id);
    });

    it("hides another organization's operations, also by ID", async () => {
      const job = await createOperation(t, managerA, {
        type: 'SHOP_VISIT',
        shopId: chandigarh.id,
        checklist: ['Display correct?'],
      });
      const response = await http.get(adidas.admin, `/jobs/${job.id}`);
      expect(response.status).toBe(404);
      expect(
        dataOf<JobPage>(await http.get(adidas.admin, '/jobs')).items,
      ).toEqual([]);
      // Not even with a cancel or assign attempt.
      expect(
        (await http.post(adidasManager, `/jobs/${job.id}/cancel`)).status,
      ).toBe(404);
    });

    it("refuses another organization's shop, order, product or worker as a reference", async () => {
      const product = await createProduct(
        t,
        adidas.admin,
        'Ultraboost',
        900_000,
      );
      const adidasOrder = await createOrder(t, adidas.admin, adidasShop.id, [
        { productId: product.id, quantity: 1 },
      ]);

      const foreignShop = await http.post(nike.admin, '/jobs', {
        type: 'SHOP_VISIT',
        title: 'Visit',
        shopId: adidasShop.id,
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        checklist: ['Stock?'],
      });
      expect(foreignShop.status).toBe(422);
      expect(codeOf(foreignShop)).toBe('INVALID_REFERENCE');

      const foreignOrder = await http.post(nike.admin, '/jobs', {
        type: 'PAYMENT_COLLECTION',
        title: 'Collect',
        shopId: chandigarh.id,
        orderId: adidasOrder.id,
        expectedAmount: 100,
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      expect(codeOf(foreignOrder)).toBe('INVALID_REFERENCE');

      const foreignProduct = await http.post(nike.admin, '/orders', {
        shopId: chandigarh.id,
        items: [{ productId: product.id, quantity: 1 }],
        dueDate: '2099-01-01',
      });
      expect(codeOf(foreignProduct)).toBe('INVALID_REFERENCE');

      const job = await createOperation(t, nike.admin, {
        type: 'SHOP_VISIT',
        shopId: chandigarh.id,
        checklist: ['Stock?'],
      });
      const foreignWorker = await http.post(
        nike.admin,
        `/jobs/${job.id}/assign`,
        {
          workerId: adidasWorker.id,
        },
      );
      expect(foreignWorker.status).toBe(422);
      expect(codeOf(foreignWorker)).toBe('INVALID_ASSIGNEE');
    });

    it('keeps a worker out of other organizations and away from shops', async () => {
      expect((await http.get(adidasWorker, '/shops')).status).toBe(403);
      expect(
        (await http.get(adidasWorker, `/shops/${chandigarh.id}`)).status,
      ).toBe(403);
      const job = await createOperation(t, managerA, {
        type: 'SHOP_VISIT',
        shopId: chandigarh.id,
        checklist: ['Stock?'],
      });
      await http.post(managerA, `/jobs/${job.id}/assign`, {
        workerId: rahul.id,
      });
      expect((await http.get(adidasWorker, `/jobs/${job.id}`)).status).toBe(
        404,
      );
    });

    it('enforces tenancy in the database, whatever the code does', async () => {
      // A job of Nike pointing at Adidas's shop: the composite foreign key refuses it.
      const nikeRow = await t.prisma.organization.findUniqueOrThrow({
        where: { id: nike.organization.id },
      });
      await expect(
        t.prisma.job.create({
          data: {
            organizationId: nikeRow.id,
            type: 'SHOP_VISIT',
            title: 'Forged',
            customerName: 'x',
            address: 'x',
            scheduledAt: new Date(),
            managerId: managerA.id,
            createdById: managerA.id,
            shopId: adidasShop.id,
          },
        }),
      ).rejects.toThrow();
      // Nor can a Nike manager lead an Adidas worker's team.
      await expect(
        t.prisma.teamMembership.create({
          data: {
            organizationId: nike.organization.id,
            managerId: managerA.id,
            workerId: adidasWorker.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('gives self-registered accounts no business data until an organization adds them', async () => {
      const stranger = await registerAccount(t, 'Stranger');
      const response = await http.get(stranger, '/jobs');
      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('NOT_IN_ORGANIZATION');
      const me = await http.get(stranger, '/auth/me');
      expect(dataOf<{ organization: unknown }>(me).organization).toBeNull();
    });
  });

  describe('scoped managers', () => {
    it('see only the shops they cover', async () => {
      const shops = dataOf<ShopDetail[]>(await http.get(managerA, '/shops'));
      expect(shops.map(shop => shop.name)).toEqual(['Nike Chandigarh']);
      expect((await http.get(managerA, `/shops/${mohali.id}`)).status).toBe(
        404,
      );
      // Organization-wide access is granted explicitly.
      await http.patch(nike.admin, `/organization/members/${managerB.id}`, {
        organizationWideAccess: true,
      });
      const wide = dataOf<ShopDetail[]>(await http.get(managerB, '/shops'));
      expect(wide).toHaveLength(2);
    });

    it("can't create operations for shops they don't cover", async () => {
      const response = await http.post(managerA, '/jobs', {
        type: 'SHOP_VISIT',
        title: 'Visit',
        shopId: mohali.id,
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        checklist: ['Stock?'],
      });
      expect(codeOf(response)).toBe('INVALID_REFERENCE');
    });

    it("assign only their own team's workers", async () => {
      const job = await createOperation(t, managerA, {
        type: 'SHOP_VISIT',
        shopId: chandigarh.id,
        checklist: ['Stock?'],
      });
      const other = await http.post(managerA, `/jobs/${job.id}/assign`, {
        workerId: vikram.id,
      });
      expect(other.status).toBe(422);
      expect(codeOf(other)).toBe('INVALID_REFERENCE');
      const own = await http.post(managerA, `/jobs/${job.id}/assign`, {
        workerId: rahul.id,
      });
      expect(own.status).toBe(200);

      const workers = dataOf<WorkerSummary[]>(
        await http.get(managerA, '/users/workers'),
      );
      expect(workers.map(worker => worker.id)).toEqual([rahul.id]);
    });

    it("don't see another manager's operations", async () => {
      const job = await createOperation(t, managerA, {
        type: 'SHOP_VISIT',
        shopId: chandigarh.id,
        checklist: ['Stock?'],
      });
      expect((await http.get(managerB, `/jobs/${job.id}`)).status).toBe(404);
      expect(dataOf<JobPage>(await http.get(managerB, '/jobs')).items).toEqual(
        [],
      );
      // The organization admin sees everything.
      expect((await http.get(nike.admin, `/jobs/${job.id}`)).status).toBe(200);
    });

    it("assign workers of their team to their shops, and nobody else's", async () => {
      const own = await http.post(
        managerA,
        `/shops/${chandigarh.id}/assignments`,
        {
          userId: rahul.id,
        },
      );
      expect(dataOf<ShopDetail>(own).workers.map(w => w.user.id)).toEqual([
        rahul.id,
      ]);
      const foreign = await http.post(
        managerA,
        `/shops/${chandigarh.id}/assignments`,
        { userId: vikram.id },
      );
      expect(codeOf(foreign)).toBe('INVALID_REFERENCE');
    });
  });

  describe('roles', () => {
    it('keeps workers out of manager actions', async () => {
      const job = await createOperation(t, managerA, {
        type: 'SHOP_VISIT',
        shopId: chandigarh.id,
        checklist: ['Stock?'],
      });
      await http.post(managerA, `/jobs/${job.id}/assign`, {
        workerId: rahul.id,
      });

      for (const [method, path, body] of [
        ['post', '/jobs', { title: 'x' }],
        ['post', `/jobs/${job.id}/assign`, { workerId: rahul.id }],
        ['post', `/jobs/${job.id}/cancel`, {}],
        ['post', `/jobs/${job.id}/verify`, {}],
        [
          'post',
          `/jobs/${job.id}/reschedule`,
          { scheduledAt: new Date().toISOString() },
        ],
        ['patch', `/jobs/${job.id}`, { version: 1, title: 'Mine now' }],
        [
          'post',
          '/orders',
          { shopId: chandigarh.id, items: [], dueDate: '2099-01-01' },
        ],
        ['post', '/shops', { name: 'x', address: 'y' }],
        ['get', '/organization/members', undefined],
      ] as const) {
        const response =
          method === 'get'
            ? await http.get(rahul, path)
            : method === 'patch'
              ? await http.patch(rahul, path, body ?? {})
              : await http.post(rahul, path, body ?? {});
        expect([path, response.status]).toEqual([path, 403]);
      }
    });

    it('keeps managers out of administration', async () => {
      for (const [path, body] of [
        ['/shops', { name: 'x', address: 'y' }],
        ['/products', { name: 'x', sku: 'X-1', unitPrice: 1 }],
        [
          '/organization/members',
          {
            email: 'x@example.com',
            password: PASSWORD,
            firstName: 'x',
            lastName: 'y',
            role: 'WORKER',
          },
        ],
      ] as const) {
        const response = await http.post(managerA, path, body);
        expect([path, response.status]).toEqual([path, 403]);
      }
      expect((await http.get(managerA, '/audit-logs')).status).toBe(403);
    });
  });

  describe('members and teams', () => {
    it('moves a worker between teams and keeps the history', async () => {
      const moved = await http.put(
        nike.admin,
        `/organization/members/${rahul.id}/manager`,
        {
          managerId: managerB.id,
        },
      );
      expect(dataOf<Member>(moved).manager?.id).toBe(managerB.id);
      const history = await t.prisma.teamMembership.findMany({
        where: { workerId: rahul.id },
        orderBy: { startedAt: 'asc' },
      });
      expect(history.map(row => [row.managerId, row.endedAt === null])).toEqual(
        [
          [managerA.id, false],
          [managerB.id, true],
        ],
      );
    });

    it('deactivates a member at once, and never the admin themselves', async () => {
      await http.patch(nike.admin, `/organization/members/${rahul.id}`, {
        isActive: false,
      });
      const blocked = await http.get(rahul, '/jobs');
      expect(codeOf(blocked)).toBe('ACCOUNT_DISABLED');

      const self = await http.patch(
        nike.admin,
        `/organization/members/${nike.admin.id}`,
        { isActive: false },
      );
      expect(self.status).toBe(409);
    });

    it('lets people change their initial password, signing out their other sessions', async () => {
      const wrong = await http.post(rahul, '/auth/change-password', {
        currentPassword: 'not it at all',
        newPassword: 'a brand new passphrase',
      });
      expect(wrong.status).toBe(422);
      const changed = await http.post(rahul, '/auth/change-password', {
        currentPassword: PASSWORD,
        newPassword: 'a brand new passphrase',
      });
      expect(changed.status).toBe(204);
      const login = await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: rahul.email, password: 'a brand new passphrase' });
      expect(login.status).toBe(200);
    });
  });

  describe('audit log', () => {
    it('records administration and shows each organization only its own', async () => {
      const nikeLog = dataOf<AuditPage>(
        await http.get(nike.admin, '/audit-logs'),
      );
      const actions = nikeLog.items.map(entry => entry.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'organization.created',
          'member.created',
          'team.worker_assigned',
          'shop.created',
          'shop.assignment_added',
        ]),
      );
      const adidasLog = dataOf<AuditPage>(
        await http.get(adidas.admin, '/audit-logs'),
      );
      expect(
        adidasLog.items.some(entry => entry.entityId === chandigarh.id),
      ).toBe(false);
      // The platform sees every organization's.
      const all = dataOf<AuditPage>(
        await http.get(root, '/audit-logs?limit=100'),
      );
      expect(all.items.length).toBeGreaterThan(nikeLog.items.length);
    });

    it('cannot be rewritten', async () => {
      await expect(
        t.prisma.auditLog.updateMany({ data: { summary: 'nothing happened' } }),
      ).rejects.toThrow(/append-only/);
      await expect(t.prisma.auditLog.deleteMany({})).rejects.toThrow(
        /append-only/,
      );
    });
  });
});
