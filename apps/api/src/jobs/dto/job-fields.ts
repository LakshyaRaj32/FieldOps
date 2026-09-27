import { applyDecorators } from '@nestjs/common';
import {
  ApiProperty,
  ApiPropertyOptional,
  type ApiPropertyOptions,
} from '@nestjs/swagger';
import type { DeviceLocation, GeoPoint } from '@fieldops/types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsObject,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { trimmed } from '../../auth/dto/fields.js';
import { JobPriority } from '../job-enums.js';

/** Limits shared with the database column sizes (prisma/schema.prisma). */
export const JOB_LIMITS = {
  title: 200,
  customerName: 200,
  address: 500,
  description: 5000,
  notes: 5000,
  checklistItems: 50,
  checklistItem: 200,
  cancellationReason: 500,
  note: 2000,
  message: 2000,
} as const;

/**
 * The field may be left out, but if it is sent it must be valid: `null` is rejected.
 * (`@IsOptional()` would also skip validation for `null`, which is only right for fields
 * that can be cleared.)
 */
export const PresentOnly = (): PropertyDecorator =>
  ValidateIf((_object: object, value: unknown) => value !== undefined);

/** Trimmed text of 1..max characters. Presence (required, optional, nullable) is added by the DTO. */
export function TextField(
  label: string,
  max: number,
  swagger: ApiPropertyOptions & { required?: boolean },
): PropertyDecorator {
  const { required = true, ...options } = swagger;
  return applyDecorators(
    (required ? ApiProperty : ApiPropertyOptional)({
      minLength: 1,
      maxLength: max,
      ...options,
    }),
    trimmed(),
    IsString({ message: `${label} must be text.` }),
    MinLength(1, { message: `${label} can't be empty.` }),
    MaxLength(max, { message: `${label} must be at most ${max} characters.` }),
  );
}

export function ScheduledAtField(required: boolean): PropertyDecorator {
  return applyDecorators(
    (required ? ApiProperty : ApiPropertyOptional)({
      format: 'date-time',
      example: '2026-09-27T10:30:00+05:30',
      description: 'ISO 8601 date-time with a time zone offset or Z.',
    }),
    IsISO8601(
      { strict: true },
      { message: 'Scheduled time must be an ISO 8601 date-time.' },
    ),
    // Without an offset the instant would depend on the server's time zone.
    Matches(/(Z|[+-]\d{2}:\d{2})$/, {
      message: 'Scheduled time must include a time zone (Z or +hh:mm).',
    }),
  );
}

/** When something happened on the device. Stored as given: device clocks are informational. */
export function OccurredAtField(label = 'Occurred at'): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      format: 'date-time',
      example: '2026-09-27T10:42:00+05:30',
      description: 'Device time with a time zone offset or Z.',
    }),
    IsISO8601(
      { strict: true },
      { message: `${label} must be an ISO 8601 date-time.` },
    ),
    Matches(/(Z|[+-]\d{2}:\d{2})$/, {
      message: `${label} must include a time zone (Z or +hh:mm).`,
    }),
  );
}

export function PriorityField(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      enum: Object.values(JobPriority),
      default: JobPriority.NORMAL,
    }),
    IsEnum(JobPriority, {
      message: `Priority must be one of ${Object.values(JobPriority).join(', ')}.`,
    }),
  );
}

export class GeoPointDto implements GeoPoint {
  @ApiProperty({ minimum: -90, maximum: 90, example: 28.6139 })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'Latitude must be a number.' },
  )
  @Min(-90, { message: 'Latitude must be between -90 and 90.' })
  @Max(90, { message: 'Latitude must be between -90 and 90.' })
  readonly latitude: number;

  @ApiProperty({ minimum: -180, maximum: 180, example: 77.209 })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'Longitude must be a number.' },
  )
  @Min(-180, { message: 'Longitude must be between -180 and 180.' })
  @Max(180, { message: 'Longitude must be between -180 and 180.' })
  readonly longitude: number;
}

export function LocationField(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({ type: GeoPointDto }),
    IsObject({
      message: 'Location must be an object with latitude and longitude.',
    }),
    ValidateNested(),
    Type(() => GeoPointDto),
  );
}

export function ChecklistField(): PropertyDecorator {
  const max = JOB_LIMITS.checklistItem;
  return applyDecorators(
    ApiPropertyOptional({
      type: [String],
      maxItems: JOB_LIMITS.checklistItems,
      example: ['Isolate power', 'Clean filters', 'Test cooling'],
      description: 'Item labels in order.',
    }),
    Transform(({ value }: { value: unknown }) =>
      Array.isArray(value)
        ? value.map((item: unknown) =>
            typeof item === 'string' ? item.trim() : item,
          )
        : value,
    ),
    IsArray({ message: 'Checklist must be a list of item labels.' }),
    ArrayMaxSize(JOB_LIMITS.checklistItems, {
      message: `Checklist can have at most ${JOB_LIMITS.checklistItems} items.`,
    }),
    IsString({ each: true, message: 'Checklist items must be text.' }),
    MinLength(1, { each: true, message: "Checklist items can't be empty." }),
    MaxLength(max, {
      each: true,
      message: `Checklist items must be at most ${max} characters.`,
    }),
  );
}

/**
 * A fix from the worker's phone. Bounds are checked here; the fix itself is device data and
 * is never trusted for authorization (docs/location.md, "Trust boundary").
 */
export class DeviceLocationDto implements DeviceLocation {
  @ApiProperty({ minimum: -90, maximum: 90, example: 12.9716 })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'Latitude must be a number.' },
  )
  @Min(-90, { message: 'Latitude must be between -90 and 90.' })
  @Max(90, { message: 'Latitude must be between -90 and 90.' })
  readonly latitude: number;

  @ApiProperty({ minimum: -180, maximum: 180, example: 77.5946 })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'Longitude must be a number.' },
  )
  @Min(-180, { message: 'Longitude must be between -180 and 180.' })
  @Max(180, { message: 'Longitude must be between -180 and 180.' })
  readonly longitude: number;

  @ApiProperty({
    minimum: 0,
    maximum: 100_000,
    example: 12.5,
    description: 'Accuracy radius in meters, as reported by the phone.',
  })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'Accuracy must be a number.' },
  )
  @Min(0, { message: 'Accuracy must be between 0 and 100000 meters.' })
  @Max(100_000, { message: 'Accuracy must be between 0 and 100000 meters.' })
  readonly accuracyMeters: number;

  @ApiProperty({
    format: 'date-time',
    example: '2026-09-27T10:40:00+05:30',
    description: 'Device time of the fix, with a time zone offset or Z.',
  })
  @IsISO8601(
    { strict: true },
    { message: 'Captured at must be an ISO 8601 date-time.' },
  )
  @Matches(/(Z|[+-]\d{2}:\d{2})$/, {
    message: 'Captured at must include a time zone (Z or +hh:mm).',
  })
  readonly capturedAt: string;
}
