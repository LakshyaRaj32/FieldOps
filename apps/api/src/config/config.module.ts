import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, parseAppConfig } from './app-config.js';

/**
 * Provides the validated AppConfig to the whole application. Parsing happens while the
 * module graph is built, so invalid configuration stops the process before it listens.
 * Tests override APP_CONFIG with their own values.
 */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => parseAppConfig(process.env) },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
