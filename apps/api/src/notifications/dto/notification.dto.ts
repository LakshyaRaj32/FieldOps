import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  AppNotification,
  NotificationPage,
  RegisterPushDeviceRequest,
} from '@fieldops/types';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import type { Notification } from '../../generated/prisma/client.js';
import { NotificationType } from '../notification-enums.js';

export class NotificationDto implements AppNotification {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ enum: Object.values(NotificationType) })
  readonly type: NotificationType;

  @ApiProperty({ format: 'uuid' })
  readonly jobId: string;

  @ApiProperty({ example: 'New job assigned' })
  readonly title: string;

  @ApiProperty({ example: '“AC repair”' })
  readonly body: string;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly readAt: string | null;

  static from(row: Notification): NotificationDto {
    return Object.assign(new NotificationDto(), {
      id: row.id,
      type: row.type,
      jobId: row.jobId,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    } satisfies AppNotification);
  }
}

export class NotificationPageDto implements NotificationPage {
  @ApiProperty({ type: [NotificationDto], description: 'Newest first.' })
  readonly items: NotificationDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly nextCursor: string | null;

  @ApiProperty({ example: 2 })
  readonly unreadCount: number;
}

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit must be a whole number.' })
  @Min(1, { message: 'Limit must be between 1 and 100.' })
  @Max(100, { message: 'Limit must be between 1 and 100.' })
  readonly limit?: number;

  @ApiPropertyOptional({ description: '`nextCursor` from the previous page.' })
  @IsOptional()
  @IsString({ message: 'Cursor must be text.' })
  @MaxLength(200, { message: 'Cursor is invalid.' })
  readonly cursor?: string;
}

export class NotificationIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Notification ID must be a UUID.' })
  readonly id: string;
}

export class RegisterPushDeviceDto implements RegisterPushDeviceRequest {
  @ApiProperty({
    description:
      "The device's FCM registration token (opaque; letters, digits and : _ - only).",
    minLength: 20,
    maxLength: 512,
  })
  @IsString({ message: 'Token must be text.' })
  @MinLength(20, { message: 'Token is invalid.' })
  @MaxLength(512, { message: 'Token is invalid.' })
  @Matches(/^[A-Za-z0-9:_-]+$/, { message: 'Token is invalid.' })
  readonly token: string;
}
