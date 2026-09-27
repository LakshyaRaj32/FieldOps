import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiEnvelopeResponse,
  ApiErrorResponses,
} from '../common/swagger/api-envelope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import {
  ListNotificationsQueryDto,
  NotificationIdParamDto,
  NotificationPageDto,
  RegisterPushDeviceDto,
} from './dto/notification.dto.js';
import { NotificationsService } from './notifications.service.js';

const INVALID = {
  status: HttpStatus.BAD_REQUEST,
  description: 'VALIDATION_ERROR: invalid or unknown fields.',
};
const UNAUTHENTICATED = {
  status: HttpStatus.UNAUTHORIZED,
  description: 'Not authenticated.',
};

/**
 * The signed-in user's notification inbox and this device's push registration, under
 * /api/v1/notifications. Every route acts on the caller's own data only: there is no way to
 * name another user.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'My notifications, newest first',
    description: 'Cursor-paginated, with the number of unread notifications.',
  })
  @ApiEnvelopeResponse(NotificationPageDto, { description: 'One page.' })
  @ApiErrorResponses(INVALID, UNAUTHENTICATED)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationPageDto> {
    return this.notifications.list(user, query.limit, query.cursor);
  }

  // Declared before :id/read so "read-all" is not taken for an ID.
  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark all my notifications read' })
  @ApiNoContentResponse({ description: 'Done.' })
  @ApiErrorResponses(UNAUTHENTICATED)
  markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.notifications.markAllRead(user);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one of my notifications read' })
  @ApiNoContentResponse({ description: 'Done (also if it was already read).' })
  @ApiErrorResponses(INVALID, UNAUTHENTICATED, {
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND: no such notification of yours.',
  })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: NotificationIdParamDto,
  ): Promise<void> {
    return this.notifications.markRead(user, params.id);
  }

  @Put('devices/current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Register this device's push token",
    description:
      'Binds the FCM registration token to the calling session (one per signed-in device). ' +
      'Calling it again replaces the token. Signing out removes the registration.',
  })
  @ApiNoContentResponse({ description: 'Registered.' })
  @ApiErrorResponses(INVALID, UNAUTHENTICATED)
  registerDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterPushDeviceDto,
  ): Promise<void> {
    return this.notifications.registerDevice(user, dto.token);
  }

  @Delete('devices/current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop push notifications to this device' })
  @ApiNoContentResponse({ description: 'Removed (also if there was none).' })
  @ApiErrorResponses(UNAUTHENTICATED)
  unregisterDevice(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.notifications.unregisterDevice(user);
  }
}
