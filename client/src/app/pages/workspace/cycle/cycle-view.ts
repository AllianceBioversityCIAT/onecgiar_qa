import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { QaTabsImports } from '../../../ui';
import {
  ACTIVE_CYCLE,
  AUDIENCES,
  CLOSED_EXTRA,
  CYCLE_LIST,
  CycleStep,
  OFFICIAL_TIMELINE,
  RUN_TARGETS,
  TIMELINES,
  Timeline,
} from './cycle.mock';
import { MenuAction, StepDraftRow, formatNumber, runEstimate, shortDate, stepState, timelineStart, timelineVM } from './cycle.logic';
import { LoadDrawer, RunRequest } from './load-drawer';
import { ProgressDrawer, StepProgress } from './progress-drawer';
import { StepDrawer, StepRequest, StepSaveEvent } from './step-drawer';
import { TimelineCard } from './timeline-card';
import { TimelineDrawer, TimelineRequest, TimelineSaveEvent } from './timeline-drawer';
import { TimelineSteps } from './timeline-steps';

const byStartDesc = (a: Timeline, b: Timeline) => timelineStart(b) - timelineStart(a);

/** Keeps a step's progress data and adds defaults for new rows (audience by position). */
function mergeSteps(old: readonly CycleStep[], rows: readonly StepDraftRow[]): CycleStep[] {
  return rows.map((p, i) => (old[i] ? { ...old[i], ...p } : { ...p, audience: AUDIENCES[i] ?? 'Assessors', ran: '' }));
}

/** "Cycle" view: active cycle, official timeline, live / closed timelines and their drawers. */
@Component({
  selector: 'qa-cycle-view',
  imports: [HlmButton, QaTabsImports, TimelineSteps, TimelineCard, LoadDrawer, TimelineDrawer, StepDrawer, ProgressDrawer],
  templateUrl: './cycle-view.html',
})
export class CycleView {
  protected readonly activeCycle = ACTIVE_CYCLE;
  protected readonly fmt = formatNumber;

  // ---- Data (mock; TODO(api): load the cycle and its timelines) ----
  protected readonly official = signal<Timeline>(OFFICIAL_TIMELINE);
  protected readonly timelines = signal<Timeline[]>(TIMELINES);

  // ---- Page state ----
  protected readonly cyclesOpen = signal(false);
  /** Name of a closed cycle being viewed (read only), or null for the active one. */
  protected readonly viewCycle = signal<string | null>(null);
  protected readonly tab = signal<string>('live');
  protected readonly closeConfirmId = signal<string | null>(null);
  /** "Loading results 120 of 1,200" counter shown in place of the load button. */
  protected readonly running = signal<{ done: number; total: number } | null>(null);

  protected readonly readOnly = computed(() => !!this.viewCycle());
  protected readonly pageTitle = computed(() => {
    const v = this.viewCycle();
    return v ? `${v.replace(' cycle', '')} assessment cycle` : '2026 assessment cycle';
  });
  protected readonly cycles = computed(() =>
    CYCLE_LIST.map((c) => ({ ...c, results: formatNumber(c.results), canOpen: !c.active && this.viewCycle() !== c.name })),
  );

  protected readonly officialVM = computed(() => timelineVM(this.official(), this.readOnly()));
  private readonly liveList = computed(() => this.timelines().filter((t) => t.status !== 'Closed').sort(byStartDesc));
  private readonly closedList = computed(() => this.timelines().filter((t) => t.status === 'Closed').sort(byStartDesc));
  protected readonly liveVMs = computed(() => this.liveList().map((t) => timelineVM(t, this.readOnly())));
  protected readonly closedVMs = computed(() => this.closedList().map((t) => timelineVM(t, this.readOnly())));
  protected readonly closedTotal = computed(() => (this.closedList().length ? this.closedList().length + CLOSED_EXTRA : 0));

  // ---- Drawers ----
  protected readonly loadOpen = signal(false);
  protected readonly loadRequest = signal<RunRequest>({ target: RUN_TARGETS[0].id, types: [], programs: [], fromStep: false, addTo: null });
  protected readonly timelineOpen = signal(false);
  protected readonly timelineRequest = signal<TimelineRequest>({ timeline: null });
  protected readonly stepOpen = signal(false);
  protected readonly stepRequest = signal<StepRequest>({ timeline: OFFICIAL_TIMELINE, isOfficial: true, index: null });
  protected readonly progressOpen = signal(false);
  protected readonly progress = signal<StepProgress>({ title: '', subtitle: '', pct: 0, done: 0, of: 0 });

  private createdCount = 0;
  private runTimer: ReturnType<typeof setInterval> | undefined;
  private runEndTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.runTimer);
      clearTimeout(this.runEndTimer);
    });
  }

  // ---- Cycles strip ----
  protected openCycle(name: string): void {
    // TODO(api): load the timelines of that cycle (read only).
    this.viewCycle.set(name);
    this.closeConfirmId.set(null);
  }

  protected backToActive(): void {
    this.viewCycle.set(null);
  }

  protected newCycle(): void {
    // TODO(api): create a new cycle (no flow in the mockup yet).
  }

  // ---- Lookups ----
  private timelineById(id: string): Timeline | undefined {
    return id === 'official' ? this.official() : this.timelines().find((t) => t.id === id);
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

  private updateTimeline(id: string, fn: (t: Timeline) => Timeline): void {
    if (id === 'official') this.official.update(fn);
    else this.timelines.update((list) => list.map((t) => (t.id === id ? fn(t) : t)));
  }

  protected saveStep(e: StepSaveEvent): void {
    this.updateTimeline(e.timelineId, (t) => {
      const steps = [...t.steps];
      if (e.index != null && steps[e.index]) steps[e.index] = { ...steps[e.index], ...e.step };
      else steps.push({ ...e.step, ran: '' });
      return { ...t, steps };
    });
  }

  protected removeStep(): void {
    const r = this.stepRequest();
    if (r.index == null) return;
    const idx = r.index;
    this.updateTimeline(r.timeline.id, (t) => ({ ...t, steps: t.steps.filter((_, k) => k !== idx) }));
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
    this.timelineOpen.set(true);
  }

  /** Help tooltip of "New sub-timeline" (hover or keyboard focus on the ⓘ; Esc hides it). */
  protected readonly subHelp = signal(false);

  protected newSubTimeline(): void {
    this.timelineRequest.set({ timeline: null });
    this.timelineOpen.set(true);
  }

  protected saveTimeline(e: TimelineSaveEvent): void {
    if (e.id) {
      const id = e.id;
      this.updateTimeline(id, (t) =>
        id === 'official'
          ? { ...t, steps: mergeSteps(t.steps, e.steps) }
          : { ...t, name: e.name, programs: e.programs, types: e.types, test: e.test, steps: mergeSteps(t.steps, e.steps) },
      );
      return;
    }
    const est = runEstimate(e.types, e.programs);
    const created: Timeline = {
      id: `new-${++this.createdCount}`,
      created: true,
      name: e.name,
      kind: 'Sub-timeline',
      status: 'Scheduled',
      test: e.test,
      results: e.runNow ? est.pulled : 0,
      programs: e.programs,
      types: e.types,
      steps: e.steps.map((p, i) => ({
        ...p,
        audience: AUDIENCES[i] ?? 'Assessors',
        ran: i === 0 && e.runNow ? `Results loaded on ${shortDate(p.start)} · ${formatNumber(est.pulled)} results` : '',
      })),
    };
    if (created.steps.some((p) => stepState(p, created).kind === 'active')) created.status = 'Live';
    this.timelines.update((list) => [created, ...list]);
    this.tab.set('live');
    // TODO(api): the server loads the results into step 1 when "Load results into step 1 now" is on.
    if (e.runNow) this.startRun(est.matched);
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
        // TODO(api): delete the test results of this timeline.
        this.updateTimeline(id, (x) => ({ ...x, results: 0 }));
        break;
      case 'close':
        this.closeConfirmId.set(id);
        break;
    }
  }

  protected closeTimeline(id: string): void {
    // TODO(api): close the timeline (open steps end today).
    this.closeConfirmId.set(null);
    this.updateTimeline(id, (t) => ({ ...t, status: 'Closed' }));
  }

  protected loadMoreClosed(): void {
    // TODO(api): page through the closed timelines.
  }
}
