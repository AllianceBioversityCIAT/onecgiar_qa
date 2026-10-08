import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, requiredError, submit, validate } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { HlmButton } from '@spartan/button';
import { map } from 'rxjs';
import { QaTooltipImports } from '../../../ui';
import { ReviewAside } from './review-aside';
import { ReviewCodeInfo } from './review-code-info';
import { CommentsDrawerVm, ReviewCommentsDrawer } from './review-comments-drawer';
import { ReviewFieldCard } from './review-field-card';
import { FooterMode, ReviewFooter } from './review-footer';
import {
  CardAction,
  FieldVm,
  ResultHeaderVm,
  SectionNavVm,
  aiVm,
  buildFieldVm,
  buildTocCardVm,
  fmtDate,
  groupToc,
  isAssessable,
  isResolved,
} from './review-model';
import { ReviewTocSection, TocCardAction } from './review-toc-section';
import {
  AI_MATCHES,
  CYCLE,
  FIELD_DEFS,
  FieldComment,
  FieldDef,
  FieldState,
  IA_TIP,
  INSTRUCTIONS,
  PROGRAMS,
  PUBLISHED_PROGRAMS,
  RESULTS,
  ResultStatus,
  ReviewResult,
  ReviewState,
  STATUS_CLASSES,
  SECTIONS,
  SectionId,
  allDefsFor,
  buildReview,
  fieldValue,
  isInAssessorQueue,
  sectionsFor,
  tocDefsFor,
} from './review.mock';

interface BulkState {
  readonly sec: SectionId;
  readonly phase: 'confirm' | 'done';
  readonly ids: readonly string[];
}

interface ClosingState {
  readonly code: string;
  readonly next: string | null;
  readonly left: number;
  readonly prevStatus: ResultStatus | undefined;
}

const NARROW_PX = 900;

/** "Result review" (/results/:code): the assessor goes through each section, approves or comments fields. */
@Component({
  selector: 'qa-review-view',
  templateUrl: './review-view.html',
  imports: [
    HlmButton,
    QaTooltipImports,
    ReviewAside,
    ReviewCodeInfo,
    ReviewCommentsDrawer,
    ReviewFieldCard,
    ReviewFooter,
    ReviewTocSection,
  ],
})
export class ReviewView {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly titleRow = viewChild<ElementRef<HTMLElement>>('titleRow');

  private readonly routeCode = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('code'))), {
    initialValue: null,
  });

  // ---- Local state (TODO(api): persist approvals/comments/status through the review endpoint) ----
  private readonly reviews = signal<Readonly<Record<string, ReviewState>>>({});
  private readonly statusOverride = signal<Readonly<Record<string, ResultStatus>>>({});
  private readonly closedQueue = signal<Readonly<Record<string, true>>>({});
  private readonly aiHidden = signal<Readonly<Record<string, 'hidden' | 'dismissed'>>>({});
  private readonly aiOpen = signal<Readonly<Record<string, boolean>>>({});

  protected readonly showAll = signal(false);
  protected readonly rail = signal(false);
  protected readonly narrow = signal(false);

  /** The result in the URL (fallback: first one). */
  private readonly base = computed<ReviewResult>(() => RESULTS.find((r) => r.code === this.routeCode()) ?? RESULTS[0]);
  private readonly code = computed(() => this.base().code);

  protected readonly sectionIdx = linkedSignal<string, number>({ source: this.code, computation: () => 0 });
  protected readonly finishStep = linkedSignal<string, 'none' | 'warn' | 'confirm'>({
    source: this.code,
    computation: () => 'none',
  });
  private readonly skipped = linkedSignal<string, number>({ source: this.code, computation: () => 0 });
  protected readonly bulk = linkedSignal<string, BulkState | null>({ source: this.code, computation: () => null });
  protected readonly closing = linkedSignal<string, ClosingState | null>({ source: this.code, computation: () => null });

  private readonly status = computed<ResultStatus>(() => this.statusOverride()[this.code()] ?? this.base().status);
  /** Knowledge products approved by the auto-check: nothing to review. */
  protected readonly readOnly = computed(() => this.base().status === 'Automatic');
  private readonly state = computed<ReviewState>(() => this.reviews()[this.code()] ?? buildReview(this.base()));

  protected readonly sections = computed(() => sectionsFor(this.base()));
  protected readonly idx = computed(() => Math.min(this.sectionIdx(), this.sections().length - 1));
  protected readonly current = computed(() => this.sections()[this.idx()]);
  protected readonly isToc = computed(() => this.current().id === 'toc');

  private readonly tocDefs = computed(() => tocDefsFor(this.base()));
  private readonly aiData = computed(() => AI_MATCHES[this.code()] ?? {});

  private defsIn(id: SectionId): readonly FieldDef[] {
    return id === 'toc' ? this.tocDefs() : FIELD_DEFS.filter((d) => d.sec === id);
  }

  private fs(id: string): FieldState {
    return this.state()[id] ?? { approved: false, highlighted: false, comments: [] };
  }

  private aiShown(fid: string): boolean {
    return !!this.aiData()[fid] && !this.aiHidden()[this.code() + ':' + fid];
  }

  private aiFor(fid: string) {
    return this.aiShown(fid) ? aiVm(this.aiData()[fid], !!this.aiOpen()[this.code() + ':' + fid]) : null;
  }

  private actionable(d: FieldDef): boolean {
    return !this.readOnly() && isAssessable(d);
  }

  private readonly allDefs = computed(() => this.sections().flatMap((s) => this.defsIn(s.id)));
  private readonly actDefs = computed(() => this.allDefs().filter((d) => this.actionable(d)));
  protected readonly resolvedCount = computed(() => this.actDefs().filter((d) => isResolved(d, this.fs(d.id))).length);
  protected readonly totalCount = computed(() => this.actDefs().length);
  protected readonly openCount = computed(() => this.totalCount() - this.resolvedCount());

  protected readonly sectionNav = computed<SectionNavVm[]>(() =>
    this.sections().map((s, i) => ({
      name: s.name,
      n: i + 1,
      active: i === this.idx(),
      open: this.defsIn(s.id).filter((d) => this.actionable(d) && !isResolved(d, this.fs(d.id))).length,
    })),
  );

  protected readonly header = computed<ResultHeaderVm>(() => {
    const r = this.base();
    const status = this.status();
    const assessed = status !== 'Pending' && !!r.assessor;
    return {
      code: r.code,
      title: fieldValue(FIELD_DEFS.find((d) => d.id === 'title')!, r),
      type: r.type,
      status,
      statusClass: STATUS_CLASSES[status],
      isAuto: status === 'Automatic',
      assessor: r.assessor ?? '—',
      showAssessedBy: assessed,
      instructions: this.readOnly() ? INSTRUCTIONS.readOnly : INSTRUCTIONS.assessor,
      locked: !this.readOnly() && !PUBLISHED_PROGRAMS.includes(r.program),
      details: [
        { label: 'Science program', value: r.program + ' ' + PROGRAMS[r.program] },
        { label: 'Timeline', value: CYCLE.batch },
        { label: 'Step', value: CYCLE.phase },
        { label: 'Assessed by', value: assessed ? (r.assessor ?? '—') : '—' },
        { label: 'Submitted', value: CYCLE.submitted },
      ],
    };
  });

  /** Field cards of the current (non-ToC) section; hidden "context" fields only with Show all fields. */
  protected readonly fields = computed<FieldVm[]>(() => {
    if (this.isToc()) return [];
    return this.defsIn(this.current().id)
      .filter((d) => d.mode !== 'hidden' || this.showAll())
      .map((d) => buildFieldVm(d, this.fs(d.id), this.base(), this.readOnly(), this.aiFor(d.id)));
  });

  protected readonly tocGroups = computed(() =>
    this.isToc()
      ? groupToc(this.tocDefs().map((def) => ({ def, vm: buildTocCardVm(def, this.fs(def.id), this.readOnly(), this.aiFor(def.id)) })))
      : [],
  );
  private readonly tocReal = computed(() => this.tocDefs().filter((d) => !d.mapping));
  protected readonly tocCount = computed(() => this.tocReal().length);
  protected readonly tocPrograms = computed(() => new Set(this.tocReal().map((d) => d.prog)).size);
  protected readonly tocReviewed = computed(() => this.tocReal().filter((d) => isResolved(d, this.fs(d.id))).length);
  private readonly tocOpen = computed(
    () => this.tocDefs().filter((d) => this.actionable(d) && !isResolved(d, this.fs(d.id))).length,
  );

  protected readonly cycle = CYCLE;
  protected readonly iaTip = IA_TIP;
  protected readonly iaAbove = FIELD_DEFS.filter((d) => d.ia && (d.score ?? 0) > 0).length;
  protected readonly iaTotal = FIELD_DEFS.filter((d) => d.ia).length;
  protected readonly iaPrincipal = FIELD_DEFS.filter((d) => d.ia && d.score === 2).length;

  /** Mismatches still shown, and the first section that has one. */
  private readonly aiFlagged = computed(() =>
    Object.keys(this.aiData()).filter((fid) => this.aiData()[fid].verdict === 'mm' && this.aiShown(fid)),
  );
  protected readonly aiCount = computed(() => this.aiFlagged().length);

  // ---- Approve remaining ----
  private readonly bulkEligible = computed(() => {
    if (this.readOnly() || this.isToc()) return [];
    return this.defsIn(this.current().id).filter((d) => this.bulkCandidate(d) && !this.mismatchShown(d.id));
  });
  protected readonly bulkCount = computed(() => this.bulkEligible().length);
  protected readonly bulkFlagged = computed(() =>
    this.isToc() ? 0 : this.defsIn(this.current().id).filter((d) => this.bulkCandidate(d) && this.mismatchShown(d.id)).length,
  );
  protected readonly bulkHere = computed(() => {
    const b = this.bulk();
    return b && b.sec === this.current().id ? b : null;
  });

  private bulkCandidate(d: FieldDef): boolean {
    const fs = this.fs(d.id);
    return isAssessable(d) && !fs.approved && fs.comments.length === 0;
  }

  private mismatchShown(fid: string): boolean {
    return this.aiData()[fid]?.verdict === 'mm' && this.aiShown(fid);
  }

  // ---- Footer ----
  protected readonly footerMode = computed<FooterMode>(() => {
    const step = this.finishStep();
    if (step === 'confirm') return 'confirm';
    if (step === 'warn' && this.openCount() > 0) return 'warn';
    return 'normal';
  });
  protected readonly warnCount = computed(() => (this.tocOpen() > 0 ? this.tocOpen() : this.openCount()));
  protected readonly warnText = computed(() => {
    const t = this.tocOpen();
    if (t > 0) return t === 1 ? 'theory of change contribution still needs your review.' : 'theory of change contributions still need your review.';
    return this.openCount() === 1 ? 'field still needs your review.' : 'fields still need your review.';
  });
  protected readonly commentedCount = computed(
    () => this.allDefs().filter((d) => this.fs(d.id).comments.some((c) => c.role === 'Assessor')).length,
  );
  protected readonly skippedCount = this.skipped.asReadonly();

  // ---- Comments drawer + form (Signal Forms) ----
  protected readonly drawerOpen = signal(false);
  private readonly drawerFid = signal<string | null>(null);
  protected readonly commentModel = signal({ text: '' });
  protected readonly commentForm = form(this.commentModel, (f) => {
    validate(f.text, ({ value }) => (value().trim() ? null : requiredError({ message: 'Write a comment before adding it.' })));
  });
  private readonly draftError = signal(false);
  /** Red border after a failed Add; disappears as soon as the text is valid. */
  protected readonly showDraftError = computed(() => this.draftError() && this.commentForm.text().invalid());
  protected readonly focusTick = signal(0);

  protected readonly drawerField = computed<CommentsDrawerVm | null>(() => {
    const fid = this.drawerFid();
    const d = fid ? allDefsFor(this.base()).find((x) => x.id === fid) : undefined;
    if (!d) return null;
    const fs = this.fs(d.id);
    return {
      label: d.label,
      section: SECTIONS.find((s) => s.id === d.sec)?.name ?? '',
      value: fieldValue(d, this.base()),
      highlighted: fs.highlighted,
      comments: fs.comments,
    };
  });

  private bulkTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.bulkTimer);
      clearTimeout(this.closeTimer);
    });
    // The mockup measures the review area: under 900px the sections column stacks on top.
    afterNextRender(() => {
      const el = this.host.nativeElement.firstElementChild as HTMLElement | null;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(([entry]) => this.narrow.set(entry.contentRect.width < NARROW_PX));
      ro.observe(el);
      this.destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  // ---- Actions ----
  private setField(fid: string, patch: Partial<FieldState>, extra?: FieldComment): void {
    const code = this.code();
    this.reviews.update((all) => {
      const cur = all[code] ?? buildReview(this.base());
      const f = cur[fid] ?? { approved: false, highlighted: false, comments: [] };
      const comments = extra ? [...f.comments, extra] : f.comments;
      return { ...all, [code]: { ...cur, [fid]: { ...f, ...patch, comments } } };
    });
  }

  protected goSection(i: number): void {
    this.sectionIdx.set(i);
    this.finishStep.set('none');
    if (this.narrow()) {
      // Narrow: the page scrolls in the shell's <main>; bring the new section's title row into view if it is above.
      const row = this.titleRow()?.nativeElement;
      const viewTop = row?.closest('main')?.getBoundingClientRect().top ?? 0;
      if (row && row.getBoundingClientRect().top < viewTop) row.scrollIntoView({ block: 'start' });
      return;
    }
    const el = this.scroller()?.nativeElement;
    if (el) el.scrollTop = 0;
  }

  protected goFlagged(): void {
    const all = allDefsFor(this.base());
    const first = this.aiFlagged()
      .map((fid) => this.sections().findIndex((s) => s.id === all.find((d) => d.id === fid)?.sec))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0];
    if (first != null) this.goSection(first);
  }

  protected onCard(fid: string, action: CardAction): void {
    const key = this.code() + ':' + fid;
    switch (action) {
      case 'approve':
        return this.setField(fid, { approved: true });
      case 'undo':
        return this.setField(fid, { approved: false });
      case 'comment':
        return this.openDrawer(fid);
      case 'ai-toggle':
        return this.aiOpen.update((m) => ({ ...m, [key]: !m[key] }));
      case 'ai-hide':
        return this.aiHidden.update((m) => ({ ...m, [key]: 'hidden' }));
      case 'ai-dismiss':
        return this.aiHidden.update((m) => ({ ...m, [key]: 'dismissed' }));
      case 'ai-use':
        return this.openDrawer(fid, this.aiData()[fid]?.text);
    }
  }

  protected onTocCard(e: TocCardAction): void {
    this.onCard(e.id, e.action);
  }

  protected askBulk(): void {
    this.bulk.set({ sec: this.current().id, phase: 'confirm', ids: [] });
  }

  protected confirmBulk(): void {
    const ids = this.bulkEligible().map((d) => d.id);
    clearTimeout(this.bulkTimer);
    ids.forEach((id) => this.setField(id, { approved: true }));
    this.bulk.set({ sec: this.current().id, phase: 'done', ids });
    this.bulkTimer = setTimeout(() => this.bulk.set(null), 8000);
  }

  protected undoBulk(): void {
    clearTimeout(this.bulkTimer);
    this.bulkHere()?.ids.forEach((id) => this.setField(id, { approved: false }));
    this.bulk.set(null);
  }

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
    const ti = this.sections().findIndex((s) => s.id === 'toc');
    this.goSection(this.tocOpen() > 0 && ti >= 0 ? ti : Math.max(0, this.sectionNav().findIndex((s) => s.open > 0)));
  }

  protected keepWorking(): void {
    this.skipped.set(0);
    this.finishStep.set('none');
  }

  /** Moves the result to Awaiting response and opens the next one in the assessor's queue. */
  protected confirmFinish(): void {
    // TODO(api): submit the assessment (approvals + comments) and move the result to Awaiting response.
    const code = this.code();
    const queue = RESULTS.filter(
      (r) => isInAssessorQueue({ ...r, status: this.statusOverride()[r.code] ?? r.status }) && !this.closedQueue()[r.code],
    ).map((r) => r.code);
    const i = queue.indexOf(code);
    const rest = queue.filter((c) => c !== code);
    const next = i >= 0 ? (queue[i + 1] ?? null) : (rest[0] ?? null);
    const prevStatus = this.statusOverride()[code];
    this.statusOverride.update((m) => ({ ...m, [code]: 'Awaiting response' }));
    this.closedQueue.update((m) => ({ ...m, [code]: true }));
    this.finishStep.set('none');
    this.skipped.set(0);
    this.closing.set({ code, next, left: rest.length, prevStatus });
    clearTimeout(this.closeTimer);
    if (next) this.closeTimer = setTimeout(() => void this.router.navigate(['/results', next]), 2000);
  }

  protected undoClose(): void {
    clearTimeout(this.closeTimer);
    const c = this.closing();
    if (!c) return;
    this.statusOverride.update((m) => {
      const { [c.code]: _, ...rest } = m;
      return c.prevStatus ? { ...rest, [c.code]: c.prevStatus } : rest;
    });
    this.closedQueue.update((m) => {
      const { [c.code]: _, ...rest } = m;
      return rest;
    });
    this.closing.set(null);
  }

  protected backToResults(): void {
    clearTimeout(this.closeTimer);
    void this.router.navigate(['/results']);
  }

  // ---- Drawer ----
  protected openDrawer(fid: string, preset?: string): void {
    // Re-opening the same field keeps an unsent draft (closing with text asks before discarding it).
    if (preset !== undefined || this.drawerFid() !== fid) this.commentModel.set({ text: preset ?? '' });
    this.drawerFid.set(fid);
    this.draftError.set(false);
    this.drawerOpen.set(true);
    this.focusTick.update((n) => n + 1);
  }

  protected pickQuick(text: string): void {
    this.commentModel.update(({ text: cur }) => ({ text: cur.trim() ? cur.replace(/\s+$/, '') + '\n' + text : text }));
    this.draftError.set(false);
    this.focusTick.update((n) => n + 1);
  }

  protected async addComment(): Promise<void> {
    const fid = this.drawerFid();
    if (!fid) return;
    const ok = await submit(this.commentForm, async () => {
      // TODO(api): post the comment to the field thread.
      this.setField(
        fid,
        { approved: false },
        { who: this.base().assessor ?? 'M. Chen', role: 'Assessor', date: fmtDate(new Date()), text: this.commentModel().text.trim() },
      );
      this.commentModel.set({ text: '' });
      this.drawerOpen.set(false);
      return undefined;
    });
    if (!ok) {
      this.draftError.set(true);
      this.focusTick.update((n) => n + 1);
    }
  }
}
