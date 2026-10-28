import { QA_STAGE_LABELS, RESULTS, SINGLE_CHECK_TYPES, TIMELINES, qaStage, type QaStage, type ResultStatus } from '../results/results.mock';
import type { DayGroup, Notification, NotificationTarget, SentencePart } from './notifications.model';

// Mock notifications for the QA Admin, after the PRMS notifications pattern adapted to QA.
// "Today" is 17 Jul 2026, the same mock day as the mockup.
// Every `total` is computed from the Results mock with the rules Results applies, so a sentence and the list it leads to
// cannot drift apart; `delta` ("since yesterday") is authored: the Results mock has no dates.
// TODO(api): the server returns these notifications, with `sentence`, `total`, `delta` and `target` computed there.

interface ListFilter {
  /** A `TIMELINES` id; omitted for "all timelines". */
  readonly timelineId?: string;
  readonly stage?: QaStage;
  readonly program?: string;
  readonly status?: ResultStatus;
}

/** What Results lists for a filter: only results under assessment (with a QA stage), by timeline name, stage, program and status. */
export function totalInResults(filter: ListFilter): number {
  const timeline = TIMELINES.find((t) => t.id === filter.timelineId);
  return RESULTS.filter((r) => {
    const stage = qaStage(r);
    return (
      stage !== null &&
      (!timeline || r.batch === timeline.name) &&
      (!filter.stage || stage === filter.stage) &&
      (!filter.program || r.program === filter.program) &&
      (!filter.status || r.status === filter.status)
    );
  }).length;
}

/** The Results URL parameters of a filter. */
function listTarget(filter: ListFilter): NotificationTarget {
  const queryParams: Record<string, string> = {};
  if (filter.timelineId) queryParams['timeline'] = filter.timelineId;
  if (filter.stage) queryParams['stage'] = filter.stage;
  if (filter.program) queryParams['program'] = filter.program;
  if (filter.status) queryParams['status'] = filter.status;
  return { path: '/results', queryParams };
}

const num = (n: number): string => n.toLocaleString('en-US');

/** "**SP09** has answered…" → parts; `**` marks the bold subjects. */
function sentence(text: string): readonly SentencePart[] {
  return text
    .split('**')
    .map((t, i) => (i % 2 ? { text: t, strong: true } : { text: t }))
    .filter((p) => p.text !== '');
}

/** "Round 1 · Assessed by 2 assessors" → stage "Assessed by 2 assessors", round "Round 1". */
function stageAndRound(stage: QaStage): { readonly stage: string; readonly round: string } {
  const [round, word] = QA_STAGE_LABELS[stage].split(' · ');
  return { round, stage: word };
}

const timelineName = (id: string): string => TIMELINES.find((t) => t.id === id)!.name;

/** Day, relative time and read state of one entry. */
type When = Pick<Notification, 'day' | 'when' | 'unread'>;
const at = (day: DayGroup, when: string, unread = false): When => ({ day, when, unread });

/** Fields every entry starts from. */
const base = { detail: null, program: null, step: null, delta: null, action: null } as const;

// ---------- Needs your action ----------

/** Who finished a step, what their results are now, and where they can go next. */
const HAND_OFFS = {
  assessors: { who: 'Assessors', done: 'assessed', next: 'the science programs', nextStep: 'Programs correct' },
  lead: { who: 'Lead assessor', done: 'assessed in Round 2', next: 'the third-party broker', nextStep: 'Third-party broker' },
  broker: { who: 'Third-party broker', done: 'reviewed', next: 'PPU', nextStep: 'PPU' },
} as const;

/** "Assessed" in round 1 means 2 assessors, or 1 for the single-check types. */
const ASSESSED_RULE = `Assessed by 2 assessors, or by 1 for ${SINGLE_CHECK_TYPES.join(' and ')}.`;

/** A step finished for a whole timeline: the QA Admin opens the next one in Cycle. `total` is every result of the timeline. */
function stepCompleteEntry(id: string, handOff: keyof typeof HAND_OFFS, timelineId: string, when: When): Notification {
  const h = HAND_OFFS[handOff];
  const total = totalInResults({ timelineId });
  return {
    ...base,
    id,
    type: 'Step complete',
    sentence: sentence(`**${h.who}** finished **${timelineName(timelineId)}**: all **${num(total)}** results are ${h.done}. They can go to ${h.next}.`),
    detail: handOff === 'assessors' ? ASSESSED_RULE : null,
    timelineId,
    step: `Next: ${h.nextStep}`,
    ...when,
    target: { path: '/cycle' },
    total,
    action: 'Open next step',
  };
}

/**
 * A science program that has not started, or goes too slowly, replying in the programs' step. The bold count is what the
 * button opens: its returned results still awaiting a response in that timeline.
 */
function slowProgramEntry(id: string, program: string, timelineId: string, phase: string, when: When): Notification {
  const filter = { timelineId, program, status: 'Awaiting response' } as const;
  const waiting = totalInResults(filter);
  const answered = totalInResults({ ...filter, status: 'Answered' });
  const returned = waiting + answered;
  const tl = timelineName(timelineId);
  const text =
    answered === 0
      ? `**${program}** has not replied to any of its **${num(waiting)}** returned results in **${tl}**, ${phase}.`
      : `**${program}** has replied to ${num(answered)} of its ${num(returned)} returned results in **${tl}** (${Math.round((answered / returned) * 100)}%): **${num(waiting)}** still wait for a reply, ${phase}.`;
  return {
    ...base,
    id,
    type: 'Slow program',
    sentence: sentence(text),
    timelineId,
    program,
    step: 'Programs correct',
    ...when,
    target: listTarget(filter),
    total: waiting,
    action: 'View results',
  };
}

function atRiskEntry(id: string, timelineId: string, daysLeft: number, stage: QaStage, when: When): Notification {
  const filter = { timelineId, stage };
  const total = totalInResults(filter);
  const words = stageAndRound(stage);
  return {
    ...base,
    id,
    type: 'At risk',
    sentence: sentence(`**Third-party broker** of **${timelineName(timelineId)}** closes in ${daysLeft} days with **${num(total)}** results still ${words.stage} in ${words.round}.`),
    timelineId,
    step: 'Third-party broker',
    ...when,
    target: listTarget(filter),
    total,
    action: 'View results',
  };
}

// ---------- For your information ----------

/** Stage: one per assessed stage reached, per timeline, per day. */
function stageEntry(id: string, timelineId: string, stage: QaStage, delta: number, when: When): Notification {
  const filter = { timelineId, stage };
  const total = totalInResults(filter);
  const words = stageAndRound(stage);
  return {
    ...base,
    id,
    type: 'Stage',
    sentence: sentence(`**${num(total)} results** reached ${words.stage} in ${words.round}. ${num(delta)} since yesterday.`),
    timelineId,
    ...when,
    target: listTarget(filter),
    total,
    delta,
  };
}

function qualityAssessedEntry(id: string, timelineId: string, delta: number, when: When): Notification {
  const filter = { timelineId, stage: 'quality-assessed' } as const;
  const total = totalInResults(filter);
  return {
    ...base,
    id,
    type: 'Quality assessed',
    sentence: sentence(`**${num(total)} results** are ${QA_STAGE_LABELS['quality-assessed']}. ${num(delta)} since yesterday.`),
    timelineId,
    ...when,
    target: listTarget(filter),
    total,
    delta,
  };
}

function programResponseEntry(id: string, program: string, when: When): Notification {
  const filter = { program, status: 'Answered' } as const;
  const total = totalInResults(filter);
  return {
    ...base,
    id,
    type: 'Program response',
    sentence: sentence(`**${program}** has answered **${num(total)}** returned results.`),
    timelineId: 'all',
    program,
    ...when,
    target: listTarget(filter),
    total,
  };
}

function loadEntry(id: string, timelineId: string, when: When): Notification {
  const filter = { timelineId };
  const total = totalInResults(filter);
  return {
    ...base,
    id,
    type: 'Load',
    sentence: sentence(`**${timelineName(timelineId)}** was loaded with **${num(total)}** results for QA.`),
    timelineId,
    ...when,
    target: listTarget(filter),
    total,
    // A first load: everything in the timeline is new.
    delta: total,
  };
}

// Codes exist in review.mock.ts and are not Automatic (QA-2026-0806 and QA-2026-0803 are): Review would not show a result's flow for them.
function escalationEntry(id: string, code: string, when: When): Notification {
  const result = RESULTS.find((r) => r.code === code)!;
  return {
    ...base,
    id,
    type: 'Escalation',
    sentence: sentence(`**${code}** was escalated to the third-party broker.`),
    timelineId: TIMELINES.find((t) => t.name === result.batch)!.id,
    program: result.program,
    ...when,
    target: { path: `/results/${code}` },
    total: null,
  };
}

/** Newest first, as the page lists them. */
export const NOTIFICATIONS: readonly Notification[] = [
  // Today
  stepCompleteEntry('n-01', 'assessors', 'jul', at('today', '20 minutes ago', true)),
  escalationEntry('n-02', 'QA-2026-0841', at('today', '1 hour ago', true)),
  stageEntry('n-03', 'annual', 'r1-two', 18, at('today', '2 hours ago')),
  slowProgramEntry('n-04', 'SP12', 'kp', '3 days into Programs correct', at('today', '4 hours ago', true)),
  programResponseEntry('n-05', 'SP09', at('today', '6 hours ago')),
  // Yesterday
  atRiskEntry('n-06', 'annual', 6, 'r2-pending', at('yesterday', 'Yesterday', true)),
  slowProgramEntry('n-07', 'SP05', 'kp', 'with 2 days left', at('yesterday', 'Yesterday')),
  qualityAssessedEntry('n-08', 'annual', 12, at('yesterday', 'Yesterday')),
  stageEntry('n-09', 'jul', 'r1-one', 7, at('yesterday', 'Yesterday')),
  // Earlier
  stepCompleteEntry('n-10', 'broker', 'sp03', at('earlier', '2 days ago')),
  escalationEntry('n-11', 'QA-2026-0830', at('earlier', '3 days ago')),
  stepCompleteEntry('n-12', 'lead', 'annual', at('earlier', '4 days ago')),
  loadEntry('n-13', 'kp', at('earlier', '5 days ago')),
  stageEntry('n-14', 'annual', 'r2-assessed', 9, at('earlier', '6 days ago')),
];
