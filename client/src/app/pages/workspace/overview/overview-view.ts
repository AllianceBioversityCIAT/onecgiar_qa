import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { OvAttention, AttentionGroupVm } from './ov-attention';
import { OvLoadDrawer } from './ov-load-drawer';
import { OvOutcomes, OutcomesVm } from './ov-outcomes';
import { OvResultsInQa, ResultsInQaVm } from './ov-results-in-qa';
import { OvStages, StageVm } from './ov-stages';
import { OvStepCard, StepCardVm } from './ov-step-card';
import { OvTimelineMenu } from './ov-timeline-menu';
import { OvWork, WorkRowVm, WorkTab } from './ov-work';
import { daysFromToday, fmt, shortDate, timelineInfo } from './overview-calc';
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

/** "Overview" view of the QA Platform (QA lead): where the cycle stands, filtered by timeline. */
@Component({
  selector: 'qa-overview-view',
  imports: [
    HlmButton,
    OvTimelineMenu,
    OvResultsInQa,
    OvStepCard,
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
  /** Selected timeline id, or 'all'. */
  protected readonly timelineId = signal('all');
  protected readonly workTab = signal<WorkTab>('type');
  /** Row of "Where the work is" briefly highlighted after a Needs attention link ("type:…"). */
  protected readonly highlight = signal<string | null>(null);
  protected readonly loadOpen = signal(false);
  /** Load in progress (header shows "Loading results N of M"). */
  protected readonly running = signal<{ done: number; total: number } | null>(null);

  private readonly timelineMenu = viewChild.required(OvTimelineMenu);
  private readonly pageTop = viewChild.required<ElementRef<HTMLElement>>('pageTop');
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
  /** Timelines that are not closed (the ones the picker offers). */
  protected readonly timelines = TIMELINES.filter((b) => b.status !== 'Closed');
  private readonly officials = this.timelines.filter(isOfficial);
  private readonly subs = this.timelines.filter((b) => !isOfficial(b));
  protected readonly allCount = this.timelines.reduce((a, b) => a + b.results, 0);

  protected readonly selected = computed(() => this.timelines.find((b) => b.id === this.timelineId()) ?? null);
  /** Results in the selected timeline (or in all of them). Every number on the page scales with it. */
  protected readonly total = computed(() => this.selected()?.results ?? this.allCount);
  protected readonly totalText = computed(() => fmt(this.total()));

  private readonly liveSubs = this.subs.filter((b) => b.status === 'Live').length;
  protected readonly subsLiveText = computed(() =>
    this.selected() || !this.liveSubs ? null : this.liveSubs === 1 ? '1 sub-timeline is also live' : this.liveSubs + ' sub-timelines are also live',
  );

  // ---------- Results in QA (only for "All timelines") ----------
  protected readonly resultsInQa = computed<ResultsInQaVm | null>(() => {
    if (this.selected()) return null;
    const off = this.officials[0];
    const offInfo = off ? timelineInfo(off) : null;
    const sched = this.subs.filter((b) => b.status === 'Scheduled').length;
    return {
      officialCount: fmt(this.officials.reduce((a, b) => a + b.results, 0)),
      officialLine: offInfo ? `Step ${offInfo.step} of ${offInfo.steps} · ${offInfo.when} ${offInfo.date}` : '',
      subsCount: fmt(this.subs.reduce((a, b) => a + b.results, 0)),
      subsLine: [this.liveSubs ? this.liveSubs + ' live' : '', sched ? sched + ' scheduled' : ''].filter(Boolean).join(' · ') || 'None yet',
      statuses: STATUS_COUNTS.map(([status, n]) => ({ status, count: fmt(n) })),
    };
  });

  // ---------- Current step ----------
  protected readonly stepCard = computed<StepCardVm | null>(() => {
    const eff = this.selected();
    const b = eff ?? this.officials[0];
    if (!b) return null;
    const info = timelineInfo(b);
    const p = info.phase;
    const eyebrow = `Step ${info.step} of ${info.steps} · ${eff ? b.name : 'Official timeline'}`;
    const dates = p.end ? shortDate(p.start) + ' – ' + p.end : p.start;
    if (info.state.kind === 'active') {
      const st = info.state;
      const days = daysFromToday(p.end || p.start);
      const card: StepCardVm = {
        eyebrow, audience: p.name, dates,
        tailPre: days > 0 ? 'closes in ' : 'closes today', tailNum: days > 0 ? String(days) : '', tailPost: days > 0 ? (days === 1 ? ' day' : ' days') : '',
        big: fmt(st.done) + ' of ' + fmt(st.of || b.results), pct: st.pct,
      };
      return card;
    }
    const opens = info.when === 'opens';
    const card: StepCardVm = {
      eyebrow, audience: p.name, dates,
      tailPre: opens ? 'opens in ' : 'closed', tailNum: opens ? String(Math.max(0, daysFromToday(p.start))) : '', tailPost: opens ? ' days' : '',
      big: '0 of ' + fmt(b.results), pct: 0,
    };
    return card;
  });

  // ---------- Stage completion ----------
  protected readonly stages = computed<StageVm[]>(() => {
    const f = this.total() / STAGE_BASE;
    return STAGES.map((s, i) => {
      const done = Math.round(s.done * f);
      const of = Math.round(s.of * f);
      const pct = of ? Math.round((done / of) * 100) : 0;
      const status = s.closed ? 'Closed' : done === 0 ? 'Not started' : pct < (s.elapsed ?? 0) ? 'Behind' : 'In progress';
      return {
        n: i + 1, name: s.name, criterion: s.criterion, round: i < 2 ? 'QA round 1' : 'QA round 2',
        pct, detail: ` · ${fmt(done)}\u00a0of\u00a0${fmt(of)} ${s.word}`, left: of - done, leftText: fmt(of - done),
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
    if (this.total() <= 0) return [];
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
      title: m === 'program' ? r.key + ' ' + programName : m === 'assessor' ? r.key + ' · ' + r.person : r.key,
      pct: r.pct, detail: ` · ${fmt(done)}\u00a0of\u00a0${fmt(done + pending)} reviewed`, pending: fmt(pending), pace: r.pace,
      highlighted: this.highlight() === key,
      queryParams: m === 'type' ? { type: r.key } : m === 'program' ? { program: r.key } : { assessor: r.person ?? r.key },
      timelineId: null,
    };
  }

  private readonly riskAll = (['type', 'program', 'assessor'] as const).flatMap((m) => WORK_BY[m].filter((r) => r.pace !== 'On track').map((r) => ({ m, r })));
  protected readonly riskCount = this.riskAll.length;

  protected readonly workRows = computed<WorkRowVm[]>(() => {
    const tab = this.workTab();
    const f = this.total() / WORK_BASE;
    if (tab === 'timeline') {
      return WORK_BY_TIMELINE.map((t) => {
        const done = t.pct >= 100 ? t.pending : Math.round((t.pending * t.pct) / (100 - t.pct));
        return {
          id: 'timeline:' + t.id, angle: null, code: null, name: t.name, person: null, chip: t.chip, title: t.name,
          pct: t.pct, detail: ` · ${fmt(done)}\u00a0of\u00a0${fmt(done + t.pending)} reviewed`, pending: fmt(t.pending), pace: t.pace,
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
    const f = this.total() / OFFICIAL_RESULTS;
    const sc = (n: number) => Math.round(n * f);
    return {
      total: this.totalText(),
      approvedFirstPass: sc(OUTCOMES.approvedFirstPass),
      returnedResolved: sc(OUTCOMES.returnedResolved),
      returnedOpen: sc(OUTCOMES.returnedOpen),
      neverFinished: sc(OUTCOMES.neverFinished),
      autoApproved: sc(OUTCOMES.autoApproved),
    };
  });

  // ---------- Actions ----------
  protected pickOfficial(): void {
    const off = this.officials[0];
    if (off) this.timelineId.set(off.id);
  }

  protected openSubs(): void {
    this.pageTop().nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.timelineMenu().openAtSubs();
  }

  protected pickTimeline(id: string): void {
    this.timelineId.set(id);
    this.pageTop().nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
