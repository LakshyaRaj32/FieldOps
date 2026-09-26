import { applyDecorators, HttpStatus, type Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type {
  ApiErrorBody,
  ApiErrorDetail,
  ApiErrorResponse,
} from '@fieldops/types';

import { ErrorCode, type ApiErrorCode } from '../errors/error-codes.js';

export class ApiErrorDetailDto implements ApiErrorDetail {
  @ApiProperty({ example: 'email' })
  readonly field: string;

  @ApiProperty({ example: 'email must be a valid email address' })
  readonly message: string;
}

export class ApiErrorBodyDto implements ApiErrorBody {
  @ApiProperty({
    enum: Object.values(ErrorCode),
    example: 'INVALID_CREDENTIALS',
  })
  readonly code: ApiErrorCode;

  @ApiProperty({ example: 'Invalid email or password.' })
  readonly message: string;

  @ApiPropertyOptional({ type: [ApiErrorDetailDto] })
  readonly details?: ApiErrorDetailDto[];

  @ApiPropertyOptional({ example: 'mbx2k1-4f8a9c2e' })
  readonly requestId?: string;
}

export class ApiErrorResponseDto implements ApiErrorResponse {
  @ApiProperty({ example: false })
  readonly success: false;

  @ApiProperty({ type: ApiErrorBodyDto })
  readonly error: ApiErrorBodyDto;
}

/** Documents a success response as `{ success: true, data: <model> }`. */
export function ApiEnvelopeResponse(
  model: Type<unknown>,
  options: {
    status?: HttpStatus;
    description: string;
    isArray?: boolean;
  },
): MethodDecorator {
  const data = options.isArray
    ? { type: 'array', items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status: options.status ?? HttpStatus.OK,
      description: options.description,
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: { success: { type: 'boolean', example: true }, data },
      },
    }),
  );
}

/** Documents error responses, all sharing the error envelope. */
export function ApiErrorResponses(
  ...responses: readonly { status: HttpStatus; description: string }[]
): MethodDecorator {
  return applyDecorators(
    ...responses.map(({ status, description }) =>
      ApiResponse({ status, description, type: ApiErrorResponseDto }),
    ),
  );
}
