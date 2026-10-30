import { RESULTS, SINGLE_CHECK_TYPES, TIMELINES, qaStage, type QaStage, type ResultStatus } from '../results/results.mock';
import type { DayGroup, Notification, NotificationTarget, SentencePart } from './notifications.model';

// Mock notifications for the QA Admin: only the ones María Julia asked for (meeting, 2026-10-27). A step finished for a
// batch (assessors, lead assessor, third-party broker), and science programs that have not started or go too slowly.
// "Today" is 17 Jul 2026, the same mock day as the mockup.
// Every `total` is computed from the Results mock with the rules Results applies, so a sentence and the list it leads to
// cannot drift apart.
// TODO(api): the server returns these notifications, with `sentence`, `total` and `target` computed there.

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

const timelineName = (id: string): string => TIMELINES.find((t) => t.id === id)!.name;

/** Day, relative time and read state of one entry. */
type When = Pick<Notification, 'day' | 'when' | 'unread'>;
const at = (day: DayGroup, when: string, unread = false): When => ({ day, when, unread });

/** Fields every entry starts from. */
const base = { detail: null, program: null, step: null, action: null } as const;

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

/** Newest first, as the page lists them. */
export const NOTIFICATIONS: readonly Notification[] = [
  // Today
  stepCompleteEntry('n-01', 'assessors', 'jul', at('today', '20 minutes ago', true)),
  slowProgramEntry('n-04', 'SP12', 'kp', '3 days into Programs correct', at('today', '4 hours ago', true)),
  // Yesterday
  slowProgramEntry('n-07', 'SP05', 'kp', 'with 2 days left', at('yesterday', 'Yesterday')),
  // Earlier
  stepCompleteEntry('n-10', 'broker', 'sp03', at('earlier', '2 days ago')),
  stepCompleteEntry('n-12', 'lead', 'annual', at('earlier', '4 days ago')),
];
