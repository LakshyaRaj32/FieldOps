import type { OrderDetail, Product, ShopDetail } from '@fieldops/types';

import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './helpers/test-app.js';
import {
  api,
  codeOf,
  createMember,
  createOrder,
  createProduct,
  createShop,
  createTenant,
  dataOf,
  superAdmin,
  type Actor,
  type Tenant,
} from './helpers/world.js';

/** Shops, their assignments, the catalog and orders (docs/business-domain.md, "Shops"). */
describe('Shops, products and orders (e2e)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let nike: Tenant;
  let manager: Actor;
  let rahul: Actor;
  let priya: Actor;

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
  });

  it('creates and updates a shop owned by the organization', async () => {
    const shop = await createShop(t, nike.admin, 'Nike Chandigarh');
    expect(shop).toMatchObject({
      name: 'Nike Chandigarh',
      status: 'ACTIVE',
      location: { latitude: 30.7333, longitude: 76.7794 },
      managers: [],
      workers: [],
    });
    const updated = await http.patch(nike.admin, `/shops/${shop.id}`, {
      phone: '+91 172 400 0000',
      location: null,
    });
    expect(dataOf<ShopDetail>(updated)).toMatchObject({
      phone: '+91 172 400 0000',
      location: null,
    });
    const duplicate = await http.post(nike.admin, '/shops', {
      name: 'Nike Chandigarh',
      address: 'Elsewhere',
    });
    expect(codeOf(duplicate)).toBe('ALREADY_EXISTS');
  });

  it('assigns several workers to a shop and several shops to a worker', async () => {
    const chandigarh = await createShop(t, nike.admin, 'Nike Chandigarh');
    const mohali = await createShop(t, nike.admin, 'Nike Mohali');
    for (const shop of [chandigarh, mohali]) {
      for (const person of [manager, rahul]) {
        await http.post(nike.admin, `/shops/${shop.id}/assignments`, {
          userId: person.id,
        });
      }
    }
    await http.post(nike.admin, `/shops/${chandigarh.id}/assignments`, {
      userId: priya.id,
    });
    const detail = dataOf<ShopDetail>(
      await http.get(nike.admin, `/shops/${chandigarh.id}`),
    );
    expect(detail.managers.map(entry => entry.user.id)).toEqual([manager.id]);
    expect(detail.workers.map(entry => entry.user.id).sort()).toEqual(
      [rahul.id, priya.id].sort(),
    );
    // Repeating an assignment changes nothing.
    const again = await http.post(
      nike.admin,
      `/shops/${chandigarh.id}/assignments`,
      {
        userId: rahul.id,
      },
    );
    expect(dataOf<ShopDetail>(again).workers).toHaveLength(2);
    const rahulShops = await t.prisma.shopAssignment.count({
      where: { userId: rahul.id, endedAt: null },
    });
    expect(rahulShops).toBe(2);
  });

  it('reassigns: an ended assignment stays as history', async () => {
    const shop = await createShop(t, nike.admin, 'Nike Panchkula');
    await http.post(nike.admin, `/shops/${shop.id}/assignments`, {
      userId: rahul.id,
    });
    const ended = await http.delete(
      nike.admin,
      `/shops/${shop.id}/assignments/${rahul.id}`,
    );
    expect(dataOf<ShopDetail>(ended).workers).toEqual([]);
    await http.post(nike.admin, `/shops/${shop.id}/assignments`, {
      userId: priya.id,
    });
    await http.post(nike.admin, `/shops/${shop.id}/assignments`, {
      userId: rahul.id,
    });
    const rows = await t.prisma.shopAssignment.findMany({
      where: { shopId: shop.id, userId: rahul.id },
      orderBy: { startedAt: 'asc' },
    });
    expect(rows.map(row => row.endedAt === null)).toEqual([false, true]);
  });

  it('manages a catalog with unique SKUs, and keeps order prices when a price changes', async () => {
    const product = await createProduct(t, nike.admin, 'Pegasus 41', 1_199_500);
    const taken = await http.post(nike.admin, '/products', {
      name: 'Another',
      sku: product.sku.toLowerCase(),
      unitPrice: 100,
    });
    expect(codeOf(taken)).toBe('ALREADY_EXISTS');

    const shop = await createShop(t, nike.admin, 'Nike Delhi');
    await http.post(nike.admin, `/shops/${shop.id}/assignments`, {
      userId: manager.id,
    });
    const order = await createOrder(t, manager, shop.id, [
      { productId: product.id, quantity: 3 },
    ]);
    expect(order).toMatchObject({
      totalAmount: 3 * 1_199_500,
      items: [
        expect.objectContaining({
          productName: 'Pegasus 41',
          unitPrice: 1_199_500,
          lineTotal: 3 * 1_199_500,
        }),
      ],
    });

    await http.patch(nike.admin, `/products/${product.id}`, {
      unitPrice: 1_299_500,
    });
    const unchanged = dataOf<OrderDetail>(
      await http.get(manager, `/orders/${order.id}`),
    );
    expect(unchanged.totalAmount).toBe(3 * 1_199_500);

    // An archived product can't be ordered any more.
    await http.patch(nike.admin, `/products/${product.id}`, {
      status: 'ARCHIVED',
    });
    const archived = await http.post(manager, '/orders', {
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      dueDate: '2099-01-01',
    });
    expect(codeOf(archived)).toBe('INVALID_REFERENCE');
    const workerView = dataOf<Product[]>(await http.get(rahul, '/products'));
    expect(workerView).toEqual([]);
  });

  it('numbers orders per organization and validates them', async () => {
    const shop = await createShop(t, nike.admin, 'Nike Ambala');
    const product = await createProduct(t, nike.admin, 'Socks', 50_000);
    const first = await createOrder(t, nike.admin, shop.id, [
      { productId: product.id, quantity: 1 },
    ]);
    const second = await createOrder(t, nike.admin, shop.id, [
      { productId: product.id, quantity: 1 },
    ]);
    expect([first.orderNumber, second.orderNumber]).toEqual([
      'ORD-1001',
      'ORD-1002',
    ]);

    const backwards = await http.post(nike.admin, '/orders', {
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      orderDate: '2026-09-30',
      dueDate: '2026-09-01',
    });
    expect(backwards.status).toBe(400);
    const twice = await http.post(nike.admin, '/orders', {
      shopId: shop.id,
      items: [
        { productId: product.id, quantity: 1 },
        { productId: product.id, quantity: 2 },
      ],
      dueDate: '2099-01-01',
    });
    expect(twice.status).toBe(400);
    const empty = await http.post(nike.admin, '/orders', {
      shopId: shop.id,
      items: [],
      dueDate: '2099-01-01',
    });
    expect(empty.status).toBe(400);

    // Cancelling an untouched order is fine; inactive shops take no new orders.
    const cancelled = await http.post(
      nike.admin,
      `/orders/${first.id}/cancel`,
      {
        reason: 'Entered twice',
      },
    );
    expect(dataOf<OrderDetail>(cancelled)).toMatchObject({
      status: 'CANCELLED',
      outstandingAmount: 0,
    });
    await http.patch(nike.admin, `/shops/${shop.id}`, { status: 'INACTIVE' });
    const inactive = await http.post(nike.admin, '/orders', {
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      dueDate: '2099-01-01',
    });
    expect(codeOf(inactive)).toBe('INVALID_REFERENCE');
  });
});
