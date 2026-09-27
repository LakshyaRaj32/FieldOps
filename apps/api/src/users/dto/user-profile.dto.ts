import { ApiProperty } from '@nestjs/swagger';
import type { OrganizationSummary, UserProfile } from '@fieldops/types';

import type { Organization, User } from '../../generated/prisma/client.js';
import { Role } from '../role.js';

export class OrganizationSummaryDto implements OrganizationSummary {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ example: 'Nike Operations' })
  readonly name: string;

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  readonly status: OrganizationSummary['status'];

  @ApiProperty({ example: 'INR' })
  readonly currency: string;

  @ApiProperty({ example: 'Asia/Kolkata' })
  readonly timeZone: string;

  static from(organization: Organization): OrganizationSummaryDto {
    return Object.assign(new OrganizationSummaryDto(), {
      id: organization.id,
      name: organization.name,
      status: organization.status,
      currency: organization.currency,
      timeZone: organization.timeZone,
    });
  }
}

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

  @ApiProperty({
    type: OrganizationSummaryDto,
    nullable: true,
    description:
      'Null for SUPER_ADMINs and for self-registered accounts no organization has added.',
  })
  readonly organization: OrganizationSummaryDto | null;

  @ApiProperty({ example: false })
  readonly organizationWideAccess: boolean;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt: string;

  static fromUser(
    user: User & { organization: Organization | null },
  ): UserProfileDto {
    return Object.assign(new UserProfileDto(), {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
      organization:
        user.organization === null
          ? null
          : OrganizationSummaryDto.from(user.organization),
      organizationWideAccess: user.organizationWideAccess,
      createdAt: user.createdAt.toISOString(),
    });
  }
}
