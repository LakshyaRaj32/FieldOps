import type { CreateJobRequest } from '@fieldops/types';

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

/** A new job starts PENDING; assigning a worker is a separate action. */
export class CreateJobDto implements CreateJobRequest {
  @TextField('Title', JOB_LIMITS.title, { example: 'AC repair' })
  readonly title: string;

  @PresentOnly()
  @TextField('Description', JOB_LIMITS.description, {
    required: false,
    example: 'Split AC in the conference room is not cooling.',
  })
  readonly description?: string;

  @TextField('Customer', JOB_LIMITS.customerName, { example: 'ABC Ltd' })
  readonly customerName: string;

  @TextField('Address', JOB_LIMITS.address, {
    example: '12 MG Road, Bengaluru 560001',
  })
  readonly address: string;

  @PresentOnly()
  @LocationField()
  readonly location?: GeoPointDto;

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
