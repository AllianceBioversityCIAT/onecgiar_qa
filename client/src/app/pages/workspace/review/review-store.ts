// @akili-spec assessment/step-1-assessment
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssessmentApi } from '../../../core/api/assessment-api';
import {
  ASSESSMENT_ERROR,
  AssessmentComment,
  AssessmentView,
  QuickComment,
  QuickCommentRole,
  ValidationSummary,
  ValidationsBody,
} from '../../../core/api/assessment.models';
import { AuthSession } from '../../../core/auth/auth-session';
import { ApiError, toApiError } from '../../../core/http/api-envelope';
import { Toasts } from '../../../core/http/toasts';
import { reloadAfterReplay } from '../../../core/http/write-events';
import { toReviewVm } from './review.mapper';

export type ReviewLoadState = 'loading' | 'ready' | 'error';

export interface ReviewError {
  readonly code: string;
  /** Catalog text, safe to show as is. */
  readonly message: string;
}

/** A comment that stays in its form when refused: the message goes next to what the reviewer typed. */
export type CommentOutcome = { readonly ok: true; readonly comment: AssessmentComment } | { readonly ok: false; readonly message: string };

/** `coreKeys`: the core fields still neither green nor commented (409 `ASSESSMENT_CORE_UNCOMMENTED`). */
export type FinishOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string; readonly coreKeys?: readonly string[] };

const NOT_FOUND: ReviewError = {
  code: ASSESSMENT_ERROR.NOT_FOUND,
  message: 'This result does not exist or is not in your scope.',
};
const NO_TIMELINE: ReviewError = {
  code: ASSESSMENT_ERROR.TIMELINES_NOT_FOUND,
  message: 'You are not assigned to any timeline yet, so there is no assessment to open.',
};

/** Only assessors write in step 1, so the quick comments are the assessors' list. */
const WRITER_ROLE: QuickCommentRole = 'ASSESSOR';

/** Busy key of Check all / Uncheck all (never a field key: those are `section.name`). */
export const ALL_FIELDS = '*';

/**
 * Refusals that say the page is out of date (someone ended the assessment, the step closed, the comment changed):
 * the page reads the assessment again before saying the message, so it never keeps a state the server dropped.
 */
const OUT_OF_DATE: ReadonlySet<string> = new Set([
  ASSESSMENT_ERROR.FINISHED,
  ASSESSMENT_ERROR.STEP_CLOSED,
  ASSESSMENT_ERROR.READ_ONLY,
  ASSESSMENT_ERROR.NOT_FOUND,
  ASSESSMENT_ERROR.NO_FIELD_CONFIG,
  ASSESSMENT_ERROR.COMMENT_NOT_OPEN,
  ASSESSMENT_ERROR.NOT_COMMENT_AUTHOR,
]);

interface Target {
  readonly timelineId: number;
  readonly resultCode: number;
}

/**
 * State of the Review page (provided by the view). Reads the assessment of one result on one timeline
 * (`/results/:code?timeline=:id`). With no timeline in the URL it opens the caller's default timeline.
 *
 * Writes (T-20): every answer repaints from what the server holds, so the page also shows what another assessor
 * of the same result did (FR-17). Each action refuses a second tap while its first call is on its way.
 */
@Injectable()
export class ReviewStore {
  private readonly api = inject(AssessmentApi);
  private readonly toasts = inject(Toasts);
  private readonly session = inject(AuthSession);

  readonly state = signal<ReviewLoadState>('loading');
  readonly error = signal<ReviewError | null>(null);
  readonly view = signal<AssessmentView | null>(null);
  readonly timelineId = signal<number | null>(null);
  readonly resultCode = signal<number | null>(null);
  /** The page's view models, rebuilt from the API answer only (never by hand). */
  readonly vm = computed(() => {
    const view = this.view();
    return view ? toReviewVm(view) : null;
  });

  /** Field keys with a green/grey write on its way (`ALL_FIELDS` for Check all / Uncheck all). */
  readonly validating = signal<ReadonlySet<string>>(new Set());
  readonly commenting = signal(false);
  /** Id of the comment being withdrawn. */
  readonly withdrawing = signal<number | null>(null);
  readonly finishing = signal(false);
  readonly quickComments = signal<readonly QuickComment[]>([]);
  readonly savingQuick = signal(false);
  /** The caller's user id: only their own open comments can be withdrawn (FR-13). */
  readonly me = computed(() => this.session.user()?.id ?? null);

  /** Only the newest load writes its answer (a quick switch of result never shows an older one). */
  private seq = 0;
  /** Two green/grey writes were on their way at once: their answers may land out of order. */
  private overlapped = false;
  private quickLoaded = false;

  constructor() {
    // A write of this assessment the unsent queue sent later: show what the server holds now, in place.
    reloadAfterReplay(
      (path) => {
        const at = this.target();
        return !!at && (path.startsWith(`/timelines/${at.timelineId}/results/${at.resultCode}/assessment`) || path.startsWith('/assessment-comments/'));
      },
      (fresh) => this.reload(fresh),
    );
  }

  /** `code` and `timeline` as the URL carries them. */
  async load(code: string | null, timeline: string | null): Promise<void> {
    const seq = ++this.seq;
    this.state.set('loading');
    this.error.set(null);
    const resultCode = positiveInt(code);
    if (resultCode === null) return this.fail(seq, NOT_FOUND);
    try {
      let timelineId = positiveInt(timeline);
      if (timelineId === null) {
        timelineId = (await firstValueFrom(this.api.timelines())).defaultTimelineId;
        if (seq !== this.seq) return;
        if (timelineId === null) return this.fail(seq, NO_TIMELINE);
      }
      const view = await firstValueFrom(this.api.view(timelineId, resultCode));
      if (seq !== this.seq) return;
      this.timelineId.set(timelineId);
      this.resultCode.set(resultCode);
      this.view.set(view);
      this.state.set('ready');
    } catch (error) {
      const e = toApiError(error);
      this.fail(seq, { code: e.code, message: e.message });
    }
  }

  /** Retry after an error, with the same URL values. */
  retry(code: string | null, timeline: string | null): Promise<void> {
    return this.load(code, timeline);
  }

  // ---------- Green / grey (FR-10) ----------

  /** Green (`true`) or grey for one Assessed field. False when nothing was written (a second tap, or a refusal). */
  setValidated(fieldKey: string, validated: boolean): Promise<boolean> {
    return this.validate(fieldKey, { validated, fieldKeys: [fieldKey] });
  }

  /** Check all / Uncheck all: every Assessed field of the result, in one request. */
  setAllValidated(validated: boolean): Promise<boolean> {
    return this.validate(ALL_FIELDS, { validated, all: true });
  }

  private async validate(busyKey: string, body: ValidationsBody): Promise<boolean> {
    const at = this.target();
    const busy = this.validating();
    if (!at || busy.has(busyKey) || busy.has(ALL_FIELDS) || (busyKey === ALL_FIELDS && busy.size > 0)) return false;
    if (busy.size > 0) this.overlapped = true;
    this.validating.update((set) => new Set(set).add(busyKey));
    try {
      const summary = await firstValueFrom(this.api.setValidations(at.timelineId, at.resultCode, body));
      if (!this.still(at)) return false;
      await this.applySummary(summary);
      return true;
    } catch (error) {
      if (this.still(at)) await this.refused(toApiError(error));
      return false;
    } finally {
      this.validating.update((set) => {
        const next = new Set(set);
        next.delete(busyKey);
        return next;
      });
      // Answers of writes that overlapped may have landed out of order: read once what the server holds.
      if (this.overlapped && this.validating().size === 0) {
        this.overlapped = false;
        if (this.still(at)) void this.reload();
      }
    }
  }

  // ---------- Comments (FR-11, FR-13) ----------

  /** A refused text keeps its form: the caller shows `message` next to it. */
  async addComment(fieldKey: string, body: string): Promise<CommentOutcome> {
    const at = this.target();
    const text = body.trim();
    if (!at || !text || this.commenting()) return { ok: false, message: '' };
    this.commenting.set(true);
    try {
      const saved = await firstValueFrom(this.api.addComment(at.timelineId, at.resultCode, fieldKey, text));
      // A retry answered with the first comment again (same id) is still one comment.
      if (this.still(at)) this.patchComments(fieldKey, (list) => [...list.filter((c) => c.id !== saved.id), saved]);
      return { ok: true, comment: saved };
    } catch (error) {
      const e = toApiError(error);
      if (!this.still(at)) return { ok: false, message: e.message };
      if (e.status === 400 || e.status === 413 || e.status === 422) return { ok: false, message: e.fields[0]?.message ?? e.message };
      return { ok: false, message: await this.refused(e) };
    } finally {
      this.commenting.set(false);
    }
  }

  /** The author takes back an own open comment: it leaves the counts and the program's view. */
  async withdrawComment(commentId: number): Promise<boolean> {
    const at = this.target();
    if (!at || this.withdrawing() !== null) return false;
    this.withdrawing.set(commentId);
    try {
      const saved = await firstValueFrom(this.api.withdrawComment(commentId));
      if (this.still(at)) this.patchComments(saved.fieldKey, (list) => list.map((c) => (c.id === saved.id ? saved : c)));
      return true;
    } catch (error) {
      if (this.still(at)) await this.refused(toApiError(error));
      return false;
    } finally {
      this.withdrawing.set(null);
    }
  }

  // ---------- Finish (FR-14, FR-15) ----------

  async finish(): Promise<FinishOutcome> {
    const at = this.target();
    if (!at || this.finishing()) return { ok: false, message: '' };
    this.finishing.set(true);
    try {
      const summary = await firstValueFrom(this.api.finish(at.timelineId, at.resultCode));
      if (this.still(at)) await this.applySummary(summary);
      return { ok: true };
    } catch (error) {
      const e = toApiError(error);
      if (!this.still(at)) return { ok: false, message: e.message };
      if (e.code === ASSESSMENT_ERROR.CORE_UNCOMMENTED) return { ok: false, message: e.message, coreKeys: e.fieldKeys };
      return { ok: false, message: await this.refused(e) };
    } finally {
      this.finishing.set(false);
    }
  }

  // ---------- Quick comments (FR-12) ----------

  /** Read once per page, when the comment form first opens. A caller with no grant of the role has no list. */
  async loadQuickComments(): Promise<void> {
    if (this.quickLoaded) return;
    this.quickLoaded = true;
    try {
      this.quickComments.set(await firstValueFrom(this.api.quickComments(WRITER_ROLE)));
    } catch (error) {
      // 403 = no live grant of the role (an admin): nothing to show. Anything else may work on the next open.
      if (toApiError(error).status !== 403) this.quickLoaded = false;
    }
  }

  /** Saves a text for every assessor. The same text twice is one entry (the server answers the first). */
  async saveQuickComment(body: string): Promise<boolean> {
    const text = body.trim();
    if (!text || this.savingQuick()) return false;
    this.savingQuick.set(true);
    try {
      const saved = await firstValueFrom(this.api.saveQuickComment(WRITER_ROLE, text));
      this.quickComments.update((list) => [saved, ...list.filter((q) => q.id !== saved.id)]);
      this.toasts.success('Saved as a quick comment.');
      return true;
    } catch (error) {
      this.toasts.error(toApiError(error).message);
      return false;
    } finally {
      this.savingQuick.set(false);
    }
  }

  // ---------- Shared ----------

  private target(): Target | null {
    const timelineId = this.timelineId();
    const resultCode = this.resultCode();
    return timelineId === null || resultCode === null ? null : { timelineId, resultCode };
  }

  /** The page still shows the result the write was made on (the router reuses this store for another one). */
  private still(at: Target): boolean {
    return this.timelineId() === at.timelineId && this.resultCode() === at.resultCode;
  }

  /**
   * Paints the answer of a green/grey write or of a finish: the marks as the assessment holds them (a field with no
   * row is grey) and its end. An ended assessment is read again, so the page shows the end, who did it and why it is
   * read only now.
   */
  private async applySummary(summary: ValidationSummary): Promise<void> {
    const green = new Map(summary.validations.map((v) => [v.fieldKey, v.validated] as const));
    this.view.update(
      (view) =>
        view && {
          ...view,
          sections: view.sections.map((s) => ({
            ...s,
            fields: s.fields.map((f) => (f.mode === 'assessed' ? { ...f, validated: green.get(f.key) ?? false } : f)),
          })),
          assessment: { status: summary.status, assessedBy: summary.assessedBy, finishedAt: summary.finishedAt },
        },
    );
    if (summary.status === 'pending') return;
    await this.reload();
    this.toasts.success(
      summary.status === 'quality_assessed' ? 'Assessment finished: Quality Assessed.' : 'Assessment finished: returned to the program.',
    );
  }

  private patchComments(fieldKey: string, change: (list: readonly AssessmentComment[]) => readonly AssessmentComment[]): void {
    this.view.update(
      (view) =>
        view && {
          ...view,
          sections: view.sections.map((s) => ({
            ...s,
            fields: s.fields.map((f) => (f.key === fieldKey ? { ...f, comments: change(f.comments) } : f)),
          })),
        },
    );
  }

  /** A refused write: the server's message, after reading the page again when the refusal means it is out of date. */
  private async refused(e: ApiError): Promise<string> {
    if (OUT_OF_DATE.has(e.code)) await this.reload();
    this.toasts.error(e.message);
    return e.message;
  }

  /**
   * Reads the assessment again in place (no skeleton). `fresh()` false = a write of the app moved while reading:
   * the answer is not painted (it could undo the newer write on screen) and the caller asks again later.
   */
  private async reload(fresh: () => boolean = () => true): Promise<boolean> {
    const at = this.target();
    if (!at) return true;
    try {
      const view = await firstValueFrom(this.api.view(at.timelineId, at.resultCode));
      if (!this.still(at)) return true;
      if (!fresh()) return false;
      this.view.set(view);
      return true;
    } catch (error) {
      // The result left the caller's scope: the page cannot stay. Any other failure keeps what is on screen
      // (the next write is refused again and tries this read once more).
      const e = toApiError(error);
      if (this.still(at) && (e.status === 403 || e.status === 404)) this.fail(this.seq, { code: e.code, message: e.message });
      return true;
    }
  }

  private fail(seq: number, error: ReviewError): void {
    if (seq !== this.seq) return;
    this.view.set(null);
    this.error.set(error);
    this.state.set('error');
  }
}

function positiveInt(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}
