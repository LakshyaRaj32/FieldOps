import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { LocalDiskObjectStorage } from './local-disk-object-storage.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';
import { S3ObjectStorage } from './s3-object-storage.js';

const logger = new Logger('Storage');

function createStorage(config: AppConfig): ObjectStorage {
  if (config.s3 !== undefined) {
    logger.log(
      `Object storage: S3-compatible bucket "${config.s3.bucket}" at ${new URL(config.s3.endpoint).host}`,
    );
    return new S3ObjectStorage(config.s3);
  }
  if (config.environment !== 'development') {
    logger.warn(
      'Object storage: local disk (STORAGE_DIR). Evidence is lost if this disk is not persistent; set STORAGE_DRIVER=s3.',
    );
  } else {
    logger.log('Object storage: local disk (STORAGE_DIR)');
  }
  return new LocalDiskObjectStorage(config.storageDir);
}

/** Binary object storage for the modules that own files (jobs: evidence). */
@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: createStorage,
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Says at startup whether the bucket is reachable. It does not stop the process: a brief
   * outage of the storage provider must not prevent the API (and its sync) from starting.
   */
  async onModuleInit(): Promise<void> {
    if (!(this.storage instanceof S3ObjectStorage)) {
      return;
    }
    try {
      await this.storage.check();
      logger.log('Bucket reachable');
    } catch (error) {
      logger.error(
        `Bucket not reachable (check S3_ENDPOINT, S3_BUCKET and the token's permissions): ${error instanceof Error ? error.name : String(error)}`,
      );
    }
  }

  onApplicationShutdown(): void {
    if (this.storage instanceof S3ObjectStorage) {
      this.storage.destroy();
    }
  }
}
