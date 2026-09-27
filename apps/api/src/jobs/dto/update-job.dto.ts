import { ApiProperty } from '@nestjs/swagger';
import type { UpdateJobRequest } from '@fieldops/types';
import { IsInt, IsOptional, Min } from 'class-validator';

import type { JobPriority } from '../job-enums.js';
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
 * Partial update of manager-owned fields. Leave a field out to keep it; `null` clears the
 * optional ones (description, location, notes). Status is not a field here: it changes only
 * through the action endpoints. The customer, address and location exist on GENERAL jobs
 * only (shop operations use the shop's); type, shop, order and amount never change.
 */
export class UpdateJobDto implements UpdateJobRequest {
  @ApiProperty({
    minimum: 1,
    example: 3,
    description:
      'The version you last read. A different current version returns 409 VERSION_CONFLICT.',
  })
  @IsInt({ message: 'Version must be a whole number.' })
  @Min(1, { message: 'Version must be a whole number.' })
  readonly version: number;

  @PresentOnly()
  @TextField('Title', JOB_LIMITS.title, { required: false })
  readonly title?: string;

  @IsOptional()
  @TextField('Description', JOB_LIMITS.description, {
    required: false,
    nullable: true,
  })
  readonly description?: string | null;

  @PresentOnly()
  @TextField('Customer', JOB_LIMITS.customerName, { required: false })
  readonly customerName?: string;

  @PresentOnly()
  @TextField('Address', JOB_LIMITS.address, { required: false })
  readonly address?: string;

  @IsOptional()
  @LocationField()
  readonly location?: GeoPointDto | null;

  @PresentOnly()
  @ScheduledAtField(false)
  readonly scheduledAt?: string;

  @PresentOnly()
  @PriorityField()
  readonly priority?: JobPriority;

  @IsOptional()
  @TextField('Notes', JOB_LIMITS.notes, { required: false, nullable: true })
  readonly notes?: string | null;

  @PresentOnly()
  @ChecklistField()
  readonly checklist?: string[];
}
