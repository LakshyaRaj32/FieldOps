import { ApiProperty } from '@nestjs/swagger';
import type { UserProfile } from '@fieldops/types';

import type { User } from '../../generated/prisma/client.js';
import { Role } from '../role.js';

/** Public user representation. Built explicitly, so the password hash can never leak. */
export class UserProfileDto implements UserProfile {
  @ApiProperty({
    format: 'uuid',
    example: '01927c4e-7a52-7cc1-a3b5-3c8e1f7e2a10',
  })
  readonly id: string;

  @ApiProperty({ example: 'worker@example.com' })
  readonly email: string;

  @ApiProperty({ example: 'Asha' })
  readonly firstName: string;

  @ApiProperty({ example: 'Verma' })
  readonly lastName: string;

  @ApiProperty({ enum: Object.values(Role), example: Role.WORKER })
  readonly role: Role;

  @ApiProperty({ example: true })
  readonly isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt: string;

  static fromUser(user: User): UserProfileDto {
    return Object.assign(new UserProfileDto(), {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    });
  }
}
