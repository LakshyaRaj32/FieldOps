import { readFileSync } from 'node:fs';

import { Logger, Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { NotificationsRepository } from './data/notifications.repository.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { FcmPushSender, parseServiceAccount } from './push/fcm-push-sender.js';
import {
  DisabledPushSender,
  PUSH_SENDER,
  type PushSender,
} from './push/push-sender.js';

/**
 * The push transport for this environment: FCM when a service-account file is configured,
 * otherwise disabled (said once at startup). A configured but unreadable or incomplete file
 * stops the process, like any other invalid configuration.
 */
function createPushSender(config: AppConfig, jwt: JwtService): PushSender {
  const logger = new Logger('Push');
  const file = config.fcmServiceAccountFile;
  if (file === undefined) {
    logger.warn(
      'Push notifications are disabled: FCM_SERVICE_ACCOUNT_FILE is not set.',
    );
    return new DisabledPushSender();
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(
      `Invalid configuration: FCM_SERVICE_ACCOUNT_FILE (${file}) is not a readable JSON file.`,
    );
  }
  const account = parseServiceAccount(json);
  logger.log(`Push notifications: FCM (project ${account.projectId})`);
  return new FcmPushSender(account, jwt);
}

/**
 * Notifications: the per-user inbox, push registrations and notification orchestration
 * (which events notify whom). Reacts to domain events; nothing calls it directly.
 */
@Module({
  // Signs the OAuth assertion for FCM (keys are passed per call).
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsRepository,
    {
      provide: PUSH_SENDER,
      inject: [APP_CONFIG, JwtService],
      useFactory: createPushSender,
    },
  ],
})
export class NotificationsModule {}
