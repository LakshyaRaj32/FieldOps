import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { JobStatus } from '../job-enums.js';

export class ListJobsQueryDto {
  @ApiPropertyOptional({
    description:
      'Comma-separated statuses to include, for example `ASSIGNED,IN_PROGRESS`. Default: all.',
    example: 'ASSIGNED,IN_PROGRESS',
    type: String,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map(status => status.trim())
          .filter(status => status !== '')
      : value,
  )
  @IsEnum(JobStatus, {
    each: true,
    message: `Status must be one of ${Object.values(JobStatus).join(', ')}.`,
  })
  readonly status?: JobStatus[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Managers and admins: only jobs assigned to this worker. Workers always get their own jobs.',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Worker ID must be a UUID.' })
  readonly assignedWorkerId?: string;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'asc',
    description:
      'By scheduled time: `asc` (next first) or `desc` (latest first).',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'Order must be asc or desc.' })
  readonly order?: 'asc' | 'desc';

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit must be a whole number.' })
  @Min(1, { message: 'Limit must be between 1 and 100.' })
  @Max(100, { message: 'Limit must be between 1 and 100.' })
  readonly limit?: number;

  @ApiPropertyOptional({
    description: '`nextCursor` from the previous page.',
  })
  @IsOptional()
  @IsString({ message: 'Cursor must be text.' })
  @MaxLength(200, { message: 'Cursor is invalid.' })
  readonly cursor?: string;
}
