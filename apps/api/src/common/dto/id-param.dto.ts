import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** `:id` route parameter. A malformed ID is a validation error, never a database error. */
export class IdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'ID must be a valid UUID.' })
  readonly id: string;
}
