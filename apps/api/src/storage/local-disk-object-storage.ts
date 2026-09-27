import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import { isValidStorageKey, type ObjectStorage } from './object-storage.js';

/**
 * ObjectStorage on the local file system, under one root directory (STORAGE_DIR).
 *
 * - Writes go to a temporary file first and are renamed into place, so a crash never
 *   leaves a half-written object under its real key.
 * - Every key is validated and the resolved path must stay inside the root.
 * - The content type is not stored: the database row that references the object has it.
 */
export class LocalDiskObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { flag: 'wx' });
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(key));
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  private pathOf(key: string): string {
    if (!isValidStorageKey(key)) {
      throw new Error('Invalid storage key');
    }
    const path = resolve(this.root, ...key.split('/'));
    if (!path.startsWith(this.root + sep)) {
      throw new Error('Storage key escapes the storage root');
    }
    return path;
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
