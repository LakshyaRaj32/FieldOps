import { randomUUID } from 'node:crypto';

import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { parseAppConfig, type S3Config } from '../src/config/app-config.js';
import type { ObjectStorage } from '../src/storage/object-storage.js';
import { S3ObjectStorage } from '../src/storage/s3-object-storage.js';

/**
 * S3ObjectStorage against a real S3-compatible server (the S3Mock compose service), the
 * same API Cloudflare R2 serves. Skipped without TEST_S3_ENDPOINT. The evidence E2E tests
 * also run through it when it is set.
 */
const endpoint = process.env['TEST_S3_ENDPOINT'];

describe.skipIf(endpoint === undefined)('S3 object storage (e2e)', () => {
  let config: S3Config;
  let s3: S3ObjectStorage;
  // Used through the interface, as the rest of the API does.
  let storage: ObjectStorage;
  const key = () => `test/${randomUUID()}.jpg`;

  beforeAll(() => {
    const parsed = parseAppConfig(process.env).s3;
    if (parsed === undefined) {
      throw new Error('STORAGE_DRIVER=s3 expected with TEST_S3_ENDPOINT');
    }
    config = parsed;
    s3 = new S3ObjectStorage(config);
    storage = s3;
  });

  afterAll(() => {
    s3.destroy();
  });

  it('reaches the bucket', async () => {
    await expect(s3.check()).resolves.toBeUndefined();
  });

  it('stores, reads back and deletes an object, keeping its content type', async () => {
    const name = key();
    const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

    await storage.put(name, data, 'image/jpeg');

    expect(await storage.get(name)).toEqual(data);
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    const head = await client.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: name }),
    );
    client.destroy();
    expect(head.ContentType).toBe('image/jpeg');
    expect(head.ContentLength).toBe(data.length);

    await storage.delete(name);
    expect(await storage.get(name)).toBeNull();
  });

  it('replaces an object stored under the same key', async () => {
    const name = key();
    await storage.put(name, Buffer.from('first'), 'image/jpeg');
    await storage.put(name, Buffer.from('second'), 'image/jpeg');

    expect((await storage.get(name))?.toString()).toBe('second');
    await storage.delete(name);
  });

  it('answers null for a missing object and treats deleting one as done', async () => {
    const name = key();
    expect(await storage.get(name)).toBeNull();
    await expect(storage.delete(name)).resolves.toBeUndefined();
  });

  it('refuses invalid keys before calling the bucket', async () => {
    await expect(
      storage.put('../outside.jpg', Buffer.from('x'), 'image/jpeg'),
    ).rejects.toThrow('Invalid storage key');
    await expect(storage.get('Evidence/UPPER.jpg')).rejects.toThrow(
      'Invalid storage key',
    );
  });

  it('reports a bucket it cannot reach', async () => {
    const missing = new S3ObjectStorage({
      ...config,
      bucket: `missing-${randomUUID().slice(0, 8)}`,
    });
    await expect(missing.check()).rejects.toThrow();
    missing.destroy();
  });
});
