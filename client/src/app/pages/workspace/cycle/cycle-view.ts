import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { Toasts } from '../../../core/http/toasts';
import { QaButtonImports, QaReveal, QaTabsImports } from '../../../ui';
import { CycleSkeleton } from './cycle-skeleton';
import { CycleStore, TimelineSaveOutcome } from './cycle-store';
import { RUN_TARGETS, Timeline } from './cycle.mock';
import { MenuAction, formatNumber, stepRow, stepState, timelineStart, timelineVM } from './cycle.logic';
import { RunRequest } from './load-drawer';
import { ProgressDrawer, StepProgress } from './progress-drawer';
import { StepDrawer, StepRequest, StepSaveEvent } from './step-drawer';
import { TimelineCard } from './timeline-card';
import { TimelineDrawer, TimelineRequest, TimelineSaveEvent, TimelineSaveFeedback } from './timeline-drawer';
import { TimelineSteps } from './timeline-steps';

const byStartDesc = (a: Timeline, b: Timeline) => timelineStart(b) - timelineStart(a);

/** Placeholder for the step drawer before a step is picked. */
const EMPTY_TIMELINE: Timeline = { id: '', name: '', kind: 'Sub-timeline', status: 'Scheduled', results: 0, programs: [], types: [], steps: [] };

/**
 * "Cycle" view: the active cycle's official timeline, its live / closed sub-timelines and their
 * drawers, on the cycles API (P2-3934 create and view, P2-3937 edit). Loads, results, export, test
 * timelines, close, reopen and extended access have no API yet: they show as "Coming soon".
 */
@Component({
  selector: 'qa-cycle-view',
  imports: [QaButtonImports, QaTabsImports, QaReveal, CycleSkeleton, TimelineSteps, TimelineCard, TimelineDrawer, StepDrawer, ProgressDrawer],
  providers: [CycleStore],
  templateUrl: './cycle-view.html',
})
export class CycleView implements OnInit {
  protected readonly fmt = formatNumber;
  protected readonly store = inject(CycleStore);
  private readonly toasts = inject(Toasts);

  // ---- Data ----
  protected readonly official = this.store.official;
  protected readonly timelines = this.store.subTimelines;

  // ---- Page state ----
  protected readonly tab = signal<string>('live');
  protected readonly closeConfirmId = signal<string | null>(null);
  /** "Loading results 120 of 1,200" counter shown in place of the load button. */
  protected readonly running = signal<{ done: number; total: number } | null>(null);

  protected readonly officialVM = computed(() => {
    const t = this.official();
    return t ? timelineVM(t) : null;
  });
  /** The Sub-timelines section lists sub-timelines only; the official timeline has its own card. */
  private readonly subs = computed(() => this.timelines().filter((t) => t.kind === 'Sub-timeline'));
  private readonly liveList = computed(() => this.subs().filter((t) => t.status !== 'Closed').sort(byStartDesc));
  private readonly closedList = computed(() => this.subs().filter((t) => t.status === 'Closed').sort(byStartDesc));
  protected readonly liveVMs = computed(() => this.liveList().map((t) => timelineVM(t)));
  protected readonly closedVMs = computed(() => this.closedList().map((t) => timelineVM(t)));
  protected readonly closedTotal = computed(() => this.closedList().length);

  // ---- Drawers ----
  protected readonly loadOpen = signal(false);
  protected readonly loadRequest = signal<RunRequest>({ target: RUN_TARGETS[0].id, types: [], programs: [], fromStep: false, addTo: null });
  protected readonly timelineOpen = signal(false);
  protected readonly timelineRequest = signal<TimelineRequest>({ timeline: null });
  protected readonly stepOpen = signal(false);
  protected readonly stepRequest = signal<StepRequest>({ timeline: EMPTY_TIMELINE, isOfficial: true, index: null });
  protected readonly saving = signal(false);
  protected readonly timelineFeedback = signal<TimelineSaveFeedback | null>(null);
  protected readonly stepFeedback = signal<TimelineSaveFeedback | null>(null);
  protected readonly progressOpen = signal(false);
  protected readonly progress = signal<StepProgress>({ title: '', subtitle: '', pct: 0, done: 0, of: 0 });

  private runTimer: ReturnType<typeof setInterval> | undefined;
  private runEndTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.runTimer);
      clearTimeout(this.runEndTimer);
    });
  }

  ngOnInit(): void {
    void this.store.load();
  }

  // ---- Lookups ----
  private timelineById(id: string): Timeline | undefined {
    return (id === 'official' ? this.official() : this.timelines().find((t) => t.id === id)) ?? undefined;
  }

  // ---- Load results ----
  protected openLoad(request?: Partial<RunRequest>): void {
    this.loadRequest.set({ target: RUN_TARGETS[0].id, types: [], programs: [], fromStep: false, addTo: null, ...request });
    this.loadOpen.set(true);
  }

  protected startRun(total: number): void {
    // TODO(api): the real progress comes from the load job; this only animates the counter.
    clearInterval(this.runTimer);
    clearTimeout(this.runEndTimer);
    this.running.set({ done: 0, total });
    const step = Math.max(1, Math.ceil(total / 48));
    this.runTimer = setInterval(() => {
      const r = this.running();
      if (!r) {
        clearInterval(this.runTimer);
        return;
      }
      const done = Math.min(r.total, r.done + step);
      this.running.set({ ...r, done });
      if (done >= r.total) {
        clearInterval(this.runTimer);
        this.runEndTimer = setTimeout(() => this.running.set(null), 900);
      }
    }, 250);
  }

  // ---- Steps ----
  protected openStep(timelineId: string, index: number | null): void {
    const timeline = this.timelineById(timelineId);
    if (!timeline) return;
    this.stepRequest.set({ timeline, isOfficial: timelineId === 'official', index });
    this.stepFeedback.set(null);
    this.stepOpen.set(true);
  }

  protected openProgress(timelineId: string, index: number): void {
    const t = this.timelineById(timelineId);
    const p = t?.steps[index];
    if (!t || !p) return;
    const st = stepState(p, t);
    if (st.kind !== 'active') return;
    this.progress.set({ title: p.name, subtitle: `${t.name} · closes ${p.end || p.start}`, pct: st.pct, done: st.done, of: st.of });
    this.progressOpen.set(true);
  }

  /** One step's name and dates, saved as an edit of its timeline (the other steps stay as they are). */
  protected async saveStep(e: StepSaveEvent): Promise<void> {
    const before = this.timelineById(e.timelineId);
    if (!before || e.index == null || this.saving()) return;
    const steps = before.steps.map((p, i) => (i === e.index ? { ...stepRow({ ...p, ...e.step }), batch: p.batch } : stepRow(p)));
    const asked = this.stepRequest();
    const outcome = await this.save(() =>
      this.store.update(before, { name: before.name, programs: before.programs, types: before.types, steps }, e.confirmed),
    );
    this.settle(outcome, asked === this.stepRequest() && this.stepOpen(), this.stepOpen, this.stepFeedback);
  }


  protected loadIntoStep(): void {
    const r = this.stepRequest();
    this.stepOpen.set(false);
    this.openLoad({ target: `${r.timeline.id}:${r.index ?? 0}`, types: r.timeline.types, programs: r.timeline.programs, fromStep: true });
  }

  // ---- Timelines ----
  protected editTimeline(id: string): void {
    const timeline = this.timelineById(id);
    if (!timeline) return;
    this.timelineRequest.set({ timeline });
    this.timelineFeedback.set(null);
    this.timelineOpen.set(true);
  }

  /** New sub-timeline, or the official timeline when the cycle has none yet (the first one is official). */
  protected newSubTimeline(): void {
    this.timelineRequest.set({ timeline: null });
    this.timelineFeedback.set(null);
    this.timelineOpen.set(true);
  }

  protected async saveTimeline(e: TimelineSaveEvent): Promise<void> {
    if (this.saving()) return;
    const draft = { name: e.name, programs: e.programs, types: e.types, steps: e.steps };
    const before = e.id ? this.timelineById(e.id) : undefined;
    if (e.id && !before) return;
    const asked = this.timelineRequest();
    const outcome = await this.save(() => (before ? this.store.update(before, draft, e.confirmed) : this.store.create(draft)));
    if (outcome.ok && !before) this.tab.set('live');
    this.settle(outcome, asked === this.timelineRequest() && this.timelineOpen(), this.timelineOpen, this.timelineFeedback);
  }

  /** One save at a time (a second click while the first is in flight does nothing). */
  private async save(run: () => Promise<TimelineSaveOutcome>): Promise<TimelineSaveOutcome> {
    this.saving.set(true);
    try {
      return await run();
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Saved: close. Stale: close and say it was reloaded. Otherwise keep the drawer open with the server's
   * answer. `same` is false when the admin closed the drawer, or opened another one, meanwhile: that one
   * is left alone and a refusal is told as a toast so it is never lost.
   */
  private settle(
    outcome: TimelineSaveOutcome,
    same: boolean,
    open: { set(v: boolean): void },
    feedback: { set(v: TimelineSaveFeedback | null): void },
  ): void {
    if (!same) {
      if (!outcome.ok && !outcome.needsConfirm) this.toasts.error(outcome.message);
      return;
    }
    if (outcome.ok) {
      feedback.set(null);
      open.set(false);
    } else if (outcome.stale) {
      feedback.set(null);
      open.set(false);
      this.toasts.error(outcome.message);
    } else {
      // The in-progress confirmation is a question (the drawer's pop-up), never shown as an error.
      feedback.set({ message: outcome.needsConfirm ? '' : outcome.message, fields: outcome.fields, needsConfirm: outcome.needsConfirm });
    }
  }

  protected onMenu(id: string, action: MenuAction): void {
    const t = this.timelineById(id);
    if (!t) return;
    switch (action) {
      case 'add-results': {
        const ai = t.steps.findIndex((p) => stepState(p, t).kind === 'active');
        this.openLoad({ target: `${t.id}:${Math.max(0, ai)}`, types: t.types, programs: t.programs, addTo: t.name });
        break;
      }
      case 'edit':
        this.editTimeline(id);
        break;
      case 'export':
        // TODO(api): export the comments of this timeline (.xlsx).
        break;
      case 'clear-test':
        // No API yet: the menu shows it greyed out ("Coming soon").
        break;
      case 'close':
        this.closeConfirmId.set(id);
        break;
    }
  }

  protected closeTimeline(_id: string): void {
    // No API yet (closing early is out of scope of the timelines spec): the menu item is greyed out.
    this.closeConfirmId.set(null);
  }
}
