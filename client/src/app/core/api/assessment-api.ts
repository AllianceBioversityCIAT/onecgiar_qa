import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiEnvelope, unwrap, unwrapWithCursor } from '../http/api-envelope';
import { NO_QUEUE, SILENT_ERRORS, UNSENT_LABEL } from '../http/request-context';
import {
  AssessmentComment,
  AssessmentRelease,
  AssessmentView,
  QuickComment,
  QuickCommentRole,
  ReleaseRetryResult,
  ValidationSummary,
  ValidationsBody,
  Worklist,
  WorklistOptions,
  WorklistPage,
  WorklistQuery,
  WorklistTimelines,
} from './assessment.models';

/**
 * HTTP calls of the step-1 assessment API (front contract `docs/specs/assessment/step-1-assessment/
 * front-contract.md`). Only transport, no state.
 *
 * Writes are silent (the review page shows each refusal by `error.code`) and labelled for the Unsent
 * list. Which ones may be replayed from that list:
 * - validations: setting a field to the state it already has changes nothing, so a replay is safe;
 * - comment create: the server honors `Idempotency-Key` (the interceptor sends one per submit);
 * - quick comment save: the same text answers 200 with the existing entry.
 * Finish, withdraw and the release retry stay out (`NO_QUEUE`): a lost answer may mean it already
 * happened (a replay would be 409 `ASSESSMENT_FINISHED` / `ASSESSMENT_COMMENT_NOT_OPEN`), so the page
 * reloads and shows the real state instead.
 */
@Service()
export class AssessmentApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;

  // ── Worklist ──

  /** Timelines offered to the caller and the one to open first. Never a 404. */
  timelines(): Observable<WorklistTimelines> {
    return this.http.get<ApiEnvelope<WorklistTimelines>>(`${this.base}/worklist/timelines`).pipe(unwrap<WorklistTimelines>());
  }

  /** One worklist page. List filters go as csv; `cursor` is valid only with the same `sort` and `dir`. */
  worklist(timelineId: number, query: WorklistQuery = {}): Observable<WorklistPage> {
    return this.http
      .get<ApiEnvelope<Worklist>>(`${this.base}/timelines/${timelineId}/worklist`, { params: worklistParams(query) })
      .pipe(
        unwrapWithCursor<Worklist>(),
        map(({ data, nextCursor }) => ({ ...data, nextCursor })),
      );
  }

  /** Filter options in the caller's scope (all 8 statuses, in order). */
  worklistOptions(timelineId: number): Observable<WorklistOptions> {
    return this.http
      .get<ApiEnvelope<WorklistOptions>>(`${this.base}/timelines/${timelineId}/worklist/options`)
      .pipe(unwrap<WorklistOptions>());
  }

  // ── Assessment view and writes ──

  /** Never creates the assessment. `round` (1 or 2) is read by the server for an admin only. */
  view(timelineId: number, resultCode: number, round?: 1 | 2): Observable<AssessmentView> {
    const params = round ? new HttpParams().set('round', round) : undefined;
    return this.http
      .get<ApiEnvelope<AssessmentView>>(this.assessmentUrl(timelineId, resultCode), { params })
      .pipe(unwrap<AssessmentView>());
  }

  /** Green (`true`) or grey (`false`) for some Assessed fields or all of them. Ends the assessment when every core field is green. */
  setValidations(timelineId: number, resultCode: number, body: ValidationsBody): Observable<ValidationSummary> {
    const label = `${body.validated ? 'Validate' : 'Unvalidate'} fields of ${resultCode}`;
    return this.http
      .put<ApiEnvelope<ValidationSummary>>(`${this.assessmentUrl(timelineId, resultCode)}/validations`, body, {
        context: this.silent(label),
      })
      .pipe(unwrap<ValidationSummary>());
  }

  /**
   * 201 with the new comment. Never queued: the text stays in the reviewer's box when it cannot be sent, and a
   * comment the queue sent later plus a second try of the reviewer would be two comments (the key is gone by then).
   */
  addComment(timelineId: number, resultCode: number, fieldKey: string, body: string): Observable<AssessmentComment> {
    return this.http
      .post<ApiEnvelope<AssessmentComment>>(`${this.assessmentUrl(timelineId, resultCode)}/comments`, { fieldKey, body }, {
        context: this.silent(`Comment on ${resultCode}`).set(NO_QUEUE, true),
      })
      .pipe(unwrap<AssessmentComment>());
  }

  /** The author takes back an open comment (allowed after the end, while step 1 or 2 is open). */
  withdrawComment(commentId: number): Observable<AssessmentComment> {
    return this.http
      .post<ApiEnvelope<AssessmentComment>>(`${this.base}/assessment-comments/${commentId}/withdraw`, null, {
        context: this.silent('Withdraw a comment').set(NO_QUEUE, true),
      })
      .pipe(unwrap<AssessmentComment>());
  }

  /** `quality_assessed`, `returned`, or 409 `ASSESSMENT_CORE_UNCOMMENTED` with `ApiError.fieldKeys`. */
  finish(timelineId: number, resultCode: number): Observable<ValidationSummary> {
    return this.http
      .post<ApiEnvelope<ValidationSummary>>(`${this.assessmentUrl(timelineId, resultCode)}/finish`, null, {
        context: this.silent(`Finish ${resultCode}`).set(NO_QUEUE, true),
      })
      .pipe(unwrap<ValidationSummary>());
  }

  // ── Quick comments ──

  /** Newest first, shared by everyone with a live grant of the role. */
  quickComments(role: QuickCommentRole): Observable<readonly QuickComment[]> {
    const params = new HttpParams().set('role', role);
    return this.http
      .get<ApiEnvelope<readonly QuickComment[]>>(`${this.base}/quick-comments`, { params, context: new HttpContext().set(SILENT_ERRORS, true) })
      .pipe(unwrap<readonly QuickComment[]>());
  }

  /** 201 new, or 200 with the existing entry when the same text is already saved for the role. */
  saveQuickComment(role: QuickCommentRole, body: string): Observable<QuickComment> {
    return this.http
      .post<ApiEnvelope<QuickComment>>(`${this.base}/quick-comments`, { role, body }, {
        context: this.silent('Save a quick comment'),
      })
      .pipe(unwrap<QuickComment>());
  }

  // ── Release outbox (admin) ──

  /** Oldest first, capped at 500 rows without saying so: 500 may be the whole list or the first 500. */
  releases(status: 'pending' | 'refused' = 'pending'): Observable<readonly AssessmentRelease[]> {
    const params = new HttpParams().set('status', status);
    return this.http
      .get<ApiEnvelope<readonly AssessmentRelease[]>>(`${this.base}/assessment-releases`, { params })
      .pipe(unwrap<readonly AssessmentRelease[]>());
  }

  /** One sweep of at most 3 batches; call again until `attempted` is 0. */
  retryReleases(): Observable<ReleaseRetryResult> {
    return this.http
      .post<ApiEnvelope<ReleaseRetryResult>>(`${this.base}/assessment-releases/retry`, null, {
        context: this.silent('Send releases to Reporting').set(NO_QUEUE, true),
      })
      .pipe(unwrap<ReleaseRetryResult>());
  }

  private assessmentUrl(timelineId: number, resultCode: number): string {
    return `${this.base}/timelines/${timelineId}/results/${resultCode}/assessment`;
  }

  private silent(label: string): HttpContext {
    return new HttpContext().set(SILENT_ERRORS, true).set(UNSENT_LABEL, label);
  }
}

/** Lists go as csv (the server also accepts a repeated key); empty values are left out. */
function worklistParams(query: WorklistQuery): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params = params.set(key, value.join(','));
      continue;
    }
    params = params.set(key, String(value));
  }
  return params;
}
