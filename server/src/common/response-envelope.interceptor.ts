import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { type ApiSuccess, metaFor } from './api-response.js';
import { requestIdOf, type RequestWithId } from './request-id.js';

/**
 * Wraps every successful handler result as `{ success: true, data, meta }`
 * (response standard, `api-response.ts`). A handler that returns nothing
 * (a 204) keeps an empty body. Registered globally in `configureApp`.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiSuccess<unknown> | undefined> {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    return next
      .handle()
      .pipe(
        map((data: unknown) =>
          data === undefined
            ? undefined
            : { success: true, data, meta: metaFor(requestIdOf(request)) },
        ),
      );
  }
}
