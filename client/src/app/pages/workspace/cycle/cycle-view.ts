import { Component, OnInit, afterNextRender, computed, inject, signal } from '@angular/core';
import { Toasts } from '../../../core/http/toasts';
import { QaButtonImports, QaReveal, QaTabsImports } from '../../../ui';
import { CycleSkeleton } from './cycle-skeleton';
import { CycleStore, TimelineSaveOutcome } from './cycle-store';
import { CycleLoads } from './cycle-loads';
import { Timeline } from './cycle.mock';
import { MenuAction, formatNumber, isStepInForce, loadTargets, stepRow, stepState, timelineStart, timelineVM } from './cycle.logic';
import { RomeClock } from '../../../core/domain/rome-clock';
import { nowInRome } from '../../../core/domain/rome-date';
import { LoadDrawer, LoadDrawerNames, RunRequest } from './load-drawer';
import { LoadSummaryDrawer } from './load-summary-drawer';
import { PeopleDrawer } from './people-drawer';
import { ProgressDrawer, StepProgress } from './progress-drawer';
import { StepDrawer, StepRequest, StepSaveEvent } from './step-drawer';
import { TimelineActions } from './timeline-actions';
import { TimelineCard } from './timeline-card';
import { TimelineDrawer, TimelineRequest, TimelineSaveEvent, TimelineSaveFeedback } from './timeline-drawer';
import { TimelineSteps } from './timeline-steps';

const byStartDesc = (a: Timeline, b: Timeline) => timelineStart(b) - timelineStart(a);

/** Browser storage key of the complementary batches the admin left open (only a viewing preference). */
const OPEN_BATCHES_KEY = 'qa.cycle.openBatches';
/** Enough for a cycle's batches; older ids fall off so the list never grows without end. */
const OPEN_BATCHES_MAX = 50;

/** Placeholder for the step drawer before a step is picked. */
const EMPTY_TIMELINE: Timeline = { id: '', name: '', kind: 'Sub-timeline', status: 'Scheduled', results: 0, programs: [], types: [], steps: [] };

/**
 * "Cycle" view: the active cycle's official timeline, its live / closed sub-timelines and their
 * drawers, on the cycles API (P2-3934 create and view, P2-3937 edit) and the loads API: step-1 loads (P2-4064),
 * then sync at any step into the round in force (P2-3906, contract timeline-sync).
 * Results, export, test timelines, close, reopen and extended access have no API yet: "Coming soon".
 */
@Component({
  selector: 'qa-cycle-view',
  imports: [QaButtonImports, QaTabsImports, QaReveal, CycleSkeleton, TimelineSteps, TimelineActions, TimelineCard, TimelineDrawer, StepDrawer, ProgressDrawer, LoadDrawer, LoadSummaryDrawer, PeopleDrawer],
  providers: [CycleStore, CycleLoads],
  templateUrl: './cycle-view.html',
})
export class CycleView implements OnInit {
  protected readonly fmt = formatNumber;
  protected readonly store = inject(CycleStore);
  protected readonly loads = inject(CycleLoads);
  private readonly toasts = inject(Toasts);
  /** Minute in Rome: the cards, menus and load offers below run again when it moves (N-3). */
  private readonly clock = inject(RomeClock);

  // ---- Data ----
  protected readonly official = this.store.official;
  protected readonly timelines = this.store.subTimelines;

  // ---- Page state ----
  protected readonly tab = signal<string>('live');
  protected readonly closeConfirmId = signal<string | null>(null);
  /** Complementary batches the admin opened: closed by default to one line each; the main batch always shows its steps. */
  protected readonly openBatches = signal<ReadonlySet<string>>(new Set());

  protected readonly officialVM = computed(() => {
    const t = this.official();
    this.clock.minute(); // timelineVM reads the clock inside (step states, "Opens today", round in force)
    return t ? timelineVM(t, this.loadable().has(t.id)) : null;
  });
  /** The Sub-timelines section lists sub-timelines only; the official timeline has its own card. */
  private readonly subs = computed(() => this.timelines().filter((t) => t.kind === 'Sub-timeline'));
  private readonly liveList = computed(() => this.subs().filter((t) => t.status !== 'Closed').sort(byStartDesc));
  private readonly closedList = computed(() => this.subs().filter((t) => t.status === 'Closed').sort(byStartDesc));
  protected readonly liveVMs = computed(() => (this.clock.minute(), this.liveList().map((t) => timelineVM(t, this.loadable().has(t.id)))));
  protected readonly closedVMs = computed(() => (this.clock.minute(), this.closedList().map((t) => timelineVM(t))));
  /** Ids of the timelines that can take a sync now: until their last step closes (none while a load runs or the cycle is closed). */
  private readonly loadable = computed(
    () => new Set(this.canLoad() ? loadTargets(this.store.timelines(), this.clock.minute()).map((t) => t.id) : []),
  );
  /** The step drawer offers "Load results into this step" on the step in force of a loadable timeline (where the sync goes). */
  protected readonly stepLoadable = computed(() => {
    const r = this.stepRequest();
    return this.loadable().has(r.timeline.id) && isStepInForce(r.timeline, r.index, this.clock.minute());
  });
  protected readonly closedTotal = computed(() => this.closedList().length);

  // ---- Drawers ----
  protected readonly peopleOpen = signal(false);
  /** Timeline whose people the drawer shows (kept after closing so the drawer can animate out). */
  protected readonly peopleTimeline = signal<Timeline | null>(null);
  protected readonly loadOpen = signal(false);
  protected readonly loadRequest = signal<RunRequest>({ timelineId: null, fromStep: false });
  protected readonly loadError = signal<string | null>(null);
  /** Timelines that can still take a sync (computed when the drawer opens: the clock moves). */
  protected readonly loadTargetList = signal<readonly Timeline[]>([]);
  protected readonly summaryOpen = signal(false);
  /** Program and result type names for the load drawers (ids when a catalog is missing). */
  protected readonly loadNames: LoadDrawerNames = {
    program: (id, code) => {
      const p = this.store.catalogs().programs.find((x) => x.id === id);
      return p ? `${p.code} ${p.name}` : (code ?? `Program ${id}`);
    },
    type: (key) => this.store.catalogs().types.find((x) => x.key === key)?.name ?? key,
  };
  protected readonly timelineOpen = signal(false);
  protected readonly timelineRequest = signal<TimelineRequest>({ timeline: null });
  protected readonly stepOpen = signal(false);
  protected readonly stepRequest = signal<StepRequest>({ timeline: EMPTY_TIMELINE, isOfficial: true, index: null });
  protected readonly saving = signal(false);
  protected readonly timelineFeedback = signal<TimelineSaveFeedback | null>(null);
  protected readonly stepFeedback = signal<TimelineSaveFeedback | null>(null);
  protected readonly progressOpen = signal(false);
  protected readonly progress = signal<StepProgress>({ title: '', subtitle: '', pct: 0, done: 0, of: 0 });

  constructor() {
    // Read after the first render, in the browser only: the server render and hydration both start closed.
    afterNextRender(() => this.openBatches.set(readOpenBatches()));
  }

  protected setBatchOpen(id: string, open: boolean): void {
    const next = new Set(this.openBatches());
    if (open) next.add(id);
    else next.delete(id);
    this.openBatches.set(next);
    writeOpenBatches(next);
  }

  ngOnInit(): void {
    // Then follow a load of the cycle that is still running (opened in another tab, or before a reload).
    void this.store.load().then(() => this.loads.resume(this.store.timelines()));
  }

  // ---- Lookups ----
  private timelineById(id: string): Timeline | undefined {
    return (id === 'official' ? this.official() : this.timelines().find((t) => t.id === id)) ?? undefined;
  }

  // ---- Load results ----
  /** The admin can load: the cycle is open and no load runs. */
  protected readonly canLoad = computed(() => this.store.canWrite() && !this.loads.running());

  protected openLoad(request?: Partial<RunRequest>): void {
    this.loadTargetList.set(loadTargets(this.store.timelines(), nowInRome()));
    this.loadRequest.set({ timelineId: null, fromStep: false, ...request });
    this.loadError.set(null);
    this.loadOpen.set(true);
  }

  protected async startLoad(t: Timeline): Promise<void> {
    this.loadError.set(null);
    const outcome = await this.loads.start(t);
    if (outcome.ok) {
      this.loadOpen.set(false);
      return;
    }
    if (this.loadOpen()) this.loadError.set(outcome.message);
    else this.toasts.error(outcome.message);
    // Another load runs: the page counter now follows it, so the drawer has nothing more to do.
    if (this.loads.running()) this.loadOpen.set(false);
  }

  protected closeSummary(open: boolean): void {
    if (!open) this.loads.closeSummary();
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
    this.openLoad({ timelineId: r.timeline.id, fromStep: true });
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

  protected openPeople(id: string): void {
    const t = this.timelineById(id);
    if (!t || t.apiId == null) return;
    this.peopleTimeline.set(t);
    this.peopleOpen.set(true);
  }

  /** Someone was added to or removed from a timeline: refresh the cards in place (assignment counts). */
  protected refreshAfterPeople(): void {
    void this.store.load(true);
  }

  protected onMenu(id: string, action: MenuAction): void {
    const t = this.timelineById(id);
    if (!t) return;
    switch (action) {
      case 'add-results': {
        this.openLoad({ timelineId: t.id });
        break;
      }
      case 'edit':
        this.editTimeline(id);
        break;
      case 'people':
        this.openPeople(id);
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

function readOpenBatches(): ReadonlySet<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(OPEN_BATCHES_KEY) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeOpenBatches(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(OPEN_BATCHES_KEY, JSON.stringify([...ids].slice(-OPEN_BATCHES_MAX)));
  } catch {
    // storage blocked: the cards still open and close for this visit
  }
}
