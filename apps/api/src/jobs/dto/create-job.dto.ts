import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { CreateJobRequest } from '@fieldops/types';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsUUID,
  ValidateIf,
} from 'class-validator';

import { AmountField } from '../../common/dto/fields.js';
import { JobType, type JobPriority } from '../job-enums.js';
import {
  ChecklistField,
  GeoPointDto,
  JOB_LIMITS,
  LocationField,
  PresentOnly,
  PriorityField,
  ScheduledAtField,
  TextField,
} from './job-fields.js';

/**
 * Required for GENERAL jobs (the default type), validated whenever sent. So a GENERAL job
 * without a customer is reported together with every other invalid field.
 */
const RequiredForGeneral = (label: string): PropertyDecorator =>
  applyDecorators(
    ValidateIf(
      (object: CreateJobDto, value: unknown) =>
        value !== undefined ||
        (object.type ?? JobType.GENERAL) === JobType.GENERAL,
    ),
    IsDefined({ message: `${label} is required.` }),
  );

/**
 * A new operation starts PENDING; assigning a worker is a separate action. What else is
 * needed depends on the type (checked by JobsService, docs/api.md "Operations"):
 * GENERAL takes a customer and address; every other type takes a shop, and deliveries and
 * payment collections an order of that shop.
 */
export class CreateJobDto implements CreateJobRequest {
  @ApiPropertyOptional({
    enum: Object.values(JobType),
    default: JobType.GENERAL,
  })
  @PresentOnly()
  @IsEnum(JobType, {
    message: `Type must be one of ${Object.values(JobType).join(', ')}.`,
  })
  readonly type?: JobType;

  @TextField('Title', JOB_LIMITS.title, { example: 'Collect September dues' })
  readonly title: string;

  @PresentOnly()
  @TextField('Description', JOB_LIMITS.description, {
    required: false,
    example: 'Split AC in the conference room is not cooling.',
  })
  readonly description?: string;

  @RequiredForGeneral('Customer')
  @TextField('Customer', JOB_LIMITS.customerName, {
    required: false,
    example: 'ABC Ltd',
    description: 'GENERAL only; shop operations take the shop’s name.',
  })
  readonly customerName?: string;

  @RequiredForGeneral('Address')
  @TextField('Address', JOB_LIMITS.address, {
    required: false,
    example: '12 MG Road, Bengaluru 560001',
    description: 'GENERAL only; shop operations take the shop’s address.',
  })
  readonly address?: string;

  @PresentOnly()
  @LocationField()
  readonly location?: GeoPointDto;

  @ApiPropertyOptional({ format: 'uuid' })
  @PresentOnly()
  @IsUUID('all', { message: 'Shop must be a valid ID.' })
  readonly shopId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @PresentOnly()
  @IsUUID('all', { message: 'Order must be a valid ID.' })
  readonly orderId?: string;

  @PresentOnly()
  @AmountField('Expected amount', { required: false })
  readonly expectedAmount?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'INVENTORY_CHECK: the products to count.',
  })
  @PresentOnly()
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one product to count.' })
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true, message: 'Products must be valid IDs.' })
  readonly productIds?: string[];

  @ApiPropertyOptional({ default: false })
  @PresentOnly()
  @IsBoolean()
  readonly requiresPhoto?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'ORGANIZATION_ADMIN: the responsible manager (default: the admin). Managers are always responsible for what they create.',
  })
  @PresentOnly()
  @IsUUID('all', { message: 'Manager must be a valid ID.' })
  readonly managerId?: string;

  @ScheduledAtField(true)
  readonly scheduledAt: string;

  @PresentOnly()
  @PriorityField()
  readonly priority?: JobPriority;

  @PresentOnly()
  @TextField('Notes', JOB_LIMITS.notes, {
    required: false,
    example: 'Ask for Mr. Rao at reception.',
  })
  readonly notes?: string;

  @PresentOnly()
  @ChecklistField()
  readonly checklist?: string[];
}
