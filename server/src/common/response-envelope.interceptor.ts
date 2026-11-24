import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { type ApiSuccess, metaFor, Paged } from './api-response.js';
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
    return next.handle().pipe(
      map((data: unknown) => {
        if (data === undefined) return undefined;
        const meta = metaFor(requestIdOf(request));
        return data instanceof Paged
          ? {
              success: true,
              data: data.items,
              meta: { ...meta, page: { nextCursor: data.nextCursor } },
            }
          : { success: true, data, meta };
      }),
    );
  }
}
