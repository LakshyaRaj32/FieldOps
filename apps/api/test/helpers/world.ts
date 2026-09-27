import { deflateSync } from 'node:zlib';

import type {
  AuthResult,
  JobDetail,
  Member,
  Organization,
  OrderDetail,
  Product,
  ShopDetail,
} from '@fieldops/types';
import { v7 as uuidv7 } from 'uuid';

import type { TestApp } from './test-app.js';

/**
 * Builds realistic multi-tenant data through the public API, the way people would: a
 * platform super admin creates organizations with their first admin, admins create members,
 * teams, shops, products and orders. Only the very first super admin is made in the
 * database (the platform has no public way to create one, by design).
 */

export const PASSWORD = 'correct horse battery staple';

export interface Actor {
  readonly id: string;
  readonly token: string;
  readonly email: string;
}

export const bearer = (actor: Actor) => ({
  Authorization: `Bearer ${actor.token}`,
});

let counter = 0;
const unique = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${(counter += 1)}@example.com`;

export function api(t: TestApp) {
  const send = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    actor: Actor | null,
    path: string,
    body?: object,
    headers: Record<string, string> = {},
  ) => {
    let request = t.http()[method](`/api/v1${path}`);
    if (actor !== null) {
      request = request.set(bearer(actor));
    }
    for (const [key, value] of Object.entries(headers)) {
      request = request.set(key, value);
    }
    return body === undefined ? request : request.send(body);
  };
  return {
    get: (actor: Actor | null, path: string) => send('get', actor, path),
    post: (
      actor: Actor | null,
      path: string,
      body: object = {},
      headers?: Record<string, string>,
    ) => send('post', actor, path, body, headers),
    patch: (actor: Actor, path: string, body: object) =>
      send('patch', actor, path, body),
    put: (actor: Actor, path: string, body: object) =>
      send('put', actor, path, body),
    delete: (actor: Actor, path: string) => send('delete', actor, path),
  };
}

export const dataOf = <T>(response: { body: unknown }): T =>
  (response.body as { data: T }).data;

export const codeOf = (response: { body: unknown }): string | undefined =>
  (response.body as { error?: { code?: string } }).error?.code;

async function login(t: TestApp, email: string): Promise<Actor> {
  const response = await t
    .http()
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD });
  if (response.status !== 200) {
    throw new Error(
      `login ${email}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  const { user, tokens } = dataOf<AuthResult>(response);
  return { id: user.id, token: tokens.accessToken, email };
}

/** A self-registered account (outside every organization). */
export async function registerAccount(
  t: TestApp,
  name: string,
): Promise<Actor> {
  const email = unique(name);
  const response = await t
    .http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, firstName: name, lastName: 'Test' });
  if (response.status !== 201) {
    throw new Error(`register: ${response.status}`);
  }
  const { user, tokens } = dataOf<AuthResult>(response);
  return { id: user.id, token: tokens.accessToken, email };
}

/** The platform operator (bootstrapped in the database, as with the operator script). */
export async function superAdmin(t: TestApp): Promise<Actor> {
  const actor = await registerAccount(t, 'Root');
  await t.prisma.user.update({
    where: { id: actor.id },
    data: { role: 'SUPER_ADMIN' },
  });
  return actor;
}

export interface Tenant {
  readonly organization: Organization;
  readonly admin: Actor;
}

/** An organization with its first admin, created by the super admin. */
export async function createTenant(
  t: TestApp,
  root: Actor,
  name: string,
): Promise<Tenant> {
  const email = unique(`${name} admin`);
  const response = await api(t).post(root, '/organizations', {
    name,
    admin: {
      email,
      password: PASSWORD,
      firstName: `${name} Admin`,
      lastName: 'Test',
    },
  });
  if (response.status !== 201) {
    throw new Error(
      `organization: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return {
    organization: dataOf<Organization>(response),
    admin: await login(t, email),
  };
}

/** A member created by the organization's admin, signed in. */
export async function createMember(
  t: TestApp,
  admin: Actor,
  firstName: string,
  role: 'WORKER' | 'MANAGER' | 'ORGANIZATION_ADMIN',
  extra: { managerId?: string; organizationWideAccess?: boolean } = {},
): Promise<Actor> {
  const email = unique(firstName);
  const response = await api(t).post(admin, '/organization/members', {
    email,
    password: PASSWORD,
    firstName,
    lastName: 'Test',
    role,
    ...extra,
  });
  if (response.status !== 201) {
    throw new Error(
      `member: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  dataOf<Member>(response);
  return login(t, email);
}

export async function createShop(
  t: TestApp,
  admin: Actor,
  name: string,
  extra: object = {},
): Promise<ShopDetail> {
  const response = await api(t).post(admin, '/shops', {
    name,
    ownerName: `${name} Owner`,
    phone: '+91 98140 00000',
    address: `${name}, Sector 17`,
    location: { latitude: 30.7333, longitude: 76.7794 },
    ...extra,
  });
  if (response.status !== 201) {
    throw new Error(
      `shop: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return dataOf<ShopDetail>(response);
}

export async function assignToShop(
  t: TestApp,
  actor: Actor,
  shopId: string,
  userId: string,
): Promise<void> {
  const response = await api(t).post(actor, `/shops/${shopId}/assignments`, {
    userId,
  });
  if (response.status !== 200) {
    throw new Error(
      `assignment: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
}

export async function createProduct(
  t: TestApp,
  admin: Actor,
  name: string,
  unitPrice: number,
): Promise<Product> {
  const response = await api(t).post(admin, '/products', {
    name,
    sku: `SKU-${(counter += 1)}`,
    unitPrice,
  });
  if (response.status !== 201) {
    throw new Error(
      `product: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return dataOf<Product>(response);
}

export async function createOrder(
  t: TestApp,
  actor: Actor,
  shopId: string,
  items: readonly { productId: string; quantity: number }[],
  dates: { orderDate?: string; dueDate?: string } = {},
): Promise<OrderDetail> {
  const response = await api(t).post(actor, '/orders', {
    shopId,
    items,
    dueDate: dates.dueDate ?? '2099-12-31',
    ...(dates.orderDate !== undefined && { orderDate: dates.orderDate }),
  });
  if (response.status !== 201) {
    throw new Error(
      `order: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return dataOf<OrderDetail>(response);
}

/** Creates an operation and asserts 201. */
export async function createOperation(
  t: TestApp,
  actor: Actor,
  body: object,
): Promise<JobDetail> {
  const response = await api(t).post(actor, '/jobs', {
    title: 'Operation',
    scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...body,
  });
  if (response.status !== 201) {
    throw new Error(
      `operation: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return dataOf<JobDetail>(response);
}

/** Runs a worker command and asserts 200. */
export async function step(
  t: TestApp,
  worker: Actor,
  jobId: string,
  action: string,
  body: object = {},
  idempotencyKey?: string,
): Promise<JobDetail> {
  const response = await api(t).post(
    worker,
    `/jobs/${jobId}/${action}`,
    body,
    idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey },
  );
  if (response.status !== 200) {
    throw new Error(
      `${action}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return dataOf<JobDetail>(response);
}

/** Assign, accept, depart, arrive, start: the operation is IN_PROGRESS. */
export async function bringToWork(
  t: TestApp,
  manager: Actor,
  worker: Actor,
  jobId: string,
): Promise<JobDetail> {
  await step(t, manager, jobId, 'assign', { workerId: worker.id });
  await step(t, worker, jobId, 'accept');
  await step(t, worker, jobId, 'depart');
  await step(t, worker, jobId, 'arrive');
  return step(t, worker, jobId, 'start');
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Uploads a photo: a valid 1x1 PNG with a different colour on every call, so the server's
 * duplicate-photo check never merges two uploads of a test.
 */
export async function uploadPhoto(
  t: TestApp,
  worker: Actor,
  jobId: string,
): Promise<void> {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); // width
  header.writeUInt32BE(1, 4); // height
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  // One scanline: filter byte, then R G B A.
  const pixel = Buffer.from([0, (counter += 1) % 256, 0x80, 0x40, 0xff]);
  const png = Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixel)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const response = await t
    .http()
    .post(`/api/v1/jobs/${jobId}/evidence`)
    .set(bearer(worker))
    .field('id', uuidv7())
    .field('capturedAt', new Date().toISOString())
    .attach('file', png, { filename: 'photo.png', contentType: 'image/png' });
  if (response.status !== 201) {
    throw new Error(
      `photo: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return crc ^ 0xffffffff;
}

export const newId = (): string => uuidv7();
