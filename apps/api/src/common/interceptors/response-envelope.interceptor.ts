import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { ApiSuccessResponse } from '@fieldops/types';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';

/**
 * Wraps every successful handler result as `{ success: true, data }`, so controllers return
 * plain DTOs and the envelope stays consistent. `204 No Content` responses have no body, and
 * file downloads (a StreamableFile, for example an evidence photo) are sent as they are.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T> | StreamableFile | undefined
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T> | StreamableFile | undefined> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((data): ApiSuccessResponse<T> | StreamableFile | undefined => {
        if (data instanceof StreamableFile) {
          return data;
        }
        return response.statusCode === 204
          ? undefined
          : { success: true, data };
      }),
    );
  }
}
