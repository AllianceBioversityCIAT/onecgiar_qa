import { HttpErrorResponse, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, catchError, defer, from, switchMap, throwError, timeout } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiEnvelope, ApiError, toApiError, unwrap } from '../http/api-envelope';
import { SpSession } from '../sp/sp-session';
import { SpHttp } from './sp-http';
import {
  SP_ERROR,
  SpMe,
  SpRespondAnswer,
  SpRespondBody,
  SpResult,
  SpResults,
  SpResultsQuery,
  SpTimelines,
} from './sp.models';

/** Same as the request-safety interceptor's default: no eternal spinner. */
const SP_TIMEOUT_MS = 30_000;

const SESSION_GONE = (): ApiError =>
  new ApiError({
    status: 401,
    code: SP_ERROR.SESSION_INVALID,
    message: 'Your session has expired. Reload the page to continue.',
  });

/**
 * HTTP calls of the Science Program view (P2-3911, `server/src/assessment/sp-view`). Only transport.
 *
 * Every call goes through `SpHttp` (no interceptors) with `Authorization: Bearer <SP session token>`.
 * A 401 `SP_SESSION_INVALID` ends the SP session (the page shows "link expired" and tells Reporting);
 * it never touches the Cognito session. An admin session must send `programId` on every call.
 */
@Service()
export class SpApi {
  private readonly http = inject(SpHttp).client;
  private readonly base = inject(APP_CONFIG).apiBaseUrl;
  private readonly session = inject(SpSession);

  me(): Observable<SpMe> {
    return this.call((headers) => this.http.get<ApiEnvelope<SpMe>>(`${this.base}/sp/me`, { headers }).pipe(unwrap<SpMe>()));
  }

  timelines(programId: number | null): Observable<SpTimelines> {
    return this.call((headers) =>
      this.http
        .get<ApiEnvelope<SpTimelines>>(`${this.base}/sp/timelines`, { headers, params: programParams(programId) })
        .pipe(unwrap<SpTimelines>()),
    );
  }

  /** Filters are applied by the server; lists go as csv and empty ones are left out. */
  results(timelineId: number, query: SpResultsQuery = {}): Observable<SpResults> {
    let params = programParams(query.programId ?? null);
    if (query.status?.length) params = params.set('status', query.status.join(','));
    if (query.resultTypeKey?.length) params = params.set('resultTypeKey', query.resultTypeKey.join(','));
    return this.call((headers) =>
      this.http
        .get<ApiEnvelope<SpResults>>(`${this.base}/sp/timelines/${timelineId}/results`, { headers, params })
        .pipe(unwrap<SpResults>()),
    );
  }

  result(timelineId: number, resultCode: number, programId: number | null): Observable<SpResult> {
    return this.call((headers) =>
      this.http
        .get<ApiEnvelope<SpResult>>(`${this.base}/sp/timelines/${timelineId}/results/${resultCode}`, {
          headers,
          params: programParams(programId),
        })
        .pipe(unwrap<SpResult>()),
    );
  }

  /** Answers a comment (or changes the answer). `accept` sends no `body` at all. */
  respond(commentId: number, body: SpRespondBody): Observable<SpRespondAnswer> {
    return this.call((headers) =>
      this.http
        .put<ApiEnvelope<SpRespondAnswer>>(`${this.base}/sp/comments/${commentId}/response`, body, { headers })
        .pipe(unwrap<SpRespondAnswer>()),
    );
  }

  /** The result's QA comments as a CSV file (no envelope on success; errors keep it). */
  commentsCsv(timelineId: number, resultCode: number, programId: number | null): Observable<HttpResponse<Blob>> {
    return this.call((headers) =>
      this.http
        .get(`${this.base}/sp/timelines/${timelineId}/results/${resultCode}/comments.csv`, {
          headers,
          params: programParams(programId),
          observe: 'response',
          responseType: 'blob',
        })
        .pipe(catchError((error: unknown) => from(blobError(error)).pipe(switchMap((e) => throwError(() => e))))),
    );
  }

  /** Adds the bearer, the timeout, and ends the SP session on a 401. */
  private call<T>(send: (headers: HttpHeaders) => Observable<T>): Observable<T> {
    return defer(() => {
      const token = this.session.token();
      if (!token) {
        this.session.expire('session_expired');
        return throwError(() => SESSION_GONE());
      }
      return send(new HttpHeaders({ Authorization: `Bearer ${token}` })).pipe(timeout(SP_TIMEOUT_MS));
    }).pipe(
      catchError((error: unknown) => {
        const apiError = toApiError(error);
        if (apiError.status === 401) this.session.expire('session_expired');
        return throwError(() => apiError);
      }),
    );
  }
}

function programParams(programId: number | null): HttpParams {
  return programId === null ? new HttpParams() : new HttpParams().set('programId', String(programId));
}

/** A `blob` request gets its error body as a Blob: read it so the envelope (code, message) is kept. */
async function blobError(error: unknown): Promise<ApiError> {
  if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
    try {
      const body: unknown = JSON.parse(await error.error.text());
      return toApiError(
        new HttpErrorResponse({ error: body, status: error.status, statusText: error.statusText, headers: error.headers, url: error.url ?? undefined }),
      );
    } catch {
      return toApiError(error);
    }
  }
  return toApiError(error);
}
