import { ApiProperty } from '@nestjs/swagger';
import type { WorkerSummary } from '@fieldops/types';

import type { User } from '../../generated/prisma/client.js';

/** What a manager needs to choose an assignee. Built explicitly, like UserProfileDto. */
export class WorkerSummaryDto implements WorkerSummary {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ example: 'Asha' })
  readonly firstName: string;

  @ApiProperty({ example: 'Verma' })
  readonly lastName: string;

  @ApiProperty({ example: 'asha.verma@example.com' })
  readonly email: string;

  static fromUser(user: User): WorkerSummaryDto {
    return Object.assign(new WorkerSummaryDto(), {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    });
  }
}
