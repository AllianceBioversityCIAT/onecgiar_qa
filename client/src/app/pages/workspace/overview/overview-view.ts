import { Component, computed, inject, signal } from '@angular/core';
import { AuthSession } from '../../../core/auth/auth-session';
import { OvAssessorLoad } from './ov-assessor-load';
import { CycleHeroVm, OvCycleHero, RoundVm } from './ov-cycle-hero';
import { OvPace, PaceVm } from './ov-pace';
import { PROGRAMS, PROGRAM_CODES, QaResult, QaStage, RESULTS, RESULT_TYPES, qaStage } from '../results/results.mock';
import { QaButtonImports, QaMultiSelect, QaSelectImports, QaSelectOption } from '../../../ui';
import { OvStages, StageStatus, TimelineStagesVm } from './ov-stages';
import { OvTimelineLanes, TimelineLaneVm } from './ov-timeline-lanes';
import { OvTypeProgress, TypeProgressVm } from './ov-type-progress';
import { TimelineInfo, daysFromToday, fmt, parseDate, phaseState, shortDate, timelineInfo } from './overview-calc';
import { ASSESSOR_LOAD, MOCK_TODAY, PACE, PHASE_NAMES, PHASE_SHORT, STAGE_CRITERIA, TIMELINES, Timeline } from './overview.mock';

const isOfficial = (b: Timeline) => b.kind === 'Official timeline';

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

/** Results under assessment (automatic ones are not), the source of every count the filters change. TODO(api). */
const IN_QA: readonly QaResult[] = RESULTS.filter((r) => qaStage(r));

/** Results under assessment per timeline name, to turn a filtered count into a share of the timeline. */
const PER_TIMELINE = IN_QA.reduce((m, r) => m.set(r.batch, (m.get(r.batch) ?? 0) + 1), new Map<string, number>());

/** Chips under the filters, in this order. */
type FilterKey = 'program' | 'type';
const FILTER_LABELS: Readonly<Record<FilterKey, string>> = { program: 'Science program', type: 'Result type' };

/** "4 days left" / "today" / "1 day left". */
const daysLeftText = (days: number) => (days <= 0 ? 'today' : days === 1 ? '1 day left' : `${days} days left`);

/** "Closes 23 Jul (4 days left)" / "Starts 01 Sep" for a timeline's current step. */
function whenText(info: TimelineInfo): string {
  if (info.when === 'closes') return `Closes ${info.date} (${daysLeftText(daysFromToday(info.phase.end || info.phase.start))})`;
  if (info.when === 'opens') return `Starts ${info.date}`;
  return `Closed ${info.date}`;
}

/** "All programs" · "SP02, SP05" · "Knowledge products": who a timeline covers. */
function scopeText(b: Timeline): string {
  if (b.programs.length) return b.programs.join(', ');
  if (b.types.length) return b.types.map((t) => t + 's').join(', ');
  return 'All programs';
}

/** "Overview" view of the QA Platform (QA lead): a dashboard where each block answers one question of the QA admin. */
@Component({
  selector: 'qa-overview-view',
  imports: [QaButtonImports, QaSelectImports, QaMultiSelect, OvCycleHero, OvTimelineLanes, OvStages, OvPace, OvTypeProgress, OvAssessorLoad],
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

  /**
   * Line under the greeting, for every live timeline (not only the official one):
   * "4 live timelines · the next step closes in **4 days** (23 Jul)".
   */
  protected readonly context = computed(() => {
    const live = this.timelines.filter((b) => b.status === 'Live');
    if (!live.length) return null;
    const head = `${live.length} live ${live.length === 1 ? 'timeline' : 'timelines'} · `;
    const next = live
      .map((b) => timelineInfo(b))
      .filter((i) => i.when === 'closes')
      .map((i) => ({ days: daysFromToday(i.phase.end || i.phase.start), date: i.date }))
      .sort((a, b) => a.days - b.days)[0];
    if (!next) return { lead: head + 'no step open', key: '', tail: '' };
    // The number of days (or "today") is the part worth a glance; it is the only bold bit.
    return next.days <= 0
      ? { lead: head + 'the next step closes ', key: 'today', tail: '' }
      : { lead: head + 'the next step closes in ', key: `${next.days} ${next.days === 1 ? 'day' : 'days'}`, tail: ` (${next.date})` };
  });

  // ---------- Timelines ----------
  /** Timelines that are not closed: official first, then live by closing date, then scheduled. */
  protected readonly timelines = TIMELINES.filter((b) => b.status !== 'Closed')
    .map((b) => ({ b, info: timelineInfo(b) }))
    .sort(
      (x, y) =>
        Number(!isOfficial(x.b)) - Number(!isOfficial(y.b)) ||
        Number(x.b.status !== 'Live') - Number(y.b.status !== 'Live') ||
        daysFromToday(x.info.phase.end || x.info.phase.start) - daysFromToday(y.info.phase.end || y.info.phase.start),
    )
    .map(({ b }) => b);
  /** Results across every open timeline. */
  protected readonly total = this.timelines.reduce((a, b) => a + b.results, 0);

  /** Live timelines, the ones with results in QA. */
  private readonly live = this.timelines.filter((b) => b.status === 'Live');

  // ---------- Filters: they set what every block counts (agreed with María Julia and Ángel, 2026-10-27) ----------
  /** "Viewing All timelines ⌄": all live timelines together, or one of them. */
  protected readonly timeline = signal('all');
  protected readonly programs = signal<readonly string[]>([]);
  protected readonly types = signal<readonly string[]>([]);

  protected readonly timelineOptions: readonly QaSelectOption[] = [
    { value: 'all', label: 'All timelines', count: fmt(this.live.reduce((a, b) => a + b.results, 0)) },
    ...this.live.map((b) => ({
      value: b.id,
      label: b.name,
      group: isOfficial(b) ? 'Official timeline' : 'Sub-timelines',
      tag: isOfficial(b) ? 'Official' : 'Sub',
      count: fmt(b.results),
    })),
  ];
  protected readonly programOptions = PROGRAM_CODES.map((c) => ({ value: c, label: `${c} ${PROGRAMS[c]}` }));
  protected readonly typeOptions = RESULT_TYPES.map((t) => ({ value: t, label: t }));

  protected readonly applied = computed(() => {
    const values: Record<FilterKey, readonly string[]> = { program: this.programs(), type: this.types() };
    return (Object.keys(FILTER_LABELS) as FilterKey[])
      .filter((k) => values[k].length > 0)
      .map((k) => ({ key: k, label: FILTER_LABELS[k], values: values[k].join(', ') }));
  });

  protected clearFilter(key: FilterKey): void {
    if (key === 'program') this.programs.set([]);
    else this.types.set([]);
  }

  protected clearAll(): void {
    this.programs.set([]);
    this.types.set([]);
  }

  /** The timeline picked in "Viewing", or null for all of them. */
  private readonly picked = computed(() => this.live.find((b) => b.id === this.timeline()) ?? null);

  /** Results under assessment that pass the program and type filters (in any timeline). */
  private readonly matching = computed(() => {
    const programs = this.programs();
    const types = this.types();
    return IN_QA.filter((r) => (!programs.length || programs.includes(r.program)) && (!types.length || types.includes(r.type)));
  });

  /** The same, narrowed to the timeline picked. */
  private readonly inView = computed(() => {
    const one = this.picked();
    return one ? this.matching().filter((r) => r.batch === one.name) : this.matching();
  });

  /** Results that pass the program and type filters, per timeline name. */
  private readonly matchingPerTimeline = computed(() =>
    this.matching().reduce((m, r) => m.set(r.batch, (m.get(r.batch) ?? 0) + 1), new Map<string, number>()),
  );

  /** Share of a timeline's results that pass the program and type filters (1 without them). TODO(api): exact counts. */
  private readonly shares = computed(() => {
    const m = this.matchingPerTimeline();
    return new Map(this.timelines.map((b) => [b.id, PER_TIMELINE.get(b.name) ? (m.get(b.name) ?? 0) / PER_TIMELINE.get(b.name)! : 1]));
  });

  /** A timeline with no results yet (scheduled) whose scope can hold the programs and types picked ("all" when empty). */
  private covers(b: Timeline): boolean {
    const programs = this.programs();
    const types = this.types();
    return (
      (!programs.length || !b.programs.length || b.programs.some((p) => programs.includes(p))) &&
      (!types.length || !b.types.length || b.types.some((t) => types.includes(t)))
    );
  }

  /**
   * Timelines the blocks show: the one picked (or all), and only those with results that pass the filters, so the
   * Timelines block and the counts below always add up. A timeline with no results yet is kept when its scope fits.
   */
  private readonly shown = computed(() =>
    this.timelines.filter(
      (b) =>
        (this.timeline() === 'all' || b.id === this.timeline()) &&
        (PER_TIMELINE.get(b.name) ? (this.matchingPerTimeline().get(b.name) ?? 0) > 0 : this.covers(b)),
    ),
  );

  /** The filters as Results query params, so a count clicked opens Results with the same filters. */
  protected readonly query = computed(() => ({
    timeline: this.picked()?.id ?? null,
    program: this.programs().join(',') || null,
    type: this.types().join(',') || null,
  }));

  // ---------- Hero: the whole cycle at a glance ----------
  protected readonly hero = computed<CycleHeroVm>(() => {
    const one = this.picked();
    const counts = this.inView().reduce((m, r) => m.set(qaStage(r)!, (m.get(qaStage(r)!) ?? 0) + 1), new Map<QaStage, number>());
    const sum = [...counts.values()].reduce((a, n) => a + n, 0);
    const qa = counts.get('quality-assessed') ?? 0;
    const info = one && timelineInfo(one);
    const liveShown = this.shown().filter((b) => b.status === 'Live').length;
    return {
      // All: "from 4 live timelines". One: where it is now, "Step 4 of 5 · closes 23 Jul".
      detail: info
        ? `, Step ${info.step} of ${info.steps} · ${info.when === 'closes' ? 'closes' : info.when === 'opens' ? 'opens' : 'closed'} ${info.date}`
        : `, from ${liveShown} live ${liveShown === 1 ? 'timeline' : 'timelines'}`,
      query: this.query(),
      total: fmt(sum),
      rounds: ROUNDS.map((r) => {
        const stages = r.stages.map((s) => {
          const n = counts.get(s.stage) ?? 0;
          return { ...s, n, count: fmt(n) };
        });
        return { id: r.id, title: r.title, who: r.who, total: fmt(stages.reduce((a, s) => a + s.n, 0)), stages };
      }),
      final: { count: fmt(qa), pct: sum ? Math.round((qa / sum) * 100) : 0 },
    };
  });

  // ---------- Timelines list ----------
  /** The timelines the filters show; with a program or type filter, counts are that share of each timeline. */
  protected readonly lanes = computed<TimelineLaneVm[]>(() =>
    this.shown().map((b) => {
      const info = timelineInfo(b);
      const share = this.shares().get(b.id) ?? 1;
      const st = info.state.kind === 'active' ? { ...info.state, of: Math.round(info.state.of * share), done: Math.round(info.state.done * share) } : info.state;
      const open = info.when === 'closes';
      return {
        id: b.id,
        name: b.name,
        meta: [b.kind, scopeText(b), b.test ? 'Test' : `${fmt(Math.round(b.results * share))} results`].join(' · '),
        scheduled: b.status === 'Scheduled',
        steps: b.phases.map((p, i) => ({
          state: phaseState(p, b).kind,
          label: `${i + 1} · ${PHASE_SHORT[p.name] ?? p.name}`,
          title: `Step ${i + 1} · ${p.name}`,
        })),
        step: open ? info.step : null,
        whenText: whenText(info),
        progress: st.kind === 'active' && st.of > 0 ? { done: fmt(st.done), of: fmt(st.of), pct: st.pct } : null,
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
          dates: p.end ? `${shortDate(p.start)} – ${shortDate(p.end)}` : `From ${shortDate(p.start)}`,
          status,
          progress: st.kind === 'active' && st.of > 0 ? { pct: st.pct, done: fmt(st.done), of: fmt(st.of), left: fmt(st.of - st.done) } : null,
          summary: st.kind === 'done' ? (p.done ?? '') : '',
        };
      }),
    };
  });

  // ---------- Assessment pace ----------
  /** "Assessor ⌄" in Assessment pace, for the assessors' step only. */
  protected readonly paceAssessor = signal('all');
  protected readonly assessorOptions: readonly QaSelectOption[] = [
    { value: 'all', label: 'All assessors' },
    ...ASSESSOR_LOAD.map((a) => ({ value: a.name, label: a.name })),
  ];
  /** Share of the assessors' work done by the assessor picked (1 for all). TODO(api): daily history per assessor. */
  private readonly assessorShare = computed(() => {
    const a = ASSESSOR_LOAD.find((x) => x.name === this.paceAssessor());
    const all = ASSESSOR_LOAD.reduce((n, x) => n + x.done + x.left, 0);
    return a && all ? (a.done + a.left) / all : 1;
  });

  /** One entry per open step with history: behind pace first, soonest close first (the first one is shown by default). */
  protected readonly pace = computed<PaceVm[]>(() =>
    PACE.flatMap((s) => {
      const b = this.shown().find((t) => t.id === s.timelineId);
      if (!b) return [];
      const info = timelineInfo(b);
      const start = parseDate(info.phase.start);
      const end = parseDate(info.phase.end);
      if (info.when !== 'closes' || !start || !end || info.state.kind !== 'active') return [];
      const span = Math.round((end.getTime() - start.getTime()) / 864e5);
      const byAssessor = info.phase.name === PHASE_NAMES[0];
      // The filters narrow the step to a share of its results (and of one assessor's, in the assessors' step).
      const f = (this.shares().get(b.id) ?? 1) * (byAssessor ? this.assessorShare() : 1);
      const target = Math.round(info.state.of * f);
      if (target <= 0) return [];
      return [{
        id: b.id,
        label: `${b.name} · Step ${info.step}`,
        step: `Step ${info.step}`,
        target,
        done: s.done.map((v) => Math.round(v * f)),
        span,
        startLabel: shortDate(info.phase.start),
        endLabel: shortDate(info.phase.end),
        byAssessor,
      }];
    })
      // Behind: the last week's pace would not get through the step before it closes.
      .map((p) => {
        const today = p.done.length - 1;
        const back = Math.min(7, today);
        const perDay = back ? (p.done[today] - p.done[today - back]) / back : 0;
        const daysLeft = Math.max(0, p.span - today);
        return { p, behind: p.done[today] + perDay * daysLeft < p.target, daysLeft };
      })
      .sort((a, b) => Number(b.behind) - Number(a.behind) || a.daysLeft - b.daysLeft)
      .map(({ p }) => p),
  );

  // ---------- Progress by result type ----------
  protected readonly typeProgress = computed<TypeProgressVm[]>(() => {
    const by = new Map<string, { r1: number; r2: number; qa: number }>();
    for (const r of this.inView()) {
      const s = qaStage(r)!;
      const row = by.get(r.type) ?? { r1: 0, r2: 0, qa: 0 };
      if (s === 'quality-assessed') row.qa++;
      else if (s.startsWith('r1-')) row.r1++;
      else row.r2++;
      by.set(r.type, row);
    }
    return [...by.entries()]
      .map(([type, c]) => {
        const total = c.r1 + c.r2 + c.qa;
        return { type, ...c, total: fmt(total), qaText: fmt(c.qa), pct: Math.round((c.qa / (total || 1)) * 100) };
      })
      .sort((a, b) => a.pct - b.pct);
  });

  // ---------- Assessor load ----------
  /** Timelines whose open step is the assessors' step: the only ones the assessor load counts. */
  private readonly inAssessorsStep = (list: readonly Timeline[]) =>
    list.filter((b) => timelineInfo(b).when === 'closes' && timelineInfo(b).phase.name === PHASE_NAMES[0]);

  /** The load mock covers every timeline in the assessors' step; the filters keep their share of it. TODO(api). */
  protected readonly assessorLoad = computed(() => {
    const all = this.inAssessorsStep(this.timelines).reduce((n, b) => n + b.results, 0);
    const kept = this.inAssessorsStep(this.shown()).reduce((n, b) => n + b.results * (this.shares().get(b.id) ?? 1), 0);
    const f = all ? kept / all : 0;
    return ASSESSOR_LOAD.map((a) => ({ ...a, done: Math.round(a.done * f), left: Math.round(a.left * f) })).filter((a) => a.done + a.left > 0);
  });
  protected readonly loadScope = computed(() => {
    const names = this.inAssessorsStep(this.shown()).map((b) => b.name);
    return names.length ? `Timelines in the assessors' step: ${names.join(', ')}` : 'No timeline in these filters is in the assessors’ step';
  });
  // ---------- Actions ----------
  /** A row in "Timeline progress": open its stages pop-up. */
  protected openStages(id: string): void {
    this.stagesId.set(id);
    this.stagesOpen.set(true);
  }
}
