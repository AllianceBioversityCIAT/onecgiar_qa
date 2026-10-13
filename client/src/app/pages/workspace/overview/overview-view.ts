import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { OvAttention, AttentionGroupVm } from './ov-attention';
import { OvLoadDrawer } from './ov-load-drawer';
import { OvOutcomes, OutcomesVm } from './ov-outcomes';
import { CycleHeroVm, OvCycleHero } from './ov-cycle-hero';
import { OvStages, StageVm } from './ov-stages';
import { OvTimelineLanes, TimelineLaneVm } from './ov-timeline-lanes';
import { OvWork, WorkRowVm, WorkTab } from './ov-work';
import { TimelineInfo, daysFromToday, fmt, phaseState, timelineInfo } from './overview-calc';
import {
  ATTENTION,
  OUTCOMES,
  OFFICIAL_RESULTS,
  PHASE_ELAPSED,
  PROGRAMS,
  STAGES,
  STAGE_BASE,
  STATUS_COUNTS,
  TIMELINES,
  Timeline,
  WORK_BASE,
  WORK_BY,
  WORK_BY_TIMELINE,
  WorkRow,
} from './overview.mock';

const isOfficial = (b: Timeline) => b.kind === 'Official timeline';
const ANGLE: Record<'type' | 'program' | 'assessor', string> = { type: 'Result type', program: 'Science program', assessor: 'Assessor' };

/** "closes in 3 days" / "closes today" / "opens 01 Sep" for a timeline's current step. */
function whenText(info: TimelineInfo): string {
  if (info.when === 'closes') {
    const days = daysFromToday(info.phase.end || info.phase.start);
    return days > 0 ? `closes in ${days} ${days === 1 ? 'day' : 'days'}` : 'closes today';
  }
  return `${info.when} ${info.date}`;
}

/** "Overview" view of the QA Platform (QA lead): where the whole cycle stands, and each timeline in it. */
@Component({
  selector: 'qa-overview-view',
  imports: [
    OvCycleHero,
    OvTimelineLanes,
    OvStages,
    OvAttention,
    OvWork,
    OvOutcomes,
    OvLoadDrawer,
  ],
  templateUrl: './overview-view.html',
  host: { class: 'block' },
})
export class OverviewView {
  // ---------- State ----------
  protected readonly workTab = signal<WorkTab>('type');
  /** Row briefly highlighted: a "Where the work is" row ("type:…") or a timeline lane ("lane:…"). */
  protected readonly highlight = signal<string | null>(null);
  protected readonly loadOpen = signal(false);
  /** Load in progress (header shows "Loading results N of M"). */
  protected readonly running = signal<{ done: number; total: number } | null>(null);

  private readonly lanesEl = viewChild.required(OvTimelineLanes, { read: ElementRef });
  private readonly workCard = viewChild.required(OvWork, { read: ElementRef });

  private runTimer: ReturnType<typeof setInterval> | undefined;
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.runTimer);
      clearTimeout(this.highlightTimer);
    });
  }

  // ---------- Timelines ----------
  /** Timelines that are not closed: one lane each, official first. */
  protected readonly timelines = TIMELINES.filter((b) => b.status !== 'Closed').sort((a, b) => Number(!isOfficial(a)) - Number(!isOfficial(b)));
  private readonly officials = this.timelines.filter(isOfficial);
  /** Results across every open timeline. Every number on the page is for the whole cycle. */
  protected readonly total = this.timelines.reduce((a, b) => a + b.results, 0);
  protected readonly totalText = fmt(this.total);

  // ---------- Hero: the whole cycle at a glance ----------
  protected readonly hero = computed<CycleHeroVm>(() => {
    const sum = STATUS_COUNTS.reduce((a, [, n]) => a + n, 0) || 1;
    const assessed = STATUS_COUNTS.find(([s]) => s === 'Quality assessed')?.[1] ?? 0;
    const official = this.officials[0];
    const info = official ? timelineInfo(official) : null;
    const live = this.timelines.filter((b) => b.status === 'Live').length;
    return {
      eyebrow: `2026 cycle, ${live} live ${live === 1 ? 'timeline' : 'timelines'}`,
      total: this.totalText,
      assessedPct: Math.round((assessed / sum) * 100),
      assessed: fmt(assessed),
      step: info ? `Step ${info.step} of ${info.steps}: ${info.phase.name}` : '',
      stepWhen: info ? whenText(info) : '',
      statuses: STATUS_COUNTS.map(([status, n]) => ({ status, count: fmt(n), pct: Math.round((n / sum) * 100) })),
    };
  });

  // ---------- Timeline lanes ----------
  protected readonly lanes = computed<TimelineLaneVm[]>(() =>
    this.timelines.map((b) => {
      const info = timelineInfo(b);
      const st = info.state;
      return {
        id: b.id,
        name: b.name,
        kind: b.kind,
        status: b.status,
        results: fmt(b.results),
        steps: b.phases.map((p) => ({ name: p.name, state: phaseState(p, b).kind })),
        stepText: `Step ${info.step} of ${info.steps}: ${info.phase.name}`,
        whenText: whenText(info),
        progress: st.kind === 'active' && b.results > 0 ? { done: fmt(st.done), of: fmt(st.of || b.results), pct: st.pct } : null,
        highlighted: this.highlight() === 'lane:' + b.id,
      };
    }),
  );

  // ---------- Stage completion ----------
  protected readonly stages = computed<StageVm[]>(() => {
    const f = this.total / STAGE_BASE;
    return STAGES.map((s, i) => {
      const done = Math.round(s.done * f);
      const of = Math.round(s.of * f);
      const pct = of ? Math.round((done / of) * 100) : 0;
      const status = s.closed ? 'Closed' : done === 0 ? 'Not started' : pct < (s.elapsed ?? 0) ? 'Behind' : 'In progress';
      return {
        n: i + 1, name: s.name, criterion: s.criterion, round: i < 2 ? 'QA round 1' : 'QA round 2',
        pct, detail: ` (${fmt(done)}\u00a0of\u00a0${fmt(of)} ${s.word})`, left: of - done, leftText: fmt(of - done),
        status, closed: s.closed, statuses: s.statuses,
      };
    });
  });
  protected readonly shortNote = computed(() => {
    const short = this.stages().find((s) => s.closed && s.left > 0);
    return short ? `Stage ${short.n} closed with ${short.leftText} results uncorrected. They stay as they were submitted.` : null;
  });

  // ---------- Needs attention ----------
  protected readonly attention = computed<AttentionGroupVm[]>(() => {
    if (this.total <= 0) return [];
    return ATTENTION.map((g) => {
      const rows = (g.key === 'pace'
        ? g.rows.filter((r) => (r.pct ?? 0) < PHASE_ELAPSED - 30).map((r) => ({ ...r, sev: PHASE_ELAPSED - (r.pct ?? 0) }))
        : g.rows
      )
        .slice()
        .sort((a, b) => (b.sev ?? 0) - (a.sev ?? 0));
      return { key: g.key, name: g.name, rows };
    }).filter((g) => g.rows.length > 0);
  });

  // ---------- Where the work is ----------
  private rowVm(m: 'type' | 'program' | 'assessor', r: WorkRow, factor: number, withAngle: boolean): WorkRowVm {
    const pending = Math.round(r.pending * factor);
    const done = r.pct >= 100 ? pending : Math.round((pending * r.pct) / (100 - r.pct));
    const key = m + ':' + r.key;
    const programName = PROGRAMS[r.key] ?? r.key;
    return {
      id: key,
      angle: withAngle ? ANGLE[m] : null,
      code: m === 'program' ? r.key : null,
      name: m === 'program' ? programName : r.key,
      person: m === 'assessor' ? (r.person ?? '') : null,
      chip: null,
      title: m === 'program' ? r.key + ' ' + programName : m === 'assessor' ? r.key + ' (' + r.person + ')' : r.key,
      pct: r.pct, detail: ` (${fmt(done)}\u00a0of\u00a0${fmt(done + pending)} reviewed)`, pending: fmt(pending), pace: r.pace,
      highlighted: this.highlight() === key,
      queryParams: m === 'type' ? { type: r.key } : m === 'program' ? { program: r.key } : { assessor: r.person ?? r.key },
      timelineId: null,
    };
  }

  private readonly riskAll = (['type', 'program', 'assessor'] as const).flatMap((m) => WORK_BY[m].filter((r) => r.pace !== 'On track').map((r) => ({ m, r })));
  protected readonly riskCount = this.riskAll.length;

  protected readonly workRows = computed<WorkRowVm[]>(() => {
    const tab = this.workTab();
    const f = this.total / WORK_BASE;
    if (tab === 'timeline') {
      return WORK_BY_TIMELINE.map((t) => {
        const done = t.pct >= 100 ? t.pending : Math.round((t.pending * t.pct) / (100 - t.pct));
        return {
          id: 'timeline:' + t.id, angle: null, code: null, name: t.name, person: null, chip: t.chip, title: t.name,
          pct: t.pct, detail: ` (${fmt(done)}\u00a0of\u00a0${fmt(done + t.pending)} reviewed)`, pending: fmt(t.pending), pace: t.pace,
          highlighted: false, queryParams: null, timelineId: t.id,
        };
      });
    }
    if (tab === 'risk') {
      return this.riskAll
        .slice()
        .sort((a, b) => a.r.pct - b.r.pct)
        .map(({ m, r }) => this.rowVm(m, r, f, true));
    }
    return WORK_BY[tab].map((r) => this.rowVm(tab, r, f, false));
  });

  // ---------- Assessment outcomes ----------
  protected readonly outcomes = computed<OutcomesVm>(() => {
    const f = this.total / OFFICIAL_RESULTS;
    const sc = (n: number) => Math.round(n * f);
    return {
      total: this.totalText,
      approvedFirstPass: sc(OUTCOMES.approvedFirstPass),
      returnedResolved: sc(OUTCOMES.returnedResolved),
      returnedOpen: sc(OUTCOMES.returnedOpen),
      neverFinished: sc(OUTCOMES.neverFinished),
      autoApproved: sc(OUTCOMES.autoApproved),
    };
  });

  // ---------- Actions ----------
  /** A timeline row in "Where the work is": scroll to its lane and flash it. */
  protected pickTimeline(id: string): void {
    clearTimeout(this.highlightTimer);
    this.highlight.set('lane:' + id);
    this.lanesEl().nativeElement.querySelector('#lane-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.highlightTimer = setTimeout(() => this.highlight.set(null), 2000);
  }

  /** "See SP09" & co.: switch "Where the work is" to At risk and flash the matching row. */
  protected goRisk(key: string): void {
    clearTimeout(this.highlightTimer);
    this.workTab.set('risk');
    this.highlight.set(key);
    this.workCard().nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.highlightTimer = setTimeout(() => this.highlight.set(null), 2000);
  }

  /** Simulated load: counts up to the total, then the header button comes back. */
  protected startRun(total: number): void {
    // TODO(api): start the load job on the server and poll its progress instead of simulating it.
    clearInterval(this.runTimer);
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
        this.runTimer = setTimeout(() => this.running.set(null), 900);
      }
    }, 250);
  }

  protected readonly runningText = computed(() => {
    const r = this.running();
    return r ? fmt(r.done) + ' of ' + fmt(r.total) : '';
  });
}
