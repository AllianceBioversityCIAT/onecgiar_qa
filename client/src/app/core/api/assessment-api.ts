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
  CommentThread,
  DecisionBody,
  DecisionKind,
  DecisionResult,
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
 * - a decision and its clear (round 2: Lead, TPB, PPU): a PUT / DELETE on one path, the same call twice gives the same state
 *   (clearing where there is none succeeds and changes nothing), and a later write of the timeline waits behind it.
 * Finish, withdraw, the clarification answer, the release retry and deleting a comment stay
 * out (`NO_QUEUE`): a lost answer may mean it already happened (a replay would be 409 `ASSESSMENT_FINISHED` /
 * `ASSESSMENT_COMMENT_NOT_OPEN` / `ASSESSMENT_COMMENT_NOT_DELETABLE`), so the page reloads and shows the real state
 * instead.
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

  /**
   * What the program answered on each comment of the result, with who responded (P2-3911). Empty while the
   * programs step has not started. Same 404 as the assessment view.
   */
  programResponses(timelineId: number, resultCode: number): Observable<readonly CommentThread[]> {
    return this.http
      .get<ApiEnvelope<{ readonly comments: readonly CommentThread[] }>>(`${this.base}/timelines/${timelineId}/results/${resultCode}/sp-responses`, {
        context: new HttpContext().set(SILENT_ERRORS, true),
      })
      .pipe(
        unwrap<{ readonly comments: readonly CommentThread[] }>(),
        map((data) => data.comments),
      );
  }

  /**
   * The comment's author answers the clarification the program requested (only while the programs step is open).
   * The comment is `open` again, so the program can respond once more. 409 `CLARIFICATION_NOT_PENDING` when it
   * was already answered.
   */
  answerClarification(commentId: number, body: string): Observable<CommentThread> {
    return this.http
      .post<ApiEnvelope<CommentThread>>(`${this.base}/assessment-comments/${commentId}/clarification-answer`, { body }, {
        context: this.silent('Answer a clarification').set(NO_QUEUE, true),
      })
      .pipe(unwrap<CommentThread>());
  }

  /** `quality_assessed`, `returned`, or 409 `ASSESSMENT_CORE_UNCOMMENTED` with `ApiError.fieldKeys`. */
  finish(timelineId: number, resultCode: number): Observable<ValidationSummary> {
    return this.http
      .post<ApiEnvelope<ValidationSummary>>(`${this.assessmentUrl(timelineId, resultCode)}/finish`, null, {
        context: this.silent(`Finish ${resultCode}`).set(NO_QUEUE, true),
      })
      .pipe(unwrap<ValidationSummary>());
  }

  // ── Round 2: the decisions (Lead, TPB, PPU) and the Lead's deletes (round-2 contract § 4) ──

  /**
   * A reviewer's decision on a comment (Lead, TPB, or a PPU's Done); a second PUT replaces it. Queued for replay like the validations: the route
   * reads no `Idempotency-Key`, but the same body twice gives the same state, so a replay is safe. The answer may end the review (`status`); it
   * carries no `effectiveValidated`, so re-read the view when every field matters.
   */
  decide(
    timelineId: number,
    resultCode: number,
    commentId: number,
    decision: DecisionKind,
    body: string | null,
  ): Observable<DecisionResult> {
    // A PPU's Done may carry no comment: `body` is then left out (a blank string is a 400).
    const sent: DecisionBody = body === null ? { decision } : { decision, body };
    return this.http
      .put<ApiEnvelope<DecisionResult>>(this.decisionUrl(timelineId, resultCode, commentId), sent, {
        context: this.silent(`Decide a comment of ${resultCode}`),
      })
      .pipe(unwrap<DecisionResult>());
  }

  /**
   * Clears the Lead's decision (`decision: null`). Queued like `decide`: clearing where there is none succeeds and
   * changes nothing, and a later decision waits behind the stored clear, so a replay cannot undo it.
   */
  clearDecision(timelineId: number, resultCode: number, commentId: number): Observable<DecisionResult> {
    return this.http
      .delete<ApiEnvelope<DecisionResult>>(this.decisionUrl(timelineId, resultCode, commentId), {
        context: this.silent(`Clear a decision of ${resultCode}`),
      })
      .pipe(unwrap<DecisionResult>());
  }

  /**
   * The Lead deletes another reviewer's comment (round 2). The answer does not say whether the review ended: re-read
   * the view. Never queued, like withdraw: a second delete is 409 `ASSESSMENT_COMMENT_NOT_DELETABLE`.
   */
  deleteComment(commentId: number): Observable<AssessmentComment> {
    return this.http
      .post<ApiEnvelope<AssessmentComment>>(`${this.base}/assessment-comments/${commentId}/delete`, null, {
        context: this.silent('Delete a comment').set(NO_QUEUE, true),
      })
      .pipe(unwrap<AssessmentComment>());
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

  private decisionUrl(timelineId: number, resultCode: number, commentId: number): string {
    return `${this.assessmentUrl(timelineId, resultCode)}/decisions/${commentId}`;
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
