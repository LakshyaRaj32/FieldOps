import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalDiskObjectStorage } from './local-disk-object-storage.js';
import { isValidStorageKey, type ObjectStorage } from './object-storage.js';

describe('LocalDiskObjectStorage', () => {
  let root: string;
  // Used through the interface, as the rest of the API does.
  let storage: ObjectStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fieldops-storage-'));
    storage = new LocalDiskObjectStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores, reads back and deletes an object', async () => {
    const key = 'evidence/job-1/photo-1.jpg';
    await storage.put(key, Buffer.from([1, 2, 3]), 'image/jpeg');

    expect(await storage.get(key)).toEqual(Buffer.from([1, 2, 3]));

    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });

  it('replaces an object and leaves no temporary files behind', async () => {
    const key = 'evidence/job-1/photo-1.jpg';
    await storage.put(key, Buffer.from('first'), 'image/jpeg');
    await storage.put(key, Buffer.from('second'), 'image/jpeg');

    expect((await storage.get(key))?.toString()).toBe('second');
    expect(await readdir(join(root, 'evidence', 'job-1'))).toEqual([
      'photo-1.jpg',
    ]);
  });

  it('treats deleting a missing object as done', async () => {
    await expect(storage.delete('evidence/none.jpg')).resolves.toBeUndefined();
  });

  it('refuses keys that could leave the storage root', async () => {
    for (const key of ['../x.jpg', 'evidence/../../x', '/etc/passwd', 'A.jpg']) {
      await expect(storage.get(key)).rejects.toThrow('Invalid storage key');
    }
  });
});

describe('isValidStorageKey', () => {
  it.each([
    ['evidence/0190c0aa-1111/0190c3b1-2222.jpg', true],
    ['a', true],
    ['', false],
    ['evidence//x.jpg', false],
    ['evidence/./x.jpg', false],
    ['evidence/..', false],
    ['evidence\\x.jpg', false],
    ['evidence/X.jpg', false],
  ])('%s → %s', (key, expected) => {
    expect(isValidStorageKey(key)).toBe(expected);
  });
});
