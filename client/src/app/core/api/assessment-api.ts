// @akili-spec assessment/step-1-assessment
import { HttpClient, HttpContext, HttpHeaders, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiEnvelope, unwrap, unwrapWithCursor } from '../http/api-envelope';
import { NO_QUEUE, SILENT_ERRORS, UNSENT_LABEL } from '../http/request-context';
import { IDEMPOTENCY_HEADER } from '../http/unsent-queue';
import {
  AssessmentComment,
  AssessmentView,
  CreateCommentBody,
  QuickComment,
  QuickCommentRole,
  ValidateBody,
  ValidationSummary,
  WorklistData,
  WorklistOptions,
  WorklistPage,
  WorklistQuery,
  WorklistTimelines,
} from './assessment.models';

/**
 * HTTP calls of the step-1 assessment (worklist, assessment view, writes, quick comments). Only transport,
 * no state. Contract: `docs/specs/assessment/step-1-assessment/front-contract.md`.
 *
 * Every call is silent: the Results and Review stores show the error state or the toast themselves
 * (FR-23). Writes never go to the Unsent list: the review re-reads the assessment after a failure, and a
 * write replayed minutes later could land on an assessment someone else has ended (FR-17).
 */
@Service()
export class AssessmentApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;

  /** The caller's timelines and the one to open by default. Never a 404. */
  timelines(): Observable<WorklistTimelines> {
    return this.http
      .get<ApiEnvelope<WorklistTimelines>>(`${this.base}/worklist/timelines`, { context: silent() })
      .pipe(unwrap<WorklistTimelines>());
  }

  /** One page of the worklist; lists go as csv, `cursor` only with the same `sort` and `dir`. */
  worklist(timelineId: number, query: WorklistQuery = {}): Observable<WorklistPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query) as [string, unknown][]) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        if (value.length) params = params.set(key, value.join(','));
      } else {
        params = params.set(key, String(value));
      }
    }
    return this.http
      .get<ApiEnvelope<WorklistData>>(`${this.base}/timelines/${timelineId}/worklist`, { params, context: silent() })
      .pipe(
        unwrapWithCursor<WorklistData>(),
        map(({ data, nextCursor }) => ({ ...data, nextCursor })),
      );
  }

  /** Filter options inside the caller's scope (read once per timeline). */
  options(timelineId: number): Observable<WorklistOptions> {
    return this.http
      .get<ApiEnvelope<WorklistOptions>>(`${this.base}/timelines/${timelineId}/worklist/options`, { context: silent() })
      .pipe(unwrap<WorklistOptions>());
  }

  /** The assessment view of one result. A read never creates the assessment. */
  view(timelineId: number, resultCode: number): Observable<AssessmentView> {
    return this.http
      .get<ApiEnvelope<AssessmentView>>(this.assessment(timelineId, resultCode), { context: silent() })
      .pipe(unwrap<AssessmentView>());
  }

  /** Green or grey for some Assessed fields, or for all of them (Check all / Uncheck all). */
  validate(timelineId: number, resultCode: number, body: ValidateBody): Observable<ValidationSummary> {
    const label = 'all' in body ? (body.validated ? 'Check all' : 'Uncheck all') : body.validated ? 'Validate a field' : 'Undo a validation';
    return this.http
      .put<ApiEnvelope<ValidationSummary>>(`${this.assessment(timelineId, resultCode)}/validations`, body, {
        context: write(`${label} on ${resultCode}`),
      })
      .pipe(unwrap<ValidationSummary>());
  }

  /**
   * Adds a comment (201). `idempotencyKey` is one per submit: a retry of the same submit sends the same key, and
   * the server answers the first comment again (`Idempotency-Replayed: true`, same 201), never a second one.
   */
  comment(timelineId: number, resultCode: number, body: CreateCommentBody, idempotencyKey: string): Observable<AssessmentComment> {
    return this.http
      .post<ApiEnvelope<AssessmentComment>>(`${this.assessment(timelineId, resultCode)}/comments`, body, {
        context: write(`Comment on ${resultCode}`),
        headers: new HttpHeaders({ [IDEMPOTENCY_HEADER]: idempotencyKey }),
      })
      .pipe(unwrap<AssessmentComment>());
  }

  /** Withdraws the caller's own open comment. */
  withdraw(commentId: number): Observable<AssessmentComment> {
    return this.http
      .post<ApiEnvelope<AssessmentComment>>(`${this.base}/assessment-comments/${commentId}/withdraw`, null, {
        context: write('Withdraw a comment'),
      })
      .pipe(unwrap<AssessmentComment>());
  }

  /** Ends the assessment: `quality_assessed`, or `returned` when every grey core field is commented. */
  finish(timelineId: number, resultCode: number): Observable<ValidationSummary> {
    return this.http
      .post<ApiEnvelope<ValidationSummary>>(`${this.assessment(timelineId, resultCode)}/finish`, null, {
        context: write(`Finish ${resultCode}`),
      })
      .pipe(unwrap<ValidationSummary>());
  }

  /** The role's shared quick comments, newest first. */
  quickComments(role: QuickCommentRole): Observable<readonly QuickComment[]> {
    return this.http
      .get<ApiEnvelope<readonly QuickComment[]>>(`${this.base}/quick-comments`, {
        params: new HttpParams().set('role', role),
        context: silent(),
      })
      .pipe(unwrap<readonly QuickComment[]>());
  }

  /** Saves a text as a quick comment of the role (201), or answers the entry that already holds it (200). */
  saveQuickComment(role: QuickCommentRole, body: string): Observable<QuickComment> {
    return this.http
      .post<ApiEnvelope<QuickComment>>(`${this.base}/quick-comments`, { role, body }, { context: write('Save a quick comment') })
      .pipe(unwrap<QuickComment>());
  }

  private assessment(timelineId: number, resultCode: number): string {
    return `${this.base}/timelines/${timelineId}/results/${resultCode}/assessment`;
  }
}

function silent(): HttpContext {
  return new HttpContext().set(SILENT_ERRORS, true);
}

function write(label: string): HttpContext {
  return silent().set(NO_QUEUE, true).set(UNSENT_LABEL, label);
}
