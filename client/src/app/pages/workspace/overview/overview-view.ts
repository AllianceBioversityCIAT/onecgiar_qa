import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { AuthSession } from '../../../core/auth/auth-session';
import { OvAttention, AttentionGroupVm } from './ov-attention';
import { OvLoadDrawer } from './ov-load-drawer';
import { CycleHeroVm, OvCycleHero, RoundVm } from './ov-cycle-hero';
import { QaStage, RESULTS, qaStage } from '../results/results.mock';
import { OvStages, StageStatus, TimelineStagesVm } from './ov-stages';
import { OvTimelineLanes, TimelineLaneVm } from './ov-timeline-lanes';
import { OvWork, WorkRowVm, WorkTab } from './ov-work';
import { TimelineInfo, daysFromToday, fmt, parseDate, phaseState, shortDate, timelineInfo } from './overview-calc';
import {
  ATTENTION,
  MOCK_TODAY,
  PHASE_ELAPSED,
  PROGRAMS,
  STAGE_CRITERIA,
  TIMELINES,
  Timeline,
  WORK_BASE,
  WORK_BY,
  WORK_BY_TIMELINE,
  WorkRow,
} from './overview.mock';

const isOfficial = (b: Timeline) => b.kind === 'Official timeline';
const ANGLE: Record<'type' | 'program' | 'assessor', string> = { type: 'Result type', program: 'Science program', assessor: 'Assessor' };

/** Round columns of the hero (agreed with the QA admin, 2026-10-16). "Quality assessed" is kept for the final state only. */
const ROUNDS: readonly { id: RoundVm['id']; title: string; who: string; stages: readonly { stage: QaStage; label: string; hint: string }[] }[] = [
  {
    id: 'r1', title: 'Round 1', who: 'Assessors',
    stages: [
      { stage: 'r1-pending', label: 'Pending', hint: 'No assessor has opened them yet' },
      { stage: 'r1-review', label: 'In review', hint: 'Assessors are working on them' },
      { stage: 'r1-one', label: 'Assessed by 1 assessor', hint: 'Waiting for the second assessor' },
      { stage: 'r1-two', label: 'Assessed by 2 assessors', hint: 'Round 1 complete, single-check types included' },
    ],
  },
  {
    id: 'r2', title: 'Round 2', who: 'Lead assessors, third-party brokers and PPU',
    stages: [
      { stage: 'r2-pending', label: 'Pending', hint: 'Comments or core fields still to review' },
      { stage: 'r2-assessed', label: 'Assessed', hint: 'Resolved by a lead assessor or a broker' },
    ],
  },
];

/** Results per QA stage. TODO(api): read the counts from the API instead of the Results mock. */
const STAGE_COUNTS = RESULTS.reduce((m, r) => {
  const s = qaStage(r);
  if (s) m.set(s, (m.get(s) ?? 0) + 1);
  return m;
}, new Map<QaStage, number>());

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
    OvLoadDrawer,
  ],
  templateUrl: './overview-view.html',
  host: { class: 'block' },
})
export class OverviewView {
  private readonly session = inject(AuthSession);

  /** Page title: greets the signed-in user by first name, or plainly when the profile has none. */
  protected readonly greeting = computed(() => {
    const name = this.session.user()?.firstName?.trim();
    return name ? `Welcome back, ${name}` : 'Welcome back';
  });

  /** Line under the greeting, as on the PRMS home: "Annual report 2026 · Step 5 of 5 · closes **today**". */
  protected readonly context = computed(() => {
    const official = this.officials[0];
    if (!official) return null;
    const info = timelineInfo(official);
    const when = whenText(info);
    // The number of days (or "today") is the part worth a glance; it is the only bold bit.
    const m = /\d+(?= days?)|today/.exec(when);
    const head = `${official.name} · Step ${info.step} of ${info.steps} · `;
    return m
      ? { lead: head + when.slice(0, m.index), key: m[0], tail: when.slice(m.index + m[0].length) }
      : { lead: head + when, key: '', tail: '' };
  });

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
    const sum = [...STAGE_COUNTS.values()].reduce((a, n) => a + n, 0) || 1;
    const qa = STAGE_COUNTS.get('quality-assessed') ?? 0;
    const live = this.timelines.filter((b) => b.status === 'Live').length;
    return {
      // The cycle name is already in the page header line, so the hero only counts live timelines.
      eyebrow: `${live} live ${live === 1 ? 'timeline' : 'timelines'}`,
      total: this.totalText,
      rounds: ROUNDS.map((r) => {
        const stages = r.stages.map((s) => {
          const n = STAGE_COUNTS.get(s.stage) ?? 0;
          return { ...s, n, count: fmt(n) };
        });
        return { id: r.id, title: r.title, who: r.who, total: fmt(stages.reduce((a, s) => a + s.n, 0)), stages };
      }),
      final: { count: fmt(qa), pct: Math.round((qa / sum) * 100) },
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

  // ---------- Stages of one timeline (pop-up) ----------
  /** Timeline whose stages pop-up is open (kept while it animates out). */
  private readonly stagesId = signal<string | null>(null);
  protected readonly stagesOpen = signal(false);

  protected readonly stagesData = computed<TimelineStagesVm | null>(() => {
    const b = this.timelines.find((t) => t.id === this.stagesId());
    if (!b) return null;
    return {
      name: b.name,
      meta: `${b.kind}, ${fmt(b.results)} results`,
      rows: b.phases.map((p, i) => {
        const st = phaseState(p, b);
        const start = parseDate(p.start);
        const end = parseDate(p.end);
        // Behind: less done than the share of the stage window already gone.
        const elapsed = start && end && end > start ? ((MOCK_TODAY.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100 : 0;
        const status: StageStatus = st.kind === 'done' ? 'Completed' : st.kind === 'future' ? 'Not started' : st.pct < elapsed ? 'Behind' : 'In progress';
        return {
          n: i + 1,
          name: p.name,
          criterion: STAGE_CRITERIA[p.name] ?? '',
          dates: p.end ? `${shortDate(p.start)} \u2013 ${shortDate(p.end)}` : `From ${shortDate(p.start)}`,
          status,
          progress: st.kind === 'active' && st.of > 0 ? { pct: st.pct, done: fmt(st.done), of: fmt(st.of), left: fmt(st.of - st.done) } : null,
          summary: st.kind === 'done' ? (p.done ?? '') : '',
        };
      }),
    };
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

  // ---------- Actions ----------
  /** "View stages" on a timeline lane. */
  protected openStages(id: string): void {
    this.stagesId.set(id);
    this.stagesOpen.set(true);
  }

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
