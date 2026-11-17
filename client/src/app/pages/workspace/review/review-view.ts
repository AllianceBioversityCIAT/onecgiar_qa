// @akili-spec assessment/step-1-assessment
import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, requiredError, validate } from '@angular/forms/signals';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { WorkspaceLayout } from '../../../shell/workspace-layout';
import { QaButtonImports, QaDrawerImports, QaReveal } from '../../../ui';
import { ReviewAside } from './review-aside';
import { ReviewCodeInfo } from './review-code-info';
import { CommentsDrawerMode, CommentsDrawerVm, ReviewCommentsDrawer } from './review-comments-drawer';
import { ReviewFieldCard } from './review-field-card';
import { FooterMode, ReviewFooter } from './review-footer';
import { CardAction, SectionNavVm } from './review-model';
import { ReviewSkeleton } from './review-skeleton';
import { ReviewStore } from './review-store';
import { REVIEW_AI_PROVIDERS, ReviewAiHook } from './ai/review-ai-hook';
import { ReviewTocSection, TocCardAction } from './review-toc-section';
import { findField, toDrawerVm } from './review.mapper';

/** The review area stacks its navigator on top below this width (container). */
const NARROW_PX = 900;
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
    QaDrawerImports,
    QaReveal,
    RouterLink,
    ReviewAside,
    ReviewCodeInfo,
    ReviewCommentsDrawer,
    ReviewFieldCard,
    ReviewFooter,
    ReviewSkeleton,
    ReviewTocSection,
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly titleRow = viewChild<ElementRef<HTMLElement>>('titleRow');

  private readonly route = inject(ActivatedRoute);
  private readonly routeCode = toSignal(this.route.paramMap.pipe(map((p) => p.get('code'))), { initialValue: null });
  private readonly routeTimeline = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('timeline'))), { initialValue: null });

  protected readonly vm = this.store.vm;
  /** Not connected in step 1: no field is flagged by AI (DD-13). */
  protected readonly aiCount = 0;

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
    const step = this.finishStep();
    if (step === 'confirm') return 'confirm';
    if (step === 'warn' && this.openCount() > 0) return 'warn';
    return 'normal';
  });
  protected readonly warnText = computed(() => (this.openCount() === 1 ? 'field still needs your review.' : 'fields still need your review.'));
  protected readonly skippedCount = this.skipped.asReadonly();

  // ---- Comments drawer ----
  protected readonly drawerOpen = signal(false);
  private readonly drawerKey = signal<string | null>(null);
  protected readonly commentModel = signal({ text: '' });
  protected readonly commentForm = form(this.commentModel, (f) => {
    validate(f.text, ({ value }) => (value().trim() ? null : requiredError({ message: 'Write a comment before adding it.' })));
  });
  protected readonly focusTick = signal(0);
  private readonly drawerMode = computed<CommentsDrawerMode>(() => 'read');
  protected readonly drawerField = computed<CommentsDrawerVm | null>(() => {
    const view = this.store.view();
    const key = this.drawerKey();
    const found = view && key ? findField(view, key) : null;
    return found ? toDrawerVm(found, this.drawerMode()) : null;
  });

  constructor() {
    // Load on every route change (the router reuses this view for another result).
    effect(() => {
      const code = this.routeCode();
      const timeline = this.routeTimeline();
      untracked(() => {
        this.drawerOpen.set(false);
        void this.store.load(code, timeline);
      });
    });
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

  protected openDrawer(key: string): void {
    if (this.drawerKey() !== key) this.commentModel.set({ text: '' });
    this.drawerKey.set(key);
    this.drawerOpen.set(true);
    this.focusTick.update((n) => n + 1);
  }

  // ---- Finish flow (local steps; the API call is wired with the review actions) ----
  protected finish(): void {
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
    this.skipped.set(0);
    this.finishStep.set('none');
  }

  protected confirmFinish(): void {
    this.finishStep.set('none');
  }

  protected addComment(): void {
    // Wired with the review actions.
  }

  protected pickQuick(text: string): void {
    this.commentModel.update(({ text: cur }) => ({ text: cur.trim() ? cur.replace(/\s+$/, '') + '\n' + text : text }));
  }

  protected withdrawComment(index: number): void {
    void index;
  }
}
