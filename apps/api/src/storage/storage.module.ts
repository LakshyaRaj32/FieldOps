import { Global, Logger, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { LocalDiskObjectStorage } from './local-disk-object-storage.js';
import { OBJECT_STORAGE } from './object-storage.js';

/** Binary object storage for the modules that own files (jobs: evidence). */
@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const storage = new LocalDiskObjectStorage(config.storageDir);
        new Logger('Storage').log('Object storage: local disk (STORAGE_DIR)');
        return storage;
      },
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
