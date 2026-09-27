import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { trimmed } from '../../auth/dto/fields.js';

/**
 * Optional trimmed text of 1..max characters. `undefined` skips validation; `null` is
 * validated (and rejected) unless the field also carries NullableOnly().
 */
export function OptionalText(label: string, max: number): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({ minLength: 1, maxLength: max }),
    ValidateIf((_object: object, value: unknown) => value !== undefined),
    trimmed(),
    IsString({ message: `${label} must be text.` }),
    MinLength(1, { message: `${label} can't be empty.` }),
    MaxLength(max, { message: `${label} must be at most ${max} characters.` }),
  );
}

/** The field may be sent as null to clear it (validation is skipped for null and absence). */
export const NullableOnly = (): PropertyDecorator => IsOptional();

/**
 * An amount in minor units: a whole number from `min` up to a safe bound (money never
 * travels as a float).
 */
export function AmountField(
  label: string,
  options: { readonly min?: number; readonly required?: boolean } = {},
): PropertyDecorator {
  const min = options.min ?? 1;
  return applyDecorators(
    ApiPropertyOptional({
      type: Number,
      minimum: min,
      description: 'Minor units of the organization currency (paise for INR).',
      example: 20_000_000,
    }),
    ...(options.required === false ? [IsOptional()] : []),
    IsInt({ message: `${label} must be a whole number of minor units.` }),
    Min(min, { message: `${label} must be at least ${min}.` }),
    Max(1_000_000_000_000, { message: `${label} is too large.` }),
  );
}

/** Page size of a list query. */
export function LimitField(max: number, fallback: number): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({ minimum: 1, maximum: max, default: fallback }),
    IsOptional(),
    Type(() => Number),
    IsInt(),
    Min(1),
    Max(max),
  );
}
