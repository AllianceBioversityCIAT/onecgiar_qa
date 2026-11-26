// @akili-spec assessment/step-1-assessment
import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { ActingRole, ActingRoleState } from '../../../core/api/acting-role';
import { AssessmentApi } from '../../../core/api/assessment-api';
import {
  ASSESSMENT_ERROR,
  AssessmentComment,
  AssessmentField,
  AssessmentStatus,
  AssessmentView,
  Decision,
  DecisionKind,
  DecisionResult,
  CommentThread,
  LeadDecision,
  QuickComment,
  QuickCommentRole,
  ValidationSummary,
  ValidationsBody,
} from '../../../core/api/assessment.models';
import { AuthSession } from '../../../core/auth/auth-session';
import { ApiError, toApiError } from '../../../core/http/api-envelope';
import { Toasts } from '../../../core/http/toasts';
import { reloadAfterReplay } from '../../../core/http/write-events';
import { ReviewerMode, reviewerModeOf, toReviewVm } from './review.mapper';

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
export type FinishOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly code?: string; readonly coreKeys?: readonly string[] };
/** Round 2 (Lead): a decision or its clear. A refusal's `message` is also in `decisionErrors`, next to the control. */
export type DecisionOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };
/** The Lead's decision write on its way: which comment, and whether it decides or clears. */
export interface DecidingState {
  readonly commentId: number;
  readonly action: 'decide' | 'clear';
}

const NOT_FOUND: ReviewError = {
  code: ASSESSMENT_ERROR.NOT_FOUND,
  message: 'This result does not exist or is not in your scope.',
};
const NO_TIMELINE: ReviewError = {
  code: ASSESSMENT_ERROR.TIMELINES_NOT_FOUND,
  message: 'You are not assigned to any timeline yet, so there is no assessment to open.',
};

/** Step 1 (round 1): only assessors write, so the quick comments are the assessors' list. */
const WRITER_ROLE: QuickCommentRole = 'ASSESSOR';
/** Round 2: the Lead's list (FR-12). */
const LEAD_ROLE: QuickCommentRole = 'LEAD_ASSESSOR';

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

/** Longest decision comment the API takes, counted by character (round-2 contract § 4). */
const MAX_DECISION = 2000;
const DECISION_EMPTY = 'Write a comment before saving the decision.';

/**
 * Round 2 (Lead): what a refused decision says next to its control, by `error.code` (never the server's text, except
 * as the last resort for a code not listed here). `true` in `reread` = the comment's choices or state may have changed:
 * the view is read again so the controls match what the server holds.
 */
const DECISION_REFUSALS: Readonly<Record<string, { readonly message: string; readonly reread: boolean }>> = {
  [ASSESSMENT_ERROR.FIELD_ESCALATED]: {
    message:
      'Another comment on this field is escalated to TPB, so you cannot agree with the program here. Escalate this one or clear that escalation first.',
    reread: true,
  },
  [ASSESSMENT_ERROR.DECISION_INVALID]: { message: 'This comment cannot take that decision now. The page now shows what it can take.', reread: true },
  [ASSESSMENT_ERROR.FINISHED]: { message: 'This review has already finished. The page now shows its final state.', reread: true },
  [ASSESSMENT_ERROR.STEP_CLOSED]: { message: 'The Lead assessors step is closed, so decisions can no longer change.', reread: true },
  [ASSESSMENT_ERROR.READ_ONLY]: { message: 'You can only read this review.', reread: true },
};

/** TPB / PPU wording where the Lead's would be wrong (P2-3916 § 6, P2-3917 § 6); any other code reads as for the Lead. */
const JUDGE_REFUSALS: Readonly<Record<'tpb' | 'ppu', Readonly<Record<string, { readonly message: string; readonly reread: boolean }>>>> = {
  tpb: {
    [ASSESSMENT_ERROR.STEP_CLOSED]: { message: 'The TPB step is closed, so decisions can no longer change.', reread: true },
    [ASSESSMENT_ERROR.NOT_FOUND]: { message: 'This comment is no longer on this result. The page now shows it as it is.', reread: true },
  },
  ppu: {
    [ASSESSMENT_ERROR.FINISHED]: { message: 'This result is already closed. The page now shows its final state.', reread: true },
    [ASSESSMENT_ERROR.DECISION_INVALID]: { message: 'This comment is not an open case any more. The page now shows it as it is.', reread: true },
    [ASSESSMENT_ERROR.NOT_FOUND]: { message: 'This comment is no longer on this result. The page now shows it as it is.', reread: true },
  },
};

/** What a refused delete says next to its control, by `error.code` (round-2 contract § 4.4, § 7). The view is read again. */
const DELETE_REFUSALS: Readonly<Record<string, string>> = {
  [ASSESSMENT_ERROR.COMMENT_NOT_DELETABLE]:
    'This comment can no longer be deleted: the program already answered it, or it was withdrawn or deleted. The page now shows it as it is.',
  [ASSESSMENT_ERROR.FINISHED]: 'This review has already finished. The page now shows its final state.',
  [ASSESSMENT_ERROR.STEP_CLOSED]: 'The Lead assessors step is closed, so comments can no longer be deleted.',
  [ASSESSMENT_ERROR.READ_ONLY]: 'You can only read this review.',
  [ASSESSMENT_ERROR.NOT_FOUND]: 'This comment is no longer on this result. The page now shows it as it is.',
};

/** Why a green write on one field was refused in round 2, by code: shown next to the field, not in a toast. */
const FIELD_REFUSALS: Readonly<Record<string, string>> = {
  [ASSESSMENT_ERROR.CORE_COMMENT_UNDECIDED]: 'Decide the round-1 comments on this field first: agree with the program or escalate them.',
  [ASSESSMENT_ERROR.FIELD_ESCALATED]: 'This field is escalated to TPB, so it cannot be validated.',
};

/** Round 2: Check all found nothing to send (every core field is green or escalated). */
const NOTHING_TO_CHECK = 'Every core field is already validated or escalated to TPB.';

/** What the toast says when a write ended the assessment, by the status it ended with. */
const ENDED_MESSAGES: Readonly<Record<Exclude<AssessmentStatus, 'pending'>, string>> = {
  quality_assessed: 'Assessment finished: Quality Assessed.',
  returned: 'Assessment finished: returned to the program.',
  escalated: 'Assessment finished: Pending for TPB review.',
};

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
    return view ? toReviewVm(view, true, this.me(), this.mode()) : null;
  });

  /** Field keys with a green/grey write on its way (`ALL_FIELDS` for Check all / Uncheck all). */
  readonly validating = signal<ReadonlySet<string>>(new Set());
  readonly commenting = signal(false);
  /** Id of the comment being withdrawn. */
  readonly withdrawing = signal<number | null>(null);
  readonly finishing = signal(false);
  /** Round 2 (Lead): the decision write on its way (one at a time), or null. */
  readonly deciding = signal<DecidingState | null>(null);
  /** Round 2 (Lead): why the last decision on a comment was refused, by comment id (shown next to its control). */
  readonly decisionErrors = signal<ReadonlyMap<number, string>>(new Map());
  /** Round 2 (Lead): id of the comment being deleted (one delete at a time), or null. */
  readonly deleting = signal<number | null>(null);
  /** Round 2 (Lead): why the last delete of a comment was refused, by comment id (shown next to its control). */
  readonly deleteErrors = signal<ReadonlyMap<number, string>>(new Map());
  /** Why a green write on a field was refused, by field key (shown next to its Approve), e.g. an undecided comment. */
  readonly fieldErrors = signal<ReadonlyMap<string, string>>(new Map());
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
  /**
   * The caller reads this round-2 view as the Lead: the Admin acting as the Lead, or (no acting role) a caller who holds
   * the Lead role for this result type. The view does not name a non-admin caller's reviewer role (contract § 2), and a
   * TPB also writes on a round-2 view, so the assignment tells them apart. Drives the delete and the quick comments.
   */
  readonly leadCaller = computed(() => this.mode() === 'lead');
  /**
   * Who reads the page (`reviewerModeOf`): the Admin's acting role; else, on a round-2 view, the thread (a PPU's items
   * carry `tpbDecision`, a TPB's carry `round` / `leadDecision`); else the caller's Lead assignment for the type.
   */
  readonly mode = computed<ReviewerMode>(() => {
    const view = this.view();
    if (!view) return 'assessor';
    const type = view.header.resultType.key;
    const holdsLead = (this.session.user()?.assignments ?? []).some(
      (a) => a.role === 'LEAD_ASSESSOR' && (a.resultTypeKey === undefined || a.resultTypeKey === 'all' || a.resultTypeKey === type),
    );
    return reviewerModeOf(view, this.actingRole(), holdsLead);
  });

  /** Only the newest load writes its answer (a quick switch of result never shows an older one). */
  private seq = 0;
  /** Two green/grey writes were on their way at once: their answers may land out of order. */
  private overlapped = false;
  /** Only the newest read of the program's responses is painted (two re-reads may be on their way at once). */
  private threadsSeq = 0;
  /** The role whose list was read (null = none yet); another role reads its own list. */
  private quickLoaded: QuickCommentRole | null = null;

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
    this.deciding.set(null);
    this.decisionErrors.set(new Map());
    this.deleting.set(null);
    this.deleteErrors.set(new Map());
    this.fieldErrors.set(new Map());
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

  /**
   * Check all / Uncheck all: every Assessed field of the result, in one request. Round 2 (contract § 4.2): Check all is
   * refused whole once a core field is escalated, so then it sends the grey fields that are not escalated
   * (`fieldKeys`); a refusal for an escalate the page did not know yet reads the view again and sends those once.
   */
  setAllValidated(validated: boolean): Promise<boolean> {
    const keys = validated ? this.checkAllKeys() : null;
    if (keys && !keys.length) {
      this.toasts.info(NOTHING_TO_CHECK);
      return Promise.resolve(false);
    }
    const roundTwo = this.view()?.round === 2;
    return this.validate(ALL_FIELDS, keys ? { validated, fieldKeys: keys } : { validated, all: true }, validated && roundTwo && !keys);
  }

  /**
   * Round 2 with an escalated core field: the actionable core fields that are neither green nor escalated, in page
   * order. `null` when nothing is escalated (Check all goes as `all`) or in round 1.
   */
  private checkAllKeys(): readonly string[] | null {
    const view = this.view();
    if (view?.round !== 2) return null;
    const cores = view.sections.flatMap((s) => s.fields).filter((f) => f.mode === 'assessed' && f.core && f.actionable !== false);
    const escalated = (f: AssessmentField) =>
      (f.thread ?? []).some((t) => t.decision?.decision === 'escalate') ||
      f.comments.some((c) => c.state !== 'withdrawn' && c.decision?.decision === 'escalate');
    if (!cores.some(escalated)) return null;
    return cores.filter((f) => !(f.effectiveValidated ?? f.validated) && !escalated(f)).map((f) => f.key);
  }

  /** `retryEscalated`: a Check all (`all`) refused with `ASSESSMENT_FIELD_ESCALATED` reads the view and goes once by keys. */
  private async validate(busyKey: string, body: ValidationsBody, retryEscalated = false): Promise<boolean> {
    const at = this.target();
    const busy = this.validating();
    // Not while a finish is on its way: its end and this answer could land in either order.
    if (!at || this.finishing() || this.deciding() || this.deleting() !== null || busy.has(busyKey) || busy.has(ALL_FIELDS) || (busyKey === ALL_FIELDS && busy.size > 0)) return false;
    if (busy.size > 0) this.overlapped = true;
    this.dropFieldErrors(busyKey === ALL_FIELDS ? null : busyKey);
    this.validating.update((set) => new Set(set).add(busyKey));
    try {
      const summary = await firstValueFrom(this.api.setValidations(at.timelineId, at.resultCode, body));
      if (!this.still(at)) return false;
      await this.applySummary(summary);
      return true;
    } catch (error) {
      if (!this.still(at)) return false;
      let e = toApiError(error);
      if (retryEscalated && e.code === ASSESSMENT_ERROR.FIELD_ESCALATED) {
        // Still holding the busy mark: no second tap gets in while the view is read and the keys are sent.
        await this.reload();
        const keys = this.still(at) ? this.checkAllKeys() : null;
        if (keys && !keys.length) {
          this.toasts.info(NOTHING_TO_CHECK);
          return false;
        }
        if (keys) {
          try {
            const summary = await firstValueFrom(this.api.setValidations(at.timelineId, at.resultCode, { validated: body.validated, fieldKeys: keys }));
            if (!this.still(at)) return false;
            await this.applySummary(summary);
            return true;
          } catch (again) {
            if (!this.still(at)) return false;
            e = toApiError(again);
          }
        }
      }
      if (this.fieldRefusal(busyKey, e)) return false;
      await this.resync(e);
      this.toasts.error(e.message);
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
      if (this.still(at)) {
        this.patchComments(fieldKey, (list) => [...list.filter((c) => c.id !== saved.id), saved]);
        // Round 2: the Lead's own comment takes `decidable` / `choices` from the view only (contract § 3.2).
        if (this.view()?.round === 2) void this.reload();
      }
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
      if (this.still(at)) {
        this.patchComments(saved.fieldKey, (list) => list.map((c) => (c.id === saved.id ? saved : c)));
        // Round 2: a decision on the withdrawn comment is dropped, and the other comments' choices may change (§ 3.1).
        if (this.view()?.round === 2) void this.reload();
      }
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
    if (!at || this.finishing() || this.deciding() || this.deleting() !== null || this.validating().size > 0) return { ok: false, message: '' };
    this.finishing.set(true);
    try {
      const summary = await firstValueFrom(this.api.finish(at.timelineId, at.resultCode));
      if (this.still(at)) await this.applySummary(summary);
      return { ok: true };
    } catch (error) {
      const e = toApiError(error);
      if (!this.still(at)) return { ok: false, message: e.message };
      if (e.code === ASSESSMENT_ERROR.CORE_UNCOMMENTED) return { ok: false, message: e.message, coreKeys: e.fieldKeys };
      if (e.code === ASSESSMENT_ERROR.CORE_UNDECIDED) {
        // Round 2: the page thought those fields decided; read what the server holds so the cards and the footer agree.
        await this.reload();
        return { ok: false, message: e.message, code: e.code, coreKeys: e.fieldKeys };
      }
      if (await this.resync(e)) {
        this.toasts.error(e.message);
        return { ok: false, message: '' };
      }
      return { ok: false, message: e.message };
    } finally {
      this.finishing.set(false);
    }
  }

  // ---------- Round 2: the Lead's decisions (round-2 contract § 4.1) ----------

  /**
   * The Lead agrees with the program or escalates a round-1 comment, with a required comment (1 to 2,000 characters).
   * A second PUT replaces the decision. The answer is painted at once (decision and stored marks), then the view is
   * read again: the answer carries no `effectiveValidated` and the other comments' `choices` may have changed. When the
   * call ended the review (`status` not `pending`), the page turns read only and says so.
   */
  async decide(commentId: number, decision: DecisionKind, body: string): Promise<DecisionOutcome> {
    const text = body.trim();
    // A PPU's Done takes an optional comment (P2-3917 § 5): none = no `body`. Every other decision needs one.
    if (!text && decision !== 'ppu_done') return this.decisionRefused(commentId, DECISION_EMPTY);
    const length = [...text].length;
    if (length > MAX_DECISION)
      return this.decisionRefused(commentId, `Keep the comment within 2,000 characters (it has ${length.toLocaleString('en-US')}).`);
    return this.writeDecision(commentId, 'decide', (at) => this.api.decide(at.timelineId, at.resultCode, commentId, decision, text || null));
  }

  /** Clears the Lead's decision on a comment (no decision = nothing changes). The view is read again after. */
  clearDecision(commentId: number): Promise<DecisionOutcome> {
    return this.writeDecision(commentId, 'clear', (at) => this.api.clearDecision(at.timelineId, at.resultCode, commentId));
  }

  /** One decision write at a time, never during a green/grey write or a finish (their answers could cross). */
  private async writeDecision(
    commentId: number,
    action: DecidingState['action'],
    send: (at: Target) => Observable<DecisionResult>,
  ): Promise<DecisionOutcome> {
    const at = this.target();
    if (!at || this.deciding() || this.deleting() !== null || this.finishing() || this.validating().size > 0) return { ok: false, message: '' };
    this.deciding.set({ commentId, action });
    this.dropDecisionError(commentId);
    try {
      const result = await firstValueFrom(send(at));
      if (!this.still(at)) return { ok: true };
      const fieldKey = this.threadFieldOf(commentId);
      if (fieldKey) this.dropFieldErrors(fieldKey);
      this.paintDecision(commentId, result);
      await this.applySummary(result, true);
      return { ok: true };
    } catch (error) {
      const e = toApiError(error);
      if (!this.still(at)) return { ok: false, message: e.message };
      if (e.status === 400 || e.status === 413 || e.status === 422) return this.decisionRefused(commentId, e.fields[0]?.message ?? e.message);
      const known = (this.mode() === 'tpb' || this.mode() === 'ppu' ? JUDGE_REFUSALS[this.mode() as 'tpb' | 'ppu'][e.code] : undefined) ?? DECISION_REFUSALS[e.code];
      // The answer never arrived (status 0): the server may have done it, so the page reads what it holds.
      if (known?.reread || e.status === 0) await this.reload();
      return this.decisionRefused(commentId, known?.message ?? e.message);
    } finally {
      this.deciding.set(null);
    }
  }

  private decisionRefused(commentId: number, message: string): DecisionOutcome {
    this.decisionErrors.update((map) => new Map(map).set(commentId, message));
    return { ok: false, message };
  }

  private dropDecisionError(commentId: number): void {
    if (!this.decisionErrors().has(commentId)) return;
    this.decisionErrors.update((map) => {
      const next = new Map(map);
      next.delete(commentId);
      return next;
    });
  }

  /** The field whose round-1 thread, or whose own round-2 comments, hold the comment; or null. */
  private threadFieldOf(commentId: number): string | null {
    for (const s of this.view()?.sections ?? [])
      for (const f of s.fields) if (f.thread?.some((t) => t.commentId === commentId) || f.comments.some((c) => c.id === commentId)) return f.key;
    return null;
  }

  /**
   * The decision as the server stored it, before the re-read lands: on its round-1 thread item (absent = none), or on
   * the Lead's own round-2 comment (`null` = none, contract § 3.2).
   */
  private paintDecision(commentId: number, result: DecisionResult): void {
    this.view.update(
      (view) =>
        view && {
          ...view,
          sections: view.sections.map((s) => ({
            ...s,
            fields: s.fields.map((f) => {
              if (f.thread?.some((t) => t.commentId === commentId))
                return {
                  ...f,
                  thread: f.thread.map((t) => {
                    if (t.commentId !== commentId) return t;
                    const { decision: _old, ...rest } = t;
                    return result.decision ? { ...rest, decision: result.decision } : rest;
                  }),
                };
              if (f.comments.some((c) => c.id === commentId && c.decidable !== undefined))
                return { ...f, comments: f.comments.map((c) => (c.id === commentId ? { ...c, decision: asLeadDecision(result.decision) } : c)) };
              return f;
            }),
          })),
        },
    );
  }

  // ---------- Round 2: the Lead deletes another reviewer's comment (round-2 contract § 4.4) ----------

  /**
   * The Lead deletes a round-1 comment of this result, or another Lead's round-2 comment (the page asked for a
   * confirmation first). One write at a time. The answer does not say whether the review ended, so the view is
   * always read again; an end it shows is said in a toast. A refusal is said next to the control, by code.
   */
  async deleteComment(commentId: number): Promise<DecisionOutcome> {
    const at = this.target();
    if (!at || this.deleting() !== null || this.deciding() || this.finishing() || this.validating().size > 0) return { ok: false, message: '' };
    this.deleting.set(commentId);
    this.dropDeleteError(commentId);
    try {
      await firstValueFrom(this.api.deleteComment(commentId));
      if (!this.still(at)) return { ok: true };
      const before = this.view()?.assessment?.status ?? 'pending';
      await this.reload();
      const after = this.view()?.assessment?.status ?? 'pending';
      if (this.state() === 'ready' && before === 'pending' && after !== 'pending') this.toasts.success(ENDED_MESSAGES[after]);
      return { ok: true };
    } catch (error) {
      const e = toApiError(error);
      if (!this.still(at)) return { ok: false, message: e.message };
      const known = DELETE_REFUSALS[e.code];
      // Every refusal by code means the comment or the review moved; no answer at all may mean it was deleted.
      if (known || e.status === 0) await this.reload();
      const message = known ?? e.message;
      this.deleteErrors.update((map) => new Map(map).set(commentId, message));
      return { ok: false, message };
    } finally {
      this.deleting.set(null);
    }
  }

  private dropDeleteError(commentId: number): void {
    if (!this.deleteErrors().has(commentId)) return;
    this.deleteErrors.update((map) => {
      const next = new Map(map);
      next.delete(commentId);
      return next;
    });
  }

  /**
   * A green write refused for a reason that belongs to the field (an undecided round-1 comment, an escalated field):
   * said next to each field it names, by code. Check all also says it in a toast, since the fields may sit in other
   * sections. False = not such a refusal.
   */
  private fieldRefusal(busyKey: string, e: ApiError): boolean {
    const message = FIELD_REFUSALS[e.code];
    if (!message) return false;
    const keys = e.fieldKeys.length ? e.fieldKeys : busyKey === ALL_FIELDS ? [] : [busyKey];
    this.fieldErrors.update((map) => {
      const next = new Map(map);
      for (const key of keys) next.set(key, message);
      return next;
    });
    if (busyKey === ALL_FIELDS) {
      const view = this.view();
      const names = keys.map((key) => (view ? labelOf(view, key) : null) ?? key);
      this.toasts.error(
        e.code === ASSESSMENT_ERROR.CORE_COMMENT_UNDECIDED
          ? names.length
            ? `Decide the round-1 comments first on: ${names.join(', ')}.`
            : message
          : // Check all by keys still refused (another escalate landed meanwhile, contract § 4.2): one by one.
            'A core field is escalated to TPB, so Check all cannot run. Validate the other fields one by one.',
      );
    }
    return true;
  }

  /** Drops the refusal shown on one field (`null` = on every field). */
  private dropFieldErrors(fieldKey: string | null): void {
    if (fieldKey === null ? this.fieldErrors().size === 0 : !this.fieldErrors().has(fieldKey)) return;
    this.fieldErrors.update((map) => {
      if (fieldKey === null) return new Map();
      const next = new Map(map);
      next.delete(fieldKey);
      return next;
    });
  }

  // ---------- Quick comments (FR-12) ----------

  /** Read once per page, when the comment form first opens. A caller with no grant of the role has no list. */
  async loadQuickComments(): Promise<void> {
    const role = this.quickRole();
    if (this.quickLoaded === role) return;
    if (this.quickLoaded !== null) this.quickComments.set([]);
    this.quickLoaded = role;
    try {
      const list = await firstValueFrom(this.api.quickComments(role));
      if (this.quickLoaded !== role) return;
      // A text saved while the list was on its way stays on top.
      this.quickComments.update((mine) => [...mine.filter((q) => !list.some((l) => l.id === q.id)), ...list]);
    } catch (error) {
      // 403 = no live grant of the role (an admin): nothing to show. Anything else may work on the next open.
      if (toApiError(error).status !== 403 && this.quickLoaded === role) this.quickLoaded = null;
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
    this.quickLoaded = null;
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

  /**
   * The quick comments of the role the caller writes as: the Admin's picked role; else, on a round-2 view, the Lead's
   * list when the caller holds the Lead role for this result type; else the assessors' list. The view does not name the
   * caller's reviewer role (only `actingRole`, for an Admin), so the Lead is told by its assignment.
   */
  private quickRole(): QuickCommentRole {
    const acting = this.actingRole();
    if (acting) return acting;
    const mode = this.mode();
    return mode === 'tpb' ? 'TPB' : mode === 'ppu' ? 'PPU' : mode === 'lead' ? LEAD_ROLE : WRITER_ROLE;
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
   * Paints the answer of a green/grey write, a finish or a decision: the marks as the assessment holds them (a field
   * with no row is grey) and its end. Round 2: the effective green follows too (`effectiveValidated` of the answer when
   * it has it, else the stored row, else the green carried from round 1), so an Undo on a carried green turns it grey
   * at once. An ended assessment is read again, so the page shows the end, who did it and why it is read only now.
   * `reread`: read the view again even when the assessment goes on (a decision's answer has no effective marks).
   */
  private async applySummary(summary: ValidationSummary, reread = false): Promise<void> {
    const stored = new Map(summary.validations.map((v) => [v.fieldKey, v.validated] as const));
    const effective = summary.effectiveValidated ? new Map(summary.effectiveValidated.map((v) => [v.fieldKey, v.validated] as const)) : null;
    this.view.update(
      (view) =>
        view && {
          ...view,
          sections: view.sections.map((s) => ({
            ...s,
            fields: s.fields.map((f) => (f.mode === 'assessed' ? withMarks(f, stored, effective) : f)),
          })),
          assessment: { status: summary.status, assessedBy: summary.assessedBy, finishedAt: summary.finishedAt },
          // An ended assessment takes no more writes, whatever the read that follows manages to bring.
          ...(summary.status === 'pending' ? {} : { writable: false, readOnlyReason: 'finished' as const }),
        },
    );
    if (summary.status === 'pending') {
      if (reread) await this.reload();
      return;
    }
    // Read before the reload: a TPB's `escalated` is Pending PPU, a PPU's last Done closes the result (P2-3916 / P2-3917).
    const mode = this.mode();
    await this.reload();
    if (this.state() !== 'ready') return;
    this.toasts.success(
      mode === 'tpb' && summary.status === 'escalated'
        ? 'Assessment finished: Pending PPU.'
        : mode === 'ppu' && summary.status === 'quality_assessed'
          ? 'Every case is done: the result is now Quality Assessed.'
          : ENDED_MESSAGES[summary.status],
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

/**
 * A field with the marks of a write's answer. `validated` = the stored row (none = grey). Round 2 adds the effective
 * green (contract § 3): the answer's `effectiveValidated` when sent, else the stored row, else the carried green kept.
 * A round-1 field (no effective mark on it, none in the answer) keeps its shape.
 */
function withMarks(
  f: AssessmentField,
  stored: ReadonlyMap<string, boolean>,
  effective: ReadonlyMap<string, boolean> | null,
): AssessmentField {
  const row = stored.get(f.key);
  const validated = row ?? false;
  if (f.effectiveValidated === undefined && !effective) return { ...f, validated };
  const carried = row === undefined && f.carried === true;
  const green = effective?.get(f.key) ?? row ?? (carried ? (f.effectiveValidated ?? false) : false);
  return { ...f, validated, effectiveValidated: green, carried: carried && green };
}

/** Only a Lead decides its own round-2 comment (contract § 3.2): any other kind there is none. */
function asLeadDecision(decision: Decision | null): LeadDecision | null {
  return decision && (decision.decision === 'agree_program' || decision.decision === 'escalate') ? (decision as LeadDecision) : null;
}

/** The label of a field of the view, by key. */
function labelOf(view: AssessmentView, key: string): string | null {
  for (const s of view.sections) for (const f of s.fields) if (f.key === key) return f.label;
  return null;
}
