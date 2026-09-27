import type { Product, ShopDetail } from '@fieldops/types';

import { routeFor } from '../notifications/notificationRouting';
import {
  currencyOf,
  isOrganizationAdmin,
  isStaff,
  isSuperAdmin,
  isUnaffiliated,
} from '../auth/roles';
import { orderLines, parseQuantity } from './orderForm';
import { formatCalendarDate } from './presentation';
import {
  emptyShopForm,
  parseCoordinates,
  shopToForm,
  toCreateShopRequest,
  toUpdateShopRequest,
  validateShopForm,
} from './shopForm';

const shop: ShopDetail = {
  id: 's1',
  name: 'Nike Chandigarh',
  ownerName: 'Mr. Singh',
  phone: null,
  email: null,
  address: 'SCO 12, Sector 17',
  location: { latitude: 30.7333, longitude: 76.7794 },
  status: 'ACTIVE',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  managers: [],
  workers: [],
};

describe('shop form', () => {
  it('needs a name and an address, and both coordinates or neither', () => {
    expect(Object.keys(validateShopForm(emptyShopForm())).sort()).toEqual([
      'address',
      'name',
    ]);
    expect(parseCoordinates('30.7', '')).toBeUndefined();
    expect(parseCoordinates('91', '76')).toBeUndefined();
    expect(parseCoordinates('', '')).toBeNull();
    expect(parseCoordinates(' 30.7 ', '76.8')).toEqual({
      latitude: 30.7,
      longitude: 76.8,
    });
  });

  it('creates with only what was entered', () => {
    expect(
      toCreateShopRequest({
        ...emptyShopForm(),
        name: ' Nike Mohali ',
        address: 'Phase 3B2',
      }),
    ).toEqual({ name: 'Nike Mohali', address: 'Phase 3B2' });
  });

  it('updates only what changed, clearing with null', () => {
    const form = { ...shopToForm(shop), ownerName: '', active: false };
    expect(toUpdateShopRequest(form, shop)).toEqual({
      ownerName: null,
      status: 'INACTIVE',
    });
    expect(toUpdateShopRequest(shopToForm(shop), shop)).toEqual({});
  });
});

describe('order form', () => {
  const catalog: Product[] = [
    {
      id: 'p1',
      name: 'Pegasus 41',
      sku: 'NK-41',
      category: null,
      unitPrice: 1_000_000,
      status: 'ACTIVE',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ];

  it('accepts whole positive quantities only', () => {
    expect(parseQuantity('3')).toBe(3);
    for (const text of ['', '0', '-1', '1.5', 'x']) {
      expect(parseQuantity(text)).toBeUndefined();
    }
    expect(orderLines(catalog, { p1: '2' })).toEqual([
      { product: catalog[0], quantity: 2 },
    ]);
    expect(orderLines(catalog, { p1: '' })).toEqual([]);
  });

  it('shows calendar dates without shifting them', () => {
    expect(formatCalendarDate('2026-09-30')).toBe('30 Sep 2026');
  });
});

describe('roles', () => {
  const org = {
    id: 'o1',
    name: 'Nike Operations',
    status: 'ACTIVE' as const,
    currency: 'INR',
    timeZone: 'Asia/Kolkata',
  };

  it('tells staff, admins, the platform and unaffiliated accounts apart', () => {
    expect(isStaff({ role: 'MANAGER', organization: org })).toBe(true);
    expect(isStaff({ role: 'WORKER', organization: org })).toBe(false);
    expect(
      isOrganizationAdmin({ role: 'ORGANIZATION_ADMIN', organization: org }),
    ).toBe(true);
    expect(isSuperAdmin({ role: 'SUPER_ADMIN', organization: null })).toBe(
      true,
    );
    expect(isUnaffiliated({ role: 'WORKER', organization: null })).toBe(true);
    expect(isUnaffiliated({ role: 'SUPER_ADMIN', organization: null })).toBe(
      false,
    );
    // Staff without an organization have nothing to manage.
    expect(isStaff({ role: 'MANAGER', organization: null })).toBe(false);
    expect(currencyOf({ role: 'WORKER', organization: org })).toBe('INR');
  });
});

describe('notification routes', () => {
  const id = '0192a7b2-0000-7000-8000-000000000001';

  it('opens the shop for an overdue payment, the operation otherwise', () => {
    expect(
      routeFor({ type: 'PAYMENT_OVERDUE', jobId: null, shopId: id }),
    ).toEqual({
      screen: 'shop',
      shopId: id,
    });
    expect(
      routeFor({ type: 'PAYMENT_OVERDUE', jobId: '', shopId: 'x' }),
    ).toBeNull();
    expect(routeFor({ type: 'JOB_SUBMITTED', jobId: id, shopId: id })).toEqual({
      screen: 'job',
      jobId: id,
    });
    expect(routeFor({ type: 'JOB_UNASSIGNED', jobId: id })).toEqual({
      screen: 'inbox',
    });
  });
});
