// @akili-spec assessment/step-1-assessment
import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, requiredError, validate } from '@angular/forms/signals';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { Toasts } from '../../../core/http/toasts';
import { WorkspaceLayout } from '../../../shell/workspace-layout';
import { QaButtonImports, QaDialogImports, QaDrawerImports, QaReveal } from '../../../ui';
import { AdminRolePicker } from './admin-role-picker';
import { ReviewAside } from './review-aside';
import { ReviewCodeInfo } from './review-code-info';
import { CommentsDrawerMode, CommentsDrawerVm, ReviewCommentsDrawer } from './review-comments-drawer';
import { ReviewFieldCard } from './review-field-card';
import { ReviewLeadThread } from './review-lead-thread';
import { FooterMode, ReviewFooter } from './review-footer';
import { CardAction, SectionNavVm } from './review-model';
import { ReviewSkeleton } from './review-skeleton';
import { ALL_FIELDS, ReviewStore } from './review-store';
import { AiReasonDialog } from './ai/ai-reason-dialog';
import { AiReasonAsk, REVIEW_AI_PROVIDERS, ReviewAiHook } from './ai/review-ai-hook';
import { ReviewTocSection, TocCardAction } from './review-toc-section';
import { PendingAnswer, coreUncommentedMessage, deleteOpen, findField, pendingAnswers, pendingAnswersBanner, returnsOnAnyComment, toDrawerVm, withPendingAnswers, withdrawOpen } from './review.mapper';
import { QA_GUIDANCE } from './qa-guidance';

/** The review area stacks its navigator on top below this width (container). */
const NARROW_PX = 900;
/** Longest comment the API takes, counted by character (contract § 6.2). */
const MAX_COMMENT = 2000;
/** Toasts sit above the footer of this page (72px; two rows on a phone), where "Finish assessment" is. */
const TOAST_ABOVE_FOOTER = { desktop: '96px', phone: '148px' } as const;
/** Below this viewport width the navigator is a drawer (FR-23). */
const COMPACT_QUERY = '(max-width: 767.98px)';

/**
 * "Result review" (/results/:code?timeline=:id): the assessor goes through each section of one result and marks
 * every Assessed field green or comments on it. Data from the assessment API (`ReviewStore`); the AI notes of the
 * mockup are not connected in step 1 (DD-13).
 */
@Component({
  selector: 'qa-review-view',
  templateUrl: './review-view.html',
  imports: [
    QaButtonImports,
    QaDialogImports,
    QaDrawerImports,
    QaReveal,
    RouterLink,
    ReviewAside,
    ReviewCodeInfo,
    ReviewCommentsDrawer,
    ReviewFieldCard,
    ReviewLeadThread,
    ReviewFooter,
    ReviewSkeleton,
    ReviewTocSection,
    AiReasonDialog,
    AdminRolePicker,
  ],
  providers: [ReviewStore, ...REVIEW_AI_PROVIDERS],
  // A block, so the host has the width of the area (it is what the layout measures).
  host: { class: 'block' },
})
export class ReviewView {
  protected readonly store = inject(ReviewStore);
  /** P2-3918: the AI chips (all logic in `ai/review-ai-hook.ts`). */
  protected readonly ai = inject(ReviewAiHook);
  protected readonly layout = inject(WorkspaceLayout);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(Toasts);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly titleRow = viewChild<ElementRef<HTMLElement>>('titleRow');

  private readonly route = inject(ActivatedRoute);
  private readonly routeCode = toSignal(this.route.paramMap.pipe(map((p) => p.get('code'))), { initialValue: null });
  private readonly routeTimeline = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('timeline'))), { initialValue: null });

  /**
   * P2-3911: the caller's comments on which the program awaits an answer they can give now. None once the server
   * said the programs step closed. Computed only: an answer sent (thread no longer answerable) clears it by itself.
   */
  protected readonly pendingAnswers = computed<readonly PendingAnswer[]>(() => {
    const view = this.store.view();
    return !view || this.store.clarifyClosed() ? [] : pendingAnswers(view, this.store.me(), this.store.threads());
  });
  /** Replaces the read-only banner while an answer is owed. */
  protected readonly clarifyBanner = computed(() => pendingAnswersBanner(this.pendingAnswers()));
  protected readonly vm = computed(() => {
    const page = this.store.vm();
    return page && withPendingAnswers(page, this.pendingAnswers());
  });
  /** Not connected in step 1: no field is flagged by AI (DD-13). */
  protected readonly aiCount = 0;
  /** Link to the written QA guide (F-014). */
  protected readonly guidance = QA_GUIDANCE;

  /** Container narrower than 900px: the navigator stacks on top. */
  protected readonly narrow = signal(false);
  /** Viewport under 768px: the navigator opens as a drawer. */
  protected readonly compact = signal(false);
  protected readonly navOpen = signal(false);

  /** Another result, or the same result on another timeline: the page starts again from its first section. */
  private readonly routeKey = computed(() => `${this.routeCode()}|${this.routeTimeline()}`);
  protected readonly sectionIdx = linkedSignal<string, number>({ source: this.routeKey, computation: () => 0 });
  protected readonly finishStep = linkedSignal<string, 'none' | 'warn' | 'confirm'>({ source: this.routeKey, computation: () => 'none' });
  private readonly skipped = linkedSignal<string, number>({ source: this.routeKey, computation: () => 0 });

  protected readonly sections = computed(() => this.vm()?.sections ?? []);
  protected readonly idx = computed(() => Math.max(0, Math.min(this.sectionIdx(), this.sections().length - 1)));
  protected readonly current = computed(() => this.sections()[this.idx()] ?? null);

  protected readonly sectionNav = computed<SectionNavVm[]>(() =>
    this.sections().map((s, i) => ({ name: s.name, n: i + 1, active: i === this.idx(), open: s.open })),
  );
  protected readonly resolvedCount = computed(() => this.vm()?.resolved ?? 0);
  protected readonly totalCount = computed(() => this.vm()?.total ?? 0);
  protected readonly openCount = computed(() => this.totalCount() - this.resolvedCount());

  // ---- Footer ----
  protected readonly footerMode = computed<FooterMode>(() => {
    // Finished meanwhile (by this page or by another assessor): there is nothing left to confirm.
    if (!this.vm()?.canFinish) return 'normal';
    const step = this.finishStep();
    if (step === 'confirm') return 'confirm';
    if (step === 'warn' && this.openCount() > 0) return 'warn';
    return 'normal';
  });
  protected readonly warnText = computed(() => (this.openCount() === 1 ? 'field still needs your review.' : 'fields still need your review.'));
  protected readonly skippedCount = this.skipped.asReadonly();
  /** Why the server did not finish it (core fields still open…). */
  protected readonly finishError = signal('');
  /** P2-4138: the core fields the server would refuse Finish for, named before the reviewer confirms. */
  protected readonly finishBlocked = computed(() => coreUncommentedMessage(this.vm()?.finishBlockedBy ?? []));

  // ---- Green / grey ----
  protected readonly validating = this.store.validating;
  protected readonly allKey = ALL_FIELDS;
  protected readonly allGreen = computed(() => {
    const page = this.vm();
    return !!page && page.total > 0 && page.validated === page.total;
  });
  /**
   * A green write that leaves every core field green ends the assessment as Quality Assessed, and that cannot be
   * undone (FR-14): the reviewer confirms it first. Holds the field key, or `ALL_FIELDS` for Check all.
   */
  private readonly endingWrite = signal<{ readonly key: string; readonly route: string } | null>(null);
  protected readonly confirmEndOpen = signal(false);
  /**
   * P2-3918 T-10 (FR-10): an IRL / IUL green write 2+ levels above the AI asks a one-line reason first. Order:
   * reason → `validated_above_ai` → the confirmation above when the write ends the assessment → the validation.
   */
  protected readonly reasonAsk = signal<(AiReasonAsk & { readonly key: string; readonly route: string }) | null>(null);
  protected readonly reasonOpen = signal(false);
  protected readonly reasonBusy = signal(false);
  protected readonly reasonFailure = signal('');

  // ---- Comments drawer ----
  protected readonly drawerOpen = signal(false);
  private readonly drawerKey = signal<string | null>(null);
  protected readonly commentModel = signal({ text: '' });
  protected readonly commentForm = form(this.commentModel, (f) => {
    validate(f.text, ({ value }) => (value().trim() ? null : requiredError({ message: 'Write a comment before adding it.' })));
  });
  protected readonly focusTick = signal(0);
  /** The comment form shows while the caller writes on a pending assessment; otherwise the thread is read only. */
  private readonly drawerMode = computed<CommentsDrawerMode>(() => (this.vm()?.canFinish ? 'comment' : 'read'));
  protected readonly drawerField = computed<CommentsDrawerVm | null>(() => {
    const view = this.store.view();
    const key = this.drawerKey();
    const found = view && key ? findField(view, key) : null;
    if (!view || !found) return null;
    const mode = found.field.mode === 'assessed' ? this.drawerMode() : 'read';
    return toDrawerVm(
      found,
      mode,
      { me: this.store.me(), canWithdraw: withdrawOpen(view), canClarify: !this.store.clarifyClosed(), canDelete: deleteOpen(view) },
      this.store.threads(),
    );
  });
  protected readonly quickComments = computed(() => this.store.quickComments().map((q) => ({ id: q.id, text: q.body })));
  /** Add was tried with an empty box. */
  private readonly addTried = signal(false);
  protected readonly showCommentError = computed(() => this.addTried() && !this.commentModel().text.trim());
  /** What the server (or the length rule) said about a text. It goes away as soon as the text changes. */
  private readonly refusedText = signal<{ readonly text: string; readonly message: string } | null>(null);
  protected readonly commentError = computed(() => {
    const refused = this.refusedText();
    return refused && refused.text === this.commentModel().text ? refused.message : '';
  });
  /** Why a withdraw did not go through (shown in the thread: a toast would sit behind the drawer). */
  protected readonly threadError = signal('');
  /** Above the thread: the withdraw refusal, or that the program's responses could not be read (P2-3911). */
  protected readonly threadNote = computed(
    () => this.threadError() || (this.store.threadsFailed() && this.drawerField()?.comments.length ? "The program's responses could not be loaded. Reload the page to try again." : ''),
  );
  /** A comment or a clarification answer is on its way: the drawer's button spins and a second tap does nothing. */
  protected readonly sending = computed(() => this.store.commenting() || this.store.answering() !== null);
  /** The last text this page saved as a quick comment. */
  private readonly quickSavedText = signal<string | null>(null);
  protected readonly quickSaved = computed(() => {
    const text = this.commentModel().text.trim();
    return !!text && (this.quickSavedText() === text || this.store.quickComments().some((q) => q.body === text));
  });

  constructor() {
    // An answer typed for a clarification never stays in the box as the draft of something else (the form left
    // because another tab answered, or the step closed): the box empties when the drawer leaves that mode.
    let lastMode: CommentsDrawerMode | null = null;
    effect(() => {
      const mode = this.drawerField()?.mode ?? null;
      untracked(() => {
        if (lastMode === 'clarify' && mode !== 'clarify') {
          this.commentModel.set({ text: '' });
          this.addTried.set(false);
          this.refusedText.set(null);
        }
        lastMode = mode;
      });
    });
    // Load on every route change (the router reuses this view for another result).
    effect(() => {
      const code = this.routeCode();
      const timeline = this.routeTimeline();
      untracked(() => {
        // Nothing typed or asked on the result left behind travels to the next one (the same field keys repeat).
        this.drawerOpen.set(false);
        this.drawerKey.set(null);
        this.commentModel.set({ text: '' });
        this.addTried.set(false);
        this.refusedText.set(null);
        this.threadError.set('');
        this.quickSavedText.set(null);
        this.confirmEndOpen.set(false);
        this.endingWrite.set(null);
        this.reasonOpen.set(false);
        this.reasonAsk.set(null);
        void this.store.load(code, timeline);
      });
    });
    // The footer with "Finish assessment" is at the bottom right, where the toasts land: lift them while here.
    this.toasts.bottomOffset.set(TOAST_ABOVE_FOOTER);
    this.destroyRef.onDestroy(() => this.toasts.bottomOffset.set(null));
    afterNextRender(() => {
      // The host itself: its first child is the skeleton on the first render, and that one leaves the page.
      const el = this.host.nativeElement;
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(([entry]) => this.narrow.set(entry.contentRect.width < NARROW_PX));
        ro.observe(el);
        this.destroyRef.onDestroy(() => ro.disconnect());
      }
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        const mq = window.matchMedia(COMPACT_QUERY);
        const apply = () => this.compact.set(mq.matches);
        apply();
        mq.addEventListener('change', apply);
        this.destroyRef.onDestroy(() => mq.removeEventListener('change', apply));
      }
    });
  }

  protected retry(): void {
    void this.store.retry(this.routeCode(), this.routeTimeline());
  }

  /** The navigator's collapse is the focus control: it collapses the main menu too (FR-8 AC2). */
  protected setFocus(on: boolean): void {
    this.layout.setFocus(on);
  }

  protected goSection(i: number): void {
    if (i < 0 || i >= this.sections().length) return;
    this.sectionIdx.set(i);
    this.finishStep.set('none');
    this.navOpen.set(false);
    if (this.narrow()) {
      const row = this.titleRow()?.nativeElement;
      const viewTop = row?.closest('main')?.getBoundingClientRect().top ?? 0;
      if (row && row.getBoundingClientRect().top < viewTop) row.scrollIntoView({ block: 'start' });
      return;
    }
    const el = this.scroller()?.nativeElement;
    if (el) el.scrollTop = 0;
  }

  protected onCard(id: string, action: CardAction): void {
    const key = id.split('#')[0];
    if (action === 'comment') this.openDrawer(key);
    else if (action === 'approve') this.setGreen(key);
    else if (action === 'undo') void this.store.setValidated(key, false);
  }

  /** Check all, or Uncheck all once every Assessed field is green. */
  protected toggleAll(): void {
    if (this.allGreen()) void this.store.setAllValidated(false);
    else this.setGreen(ALL_FIELDS);
  }

  private setGreen(key: string): void {
    const ask = this.ai.reasonAsk(key);
    if (ask) {
      this.reasonFailure.set('');
      this.reasonAsk.set({ ...ask, key, route: this.routeKey() });
      this.reasonOpen.set(true);
      return;
    }
    this.greenOrConfirm(key);
  }

  /** P2-3918 T-10: post the reason; only once the server stored it, go on to the confirmation and the validation. */
  protected async saveReason(reason: string): Promise<void> {
    const asked = this.reasonAsk();
    if (!asked || this.reasonBusy()) return;
    this.reasonBusy.set(true);
    this.reasonFailure.set('');
    const stored = await this.ai.recordReason(asked, reason);
    this.reasonBusy.set(false);
    if (!stored) {
      // Nothing validated; the reason stays in the box for another try.
      if (this.reasonAsk() === asked) this.reasonFailure.set('The reason could not be saved, so nothing was validated. Try again.');
      return;
    }
    // Dismissed meanwhile, or another result: the reason is kept, nothing is validated.
    const go = this.reasonAsk() === asked && this.reasonOpen() && asked.route === this.routeKey();
    this.reasonOpen.set(false);
    this.reasonAsk.set(null);
    if (go) this.greenOrConfirm(asked.key);
  }

  private greenOrConfirm(key: string): void {
    if (this.wouldEnd(key)) {
      this.endingWrite.set({ key, route: this.routeKey() });
      this.confirmEndOpen.set(true);
      return;
    }
    void this.writeGreen(key);
  }

  private writeGreen(key: string): Promise<boolean> {
    return key === ALL_FIELDS ? this.store.setAllValidated(true) : this.store.setValidated(key, true);
  }

  protected confirmEnd(): void {
    const asked = this.endingWrite();
    this.confirmEndOpen.set(false);
    this.endingWrite.set(null);
    // Only on the result it was asked for.
    if (asked && asked.route === this.routeKey()) void this.writeGreen(asked.key);
  }

  /**
   * Every core field would be green after this write (an assessment with no core field never ends this way).
   * In step 1 (round 1) a result with any open comment never ends by itself: Finish returns it (OQ-2, 2026-11-18).
   */
  private wouldEnd(key: string): boolean {
    const view = this.store.view();
    if (view && returnsOnAnyComment(view)) return false;
    const cores = (view?.sections ?? []).flatMap((s) => s.fields).filter((f) => f.mode === 'assessed' && f.core);
    // Round 2: a field with a round-1 comment still waiting for the Lead's decision cannot turn green (409
    // ASSESSMENT_CORE_COMMENT_UNDECIDED): the write is sent as is and the refusal shows on the card, no confirmation.
    const undecided = (key: string) => cores.some((f) => f.key === key && f.thread?.some((t) => t.decidable && !t.decision));
    if (key !== ALL_FIELDS && undecided(key)) return false;
    // The effective green (round 2: a green carried from round 1 counts; round 1: equals `validated`).
    return cores.length > 0 && cores.every((f) => (f.effectiveValidated ?? f.validated) || key === ALL_FIELDS || f.key === key);
  }

  protected onTocCard(e: TocCardAction): void {
    this.onCard(e.id, e.action);
  }

  /** P2-3918 "Copy to comment": the comment box opens with the AI's text, editable; nothing is saved (AC6, AC7). */
  protected onAiCopy(key: string): void {
    const text = this.ai.copy(key);
    this.openDrawer(key);
    if (text !== null) this.commentModel.set({ text });
  }

  /** The banner's button: to the section of the first field that owes an answer, and its comments drawer. */
  protected answerFirst(): void {
    const first = this.pendingAnswers()[0];
    if (!first) return;
    const i = this.sections().findIndex((s) => s.key === first.sectionKey);
    if (i >= 0 && i !== this.idx()) this.goSection(i);
    this.openDrawer(first.fieldKey);
  }

  protected openDrawer(key: string): void {
    if (this.drawerKey() !== key) {
      this.commentModel.set({ text: '' });
      this.addTried.set(false);
      this.refusedText.set(null);
      this.threadError.set('');
    }
    this.drawerKey.set(key);
    this.drawerOpen.set(true);
    this.focusTick.update((n) => n + 1);
    if (this.drawerMode() === 'comment') void this.store.loadQuickComments();
  }

  // ---- Finish flow: warn about open fields, confirm, then the API decides (FR-15) ----
  protected finish(): void {
    this.finishError.set('');
    if (this.openCount() > 0) this.finishStep.set('warn');
    else {
      this.skipped.set(0);
      this.finishStep.set('confirm');
    }
  }

  protected finishAnyway(): void {
    this.skipped.set(this.openCount());
    this.finishStep.set('confirm');
  }

  protected reviewThem(): void {
    this.goSection(Math.max(0, this.sectionNav().findIndex((s) => s.open > 0)));
  }

  protected keepWorking(): void {
    this.finishError.set('');
    this.skipped.set(0);
    this.finishStep.set('none');
  }

  protected async confirmFinish(): Promise<void> {
    this.finishError.set('');
    const outcome = await this.store.finish();
    if (outcome.ok) {
      this.finishStep.set('none');
      return;
    }
    if (outcome.coreKeys?.length) {
      // 409 ASSESSMENT_CORE_UNCOMMENTED: say which core fields, by the name the reviewer sees.
      const view = this.store.view();
      const names = outcome.coreKeys.map((key) => (view ? findField(view, key)?.field.label : null) ?? key);
      this.finishError.set(coreUncommentedMessage(names));
      return;
    }
    this.finishError.set(outcome.message);
  }

  protected async addComment(): Promise<void> {
    const key = this.drawerKey();
    const text = this.commentModel().text;
    if (!key) return;
    if (!text.trim()) {
      this.addTried.set(true);
      this.focusTick.update((n) => n + 1);
      return;
    }
    const length = [...text.trim()].length;
    if (length > MAX_COMMENT) {
      this.refusedText.set({ text, message: `Keep the comment within 2,000 characters (it has ${length.toLocaleString('en-US')}).` });
      return;
    }
    // P2-3911: the form is the answer to the clarification the program requested on the caller's comment.
    const clarify = this.drawerField()?.mode === 'clarify' ? this.drawerField()?.clarify : null;
    if (clarify) {
      const answered = await this.store.answerClarification(clarify.commentId, text);
      if (answered.ok) {
        if (this.drawerKey() === key && this.commentModel().text === text) this.commentModel.set({ text: '' });
        this.addTried.set(false);
        this.refusedText.set(null);
      } else if (answered.message) {
        this.refusedText.set({ text, message: answered.message });
        this.focusTick.update((n) => n + 1);
      }
      return;
    }
    const outcome = await this.store.addComment(key, text);
    if (outcome.ok) {
      // P2-3918 T-9: the AI side reports it only when a suggestion was copied to this field's comment box.
      this.ai.commentSaved(key, outcome.comment.id);
      // Only clear what was sent: the reviewer may already be on another field or typing the next comment.
      if (this.drawerKey() === key && this.commentModel().text === text) this.commentModel.set({ text: '' });
      this.addTried.set(false);
      this.refusedText.set(null);
    } else if (outcome.message) {
      this.refusedText.set({ text, message: outcome.message });
      this.focusTick.update((n) => n + 1);
    }
  }

  /** Saves what is in the box as a quick comment of the role (FR-12). */
  protected async saveQuick(): Promise<void> {
    const text = this.commentModel().text.trim();
    if (await this.store.saveQuickComment(text)) this.quickSavedText.set(text);
  }

  protected pickQuick(text: string): void {
    this.commentModel.update(({ text: cur }) => ({ text: cur.trim() ? cur.replace(/\s+$/, '') + '\n' + text : text }));
  }

  protected async withdrawById(id: number): Promise<void> {
    this.threadError.set('');
    const outcome = await this.store.withdrawComment(id);
    if (!outcome.ok && outcome.message) this.threadError.set(outcome.message);
  }

  /** By position: the mockup's comments, which carry no id. */
  protected withdrawComment(index: number): void {
    const id = this.drawerField()?.comments[index]?.id;
    if (id !== undefined) void this.withdrawById(id);
  }
}
