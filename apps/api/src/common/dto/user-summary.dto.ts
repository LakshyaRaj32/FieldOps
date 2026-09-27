import { ApiProperty } from '@nestjs/swagger';
import type { UserSummary } from '@fieldops/types';

type UserRow = { id: string; firstName: string; lastName: string };

/** The minimal public view of a user another record refers to (an actor, an assignee...). */
export class UserSummaryDto implements UserSummary {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ example: 'Asha' })
  readonly firstName: string;

  @ApiProperty({ example: 'Verma' })
  readonly lastName: string;

  static from(user: UserRow): UserSummaryDto {
    return Object.assign(new UserSummaryDto(), {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  }
}

/** The Prisma select for UserSummaryDto.from. */
export const userSummarySelect = {
  select: { id: true, firstName: true, lastName: true },
} as const;
