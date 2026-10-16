import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ApiEnvelope, ApiError, CLIENT_ERROR, toApiError, unwrap } from './api-envelope';

const meta = { requestId: 'req-1', timestamp: '2026-10-15T00:00:00Z' };

describe('unwrap', () => {
  it('returns data from a successful envelope', async () => {
    const body: ApiEnvelope<{ n: number }> = { success: true, data: { n: 1 }, meta };
    await expect(firstValueFrom(of(body).pipe(unwrap<{ n: number }>()))).resolves.toEqual({ n: 1 });
  });

  it('treats a 204 (null body) as undefined', async () => {
    await expect(firstValueFrom(of(null).pipe(unwrap<void>()))).resolves.toBeUndefined();
  });

  it('turns a 200 with success:false into an ApiError', async () => {
    const body: ApiEnvelope<never> = {
      success: false,
      error: { status: 400, code: 'X', message: 'Nope' },
      meta,
    };
    const error = await firstValueFrom(of(body).pipe(unwrap())).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('X');
    expect((error as ApiError).requestId).toBe('req-1');
  });

  it('rejects a body that is not an envelope', async () => {
    const error = await firstValueFrom(of({ foo: 1 } as never).pipe(unwrap())).catch(
      (e: unknown) => e,
    );
    expect((error as ApiError).code).toBe(CLIENT_ERROR.UNEXPECTED_RESPONSE);
  });

  it('maps an HTTP error envelope with fields and retryAfter', async () => {
    const http = new HttpErrorResponse({
      status: 400,
      error: {
        success: false,
        error: {
          status: 400,
          code: 'VALIDATION_FAILED',
          message: 'Check',
          fields: [{ field: 'email', code: 'INVALID_EMAIL', message: 'Bad email' }],
        },
        meta,
      },
    });
    const error = (await firstValueFrom(throwError(() => http).pipe(unwrap())).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fieldMessage('email')).toBe('Bad email');
    expect(error.fieldMessage('password')).toBeNull();
  });
});

describe('toApiError', () => {
  it('maps a network failure (status 0) to a client network error', () => {
    const error = toApiError(new HttpErrorResponse({ status: 0 }));
    expect(error.code).toBe(CLIENT_ERROR.NETWORK);
  });

  it('keeps the request id header when the body is not an envelope', () => {
    const error = toApiError(
      new HttpErrorResponse({ status: 502, headers: new HttpHeaders({ 'x-request-id': 'abc' }) }),
    );
    expect(error.code).toBe(CLIENT_ERROR.UNEXPECTED_RESPONSE);
    expect(error.requestId).toBe('abc');
  });

  it('reads retryAfter on 429', () => {
    const error = toApiError(
      new HttpErrorResponse({
        status: 429,
        error: {
          success: false,
          error: { status: 429, code: 'TOO_MANY_REQUESTS', message: 'Wait', retryAfter: 30 },
          meta,
        },
      }),
    );
    expect(error.retryAfter).toBe(30);
  });
});
