import { ApiProperty } from '@nestjs/swagger';
import type { AssignJobRequest, CancelJobRequest } from '@fieldops/types';
import { IsUUID } from 'class-validator';

import { JOB_LIMITS, PresentOnly, TextField } from './job-fields.js';

export class JobIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Job ID must be a UUID.' })
  readonly id: string;
}

export class AssignJobDto implements AssignJobRequest {
  @ApiProperty({
    format: 'uuid',
    description:
      'An active user with the WORKER role (see GET /api/v1/users/workers).',
  })
  @IsUUID('all', { message: 'Worker ID must be a UUID.' })
  readonly workerId: string;
}

export class CancelJobDto implements CancelJobRequest {
  @PresentOnly()
  @TextField('Reason', JOB_LIMITS.cancellationReason, {
    required: false,
    example: 'Customer rescheduled the visit.',
  })
  readonly reason?: string;
}
