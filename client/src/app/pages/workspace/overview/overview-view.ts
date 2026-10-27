import { Component, computed, inject, signal } from '@angular/core';
import { AuthSession } from '../../../core/auth/auth-session';
import { OvAttention, AttentionGroupVm } from './ov-attention';
import { OvAssessorLoad } from './ov-assessor-load';
import { CycleHeroVm, OvCycleHero, RoundVm } from './ov-cycle-hero';
import { OvPace, PaceVm } from './ov-pace';
import { QaStage, RESULTS, qaStage } from '../results/results.mock';
import { QaSelectOption } from '../../../ui';
import { OvStages, StageStatus, TimelineStagesVm } from './ov-stages';
import { OvTimelineLanes, TimelineLaneVm } from './ov-timeline-lanes';
import { OvTypeProgress, TypeProgressVm } from './ov-type-progress';
import { TimelineInfo, daysFromToday, fmt, parseDate, phaseState, shortDate, timelineInfo } from './overview-calc';
import { ASSESSOR_LOAD, ATTENTION, MOCK_TODAY, PACE, PHASE_NAMES, PHASE_SHORT, STAGE_CRITERIA, TIMELINES, Timeline } from './overview.mock';

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

/** Results per QA stage, by timeline id and for 'all'. TODO(api): read the counts per timeline from the API instead of the Results mock. */
const STAGE_COUNTS = (() => {
  const idOf = new Map(TIMELINES.map((b) => [b.name, b.id]));
  const out = new Map<string, Map<QaStage, number>>();
  for (const r of RESULTS) {
    const s = qaStage(r);
    if (!s) continue;
    for (const key of ['all', idOf.get(r.batch) ?? r.batch]) {
      const m = out.get(key) ?? new Map<QaStage, number>();
      m.set(s, (m.get(s) ?? 0) + 1);
      out.set(key, m);
    }
  }
  return out;
})();

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
  imports: [OvCycleHero, OvTimelineLanes, OvStages, OvAttention, OvPace, OvTypeProgress, OvAssessorLoad],
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

  // ---------- Hero: the whole cycle at a glance ----------
  /** Live timelines, the ones with results in QA. */
  private readonly live = this.timelines.filter((b) => b.status === 'Live');

  /** "Viewing All timelines ⌄" on the hero: all live timelines together, or one of them. */
  protected readonly heroTimeline = signal('all');
  protected readonly heroOptions: readonly QaSelectOption[] = [
    { value: 'all', label: 'All timelines', count: fmt(this.live.reduce((a, b) => a + b.results, 0)) },
    ...this.live.map((b) => ({
      value: b.id,
      label: b.name,
      group: isOfficial(b) ? 'Official timeline' : 'Sub-timelines',
      tag: isOfficial(b) ? 'Official' : 'Sub',
      count: fmt(b.results),
    })),
  ];

  protected readonly hero = computed<CycleHeroVm>(() => {
    const id = this.heroTimeline();
    const one = this.live.find((b) => b.id === id);
    const counts = STAGE_COUNTS.get(one ? id : 'all') ?? new Map<QaStage, number>();
    const sum = [...counts.values()].reduce((a, n) => a + n, 0);
    const qa = counts.get('quality-assessed') ?? 0;
    const info = one && timelineInfo(one);
    return {
      // All: "from 4 live timelines". One: where it is now, "Step 4 of 5 · closes 23 Jul".
      detail: info
        ? `, Step ${info.step} of ${info.steps} · ${info.when === 'closes' ? 'closes' : info.when === 'opens' ? 'opens' : 'closed'} ${info.date}`
        : `, from ${this.live.length} live ${this.live.length === 1 ? 'timeline' : 'timelines'}`,
      timeline: one ? id : null,
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
  protected readonly lanes = computed<TimelineLaneVm[]>(() =>
    this.timelines.map((b) => {
      const info = timelineInfo(b);
      const st = info.state;
      const open = info.when === 'closes';
      return {
        id: b.id,
        name: b.name,
        meta: [b.kind, scopeText(b), b.test ? 'Test' : `${fmt(b.results)} results`].join(' · '),
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

  // ---------- Needs attention ----------
  protected readonly attention = computed<AttentionGroupVm[]>(() => {
    if (this.total <= 0) return [];
    return ATTENTION.map((g) => {
      const rows = g.rows
        .map((r) => ({ ...r, days: daysFromToday(r.closes), closesOn: shortDate(r.closes) }))
        // Soonest deadline first; on the same day, the row that affects more results.
        .sort((a, b) => a.days - b.days || (b.sev ?? 0) - (a.sev ?? 0));
      return { key: g.key, name: g.name, rows };
    }).filter((g) => g.rows.length > 0);
  });

  // ---------- Assessment pace ----------
  /** One entry per open step with history: behind pace first, soonest close first (the first one is shown by default). */
  protected readonly pace = computed<PaceVm[]>(() =>
    PACE.flatMap((s) => {
      const b = this.timelines.find((t) => t.id === s.timelineId);
      if (!b) return [];
      const info = timelineInfo(b);
      const start = parseDate(info.phase.start);
      const end = parseDate(info.phase.end);
      if (info.when !== 'closes' || !start || !end || info.state.kind !== 'active') return [];
      const span = Math.round((end.getTime() - start.getTime()) / 864e5);
      return [{
        id: b.id,
        label: `${b.name} · Step ${info.step}`,
        step: `Step ${info.step}`,
        target: info.state.of,
        done: s.done,
        span,
        startLabel: shortDate(info.phase.start),
        endLabel: shortDate(info.phase.end),
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
    for (const r of RESULTS) {
      const s = qaStage(r);
      if (!s) continue;
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
  protected readonly assessorLoad = ASSESSOR_LOAD;
  /** Timelines whose open step is the assessors' step: the only ones the assessor load counts. */
  protected readonly loadScope = computed(() => {
    const names = this.timelines.filter((b) => timelineInfo(b).when === 'closes' && timelineInfo(b).phase.name === PHASE_NAMES[0]).map((b) => b.name);
    return names.length ? `Timelines in the assessors' step: ${names.join(', ')}` : 'No timeline is in the assessors’ step';
  });

  // ---------- Actions ----------
  /** A row in "Timelines": open its stages pop-up. */
  protected openStages(id: string): void {
    this.stagesId.set(id);
    this.stagesOpen.set(true);
  }
}
