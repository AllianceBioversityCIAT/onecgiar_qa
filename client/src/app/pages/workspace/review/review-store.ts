// @akili-spec assessment/step-1-assessment
import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ActingRole, ActingRoleState } from '../../../core/api/acting-role';
import { AssessmentApi } from '../../../core/api/assessment-api';
import {
  ASSESSMENT_ERROR,
  AssessmentComment,
  AssessmentView,
  CommentThread,
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

/**
 * The comment form and its thread live in a drawer, and a toast sits behind it: what the server said goes back to the
 * caller, which shows it inside the drawer.
 */
export type CommentOutcome = { readonly ok: true; readonly comment: AssessmentComment } | { readonly ok: false; readonly message: string };
export type WithdrawOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };
/** `message` is '' when the page was out of date: it was read again and the reason said in a toast. */
export type AnswerOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * `coreKeys`: the core fields still neither green nor commented (409 `ASSESSMENT_CORE_UNCOMMENTED`).
 * `message` is '' when the page was out of date: it was read again and the reason said in a toast.
 */
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
  ASSESSMENT_ERROR.CLARIFICATION_NOT_PENDING,
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
export class ReviewStore implements OnDestroy {
  private readonly api = inject(AssessmentApi);
  private readonly acting = inject(ActingRoleState);
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
  /**
   * What the program answered on each comment, by comment id (P2-3911). Read after the assessment, and again with
   * it, only when the result carries a comment that still stands.
   */
  readonly threads = signal<ReadonlyMap<number, CommentThread>>(new Map());
  /** The program's responses could not be read: the thread says so instead of looking unanswered. */
  readonly threadsFailed = signal(false);
  /** Id of the comment whose clarification answer is on its way. */
  readonly answering = signal<number | null>(null);
  /**
   * The server refused an answer because the programs step is closed (or the caller only reads): the form is not
   * offered again on this result. The page has no other way to know that step's state.
   */
  readonly clarifyClosed = signal(false);
  readonly quickComments = signal<readonly QuickComment[]>([]);
  readonly savingQuick = signal(false);
  /**
   * The QA Admin acting as a reviewer (admin/acts-as-reviewer): the roles the server offers on this result (empty for
   * anyone else) and the one the view was built for (`null` = reading only).
   */
  readonly actingRoles = computed(() => this.view()?.actingRoles ?? []);
  readonly actingRole = computed(() => this.view()?.actingRole ?? null);
  /** A role switch is reading the view again as the new role. */
  readonly switchingRole = signal(false);
  /** The caller's user id: only their own open comments can be withdrawn (FR-13). */
  readonly me = computed(() => this.session.user()?.id ?? null);

  /** Only the newest load writes its answer (a quick switch of result never shows an older one). */
  private seq = 0;
  /** Two green/grey writes were on their way at once: their answers may land out of order. */
  private overlapped = false;
  /** Only the newest read of the program's responses is painted (two re-reads may be on their way at once). */
  private threadsSeq = 0;
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
    // The busy marks belong to the result left behind (its answers are dropped by `still`).
    this.validating.set(new Set());
    this.overlapped = false;
    this.state.set('loading');
    this.error.set(null);
    this.threads.set(new Map());
    this.threadsFailed.set(false);
    this.clarifyClosed.set(false);
    this.threadsSeq++;
    const resultCode = positiveInt(code);
    if (resultCode === null) {
      this.acting.clear();
      return this.fail(seq, NOT_FOUND);
    }
    try {
      let timelineId = positiveInt(timeline);
      if (timelineId === null) {
        timelineId = (await firstValueFrom(this.api.timelines())).defaultTimelineId;
        if (seq !== this.seq) return;
        if (timelineId === null) return this.fail(seq, NO_TIMELINE);
      }
      // A role picked on another result never travels to this one.
      this.acting.keepOnly(timelineId, resultCode);
      const view = await firstValueFrom(this.api.view(timelineId, resultCode));
      if (seq !== this.seq) return;
      this.timelineId.set(timelineId);
      this.resultCode.set(resultCode);
      this.view.set(view);
      this.state.set('ready');
      void this.loadThreads({ timelineId, resultCode }, view);
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
    // Not while a finish is on its way: its end and this answer could land in either order.
    if (!at || this.finishing() || busy.has(busyKey) || busy.has(ALL_FIELDS) || (busyKey === ALL_FIELDS && busy.size > 0)) return false;
    if (busy.size > 0) this.overlapped = true;
    this.validating.update((set) => new Set(set).add(busyKey));
    try {
      const summary = await firstValueFrom(this.api.setValidations(at.timelineId, at.resultCode, body));
      if (!this.still(at)) return false;
      await this.applySummary(summary);
      return true;
    } catch (error) {
      if (this.still(at)) {
        const e = toApiError(error);
        await this.resync(e);
        this.toasts.error(e.message);
      }
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

  /** A refused text keeps its form: the caller shows `message` next to it, inside the drawer. */
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
      // Out of date: the form is about to leave the drawer, so the reason also goes in a toast.
      if (await this.resync(e)) this.toasts.error(e.message);
      return { ok: false, message: e.message };
    } finally {
      this.commenting.set(false);
    }
  }

  /** The author takes back an own open comment: it leaves the counts and the program's view. */
  async withdrawComment(commentId: number): Promise<WithdrawOutcome> {
    const at = this.target();
    if (!at || this.withdrawing() !== null) return { ok: false, message: '' };
    this.withdrawing.set(commentId);
    try {
      const saved = await firstValueFrom(this.api.withdrawComment(commentId));
      if (this.still(at)) this.patchComments(saved.fieldKey, (list) => list.map((c) => (c.id === saved.id ? saved : c)));
      return { ok: true };
    } catch (error) {
      const e = toApiError(error);
      if (this.still(at)) await this.resync(e);
      return { ok: false, message: e.message };
    } finally {
      this.withdrawing.set(null);
    }
  }

  // ---------- The program's responses and the clarification answer (P2-3911) ----------

  /**
   * The author answers the clarification the program requested on a comment. The server allows it only while the
   * programs step is open. A refused text keeps its form: the caller shows `message` inside the drawer.
   */
  async answerClarification(commentId: number, body: string): Promise<AnswerOutcome> {
    const at = this.target();
    const text = body.trim();
    if (!at || !text || this.answering() !== null) return { ok: false, message: '' };
    this.answering.set(commentId);
    try {
      const thread = await firstValueFrom(this.api.answerClarification(commentId, text));
      if (this.still(at)) {
        // A read of the threads still on its way holds the state before this answer: it is not painted.
        this.threadsSeq++;
        this.threads.update((map) => new Map(map).set(thread.commentId, thread));
        this.patchComments(thread.fieldKey, (list) => list.map((c) => (c.id === thread.commentId ? { ...c, state: thread.state } : c)));
        // The result's status may have left "Clarification requested": read it as the server holds it now.
        void this.reload();
      }
      return { ok: true };
    } catch (error) {
      const e = toApiError(error);
      if (!this.still(at)) return { ok: false, message: e.message };
      if (e.status === 400 || e.status === 413 || e.status === 422) return { ok: false, message: e.fields[0]?.message ?? e.message };
      if (e.code === ASSESSMENT_ERROR.STEP_CLOSED || e.code === ASSESSMENT_ERROR.READ_ONLY) this.clarifyClosed.set(true);
      // Out of date (already answered, the step closed): the form is about to leave the drawer, so a toast says why.
      if (await this.resync(e)) {
        this.toasts.error(e.message);
        return { ok: false, message: '' };
      }
      return { ok: false, message: e.message };
    } finally {
      this.answering.set(null);
    }
  }

  /** Best effort: a failed read keeps the threads already on screen and raises `threadsFailed`. */
  private async loadThreads(at: Target, view: AssessmentView): Promise<void> {
    const seq = ++this.threadsSeq;
    const commented = [...view.sections.flatMap((s) => s.fields), ...view.other].some((f) => f.comments.some((c) => c.state !== 'withdrawn'));
    if (!commented) {
      this.threads.set(new Map());
      this.threadsFailed.set(false);
      return;
    }
    try {
      const threads = await firstValueFrom(this.api.programResponses(at.timelineId, at.resultCode));
      if (seq !== this.threadsSeq || !this.still(at)) return;
      this.threads.set(new Map(threads.map((t) => [t.commentId, t] as const)));
      this.threadsFailed.set(false);
    } catch {
      if (seq === this.threadsSeq && this.still(at)) this.threadsFailed.set(true);
    }
  }

  // ---------- Finish (FR-14, FR-15) ----------

  async finish(): Promise<FinishOutcome> {
    const at = this.target();
    // Not while a green/grey write is on its way: its answer could repaint a pending state over the end.
    if (!at || this.finishing() || this.validating().size > 0) return { ok: false, message: '' };
    this.finishing.set(true);
    try {
      const summary = await firstValueFrom(this.api.finish(at.timelineId, at.resultCode));
      if (this.still(at)) await this.applySummary(summary);
      return { ok: true };
    } catch (error) {
      const e = toApiError(error);
      if (!this.still(at)) return { ok: false, message: e.message };
      if (e.code === ASSESSMENT_ERROR.CORE_UNCOMMENTED) return { ok: false, message: e.message, coreKeys: e.fieldKeys };
      if (await this.resync(e)) {
        this.toasts.error(e.message);
        return { ok: false, message: '' };
      }
      return { ok: false, message: e.message };
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
      const list = await firstValueFrom(this.api.quickComments(this.quickRole()));
      // A text saved while the list was on its way stays on top.
      this.quickComments.update((mine) => [...mine.filter((q) => !list.some((l) => l.id === q.id)), ...list]);
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
      const saved = await firstValueFrom(this.api.saveQuickComment(this.quickRole(), text));
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

  // ---------- The Admin acting as a reviewer (admin/acts-as-reviewer) ----------

  /**
   * The Admin acts as `role` on this result (`null` = back to reading only): every call of the result carries the
   * role from now on and the view is read again, built for it. The controls then follow `writable` / `decidable` as
   * for that reviewer. The quick comments are the role's list, so they are read again on the next open.
   */
  async actAs(role: ActingRole | null): Promise<void> {
    const at = this.target();
    if (!at || this.switchingRole() || role === this.actingRole()) return;
    if (role !== null && !this.actingRoles().includes(role)) return;
    this.acting.set(at.timelineId, at.resultCode, role);
    this.quickLoaded = false;
    this.quickComments.set([]);
    this.switchingRole.set(true);
    try {
      await this.reload();
    } finally {
      this.switchingRole.set(false);
    }
  }

  /** Leaving the page drops the pick: the Admin reads only on the next result until it picks again. */
  ngOnDestroy(): void {
    this.acting.clear();
  }

  /** The quick comments of the role the caller writes as: the Admin's picked role, else the assessors' list. */
  private quickRole(): QuickCommentRole {
    return this.actingRole() ?? WRITER_ROLE;
  }

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
          // An ended assessment takes no more writes, whatever the read that follows manages to bring.
          ...(summary.status === 'pending' ? {} : { writable: false, readOnlyReason: 'finished' as const }),
        },
    );
    if (summary.status === 'pending') return;
    await this.reload();
    if (this.state() !== 'ready') return;
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

  /**
   * After a refused write, reads the assessment again when the refusal says the page is out of date, and also when the
   * answer never arrived (status 0): the server may have done it. True = the page was out of date.
   */
  private async resync(e: ApiError): Promise<boolean> {
    const outOfDate = OUT_OF_DATE.has(e.code);
    if (outOfDate || e.status === 0) await this.reload();
    return outOfDate;
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
      void this.loadThreads(at, view);
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
