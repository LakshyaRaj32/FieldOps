import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

import type { S3Config } from '../config/app-config.js';
import { isValidStorageKey, type ObjectStorage } from './object-storage.js';

/**
 * ObjectStorage in an S3-compatible bucket: Cloudflare R2 when deployed, MinIO in local
 * tests (docs/evidence.md, "Storage").
 *
 * The bucket is private. Objects are reached only through the API, which checks access
 * first, so the database keeps the object's key, never a URL. A PUT is atomic in S3: a
 * reader sees the old object or the new one, never part of one.
 */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Fail an upload or download instead of holding a request open.
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
      maxAttempts: 3,
      // R2 and MinIO do not support every checksum the SDK now adds by default.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: checked(key),
        Body: data,
        ContentType: contentType,
        ContentLength: data.length,
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: checked(key) }),
      );
      if (response.Body === undefined) {
        return null;
      }
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    // Deleting a missing key succeeds in S3: already idempotent.
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: checked(key),
      }),
    );
  }

  /** Whether the bucket exists and the credentials can reach it (checked at startup). */
  async check(): Promise<void> {
    await this.client.send(
      new HeadBucketCommand({ Bucket: this.config.bucket }),
    );
  }

  destroy(): void {
    this.client.destroy();
  }
}

function checked(key: string): string {
  if (!isValidStorageKey(key)) {
    throw new Error('Invalid storage key');
  }
  return key;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof NoSuchKey ||
    (error instanceof S3ServiceException &&
      (error.name === 'NoSuchKey' || error.$metadata.httpStatusCode === 404))
  );
}
