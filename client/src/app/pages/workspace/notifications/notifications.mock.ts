import { QA_STAGE_LABELS, RESULTS, TIMELINES, qaStage, type QaStage, type ResultStatus } from '../results/results.mock';
import type { Notification, NotificationTarget } from './notifications.model';

// Mock notifications for the QA Admin, reproduced from the QA Platform mockup (Notifications.dc.html, frames 1a, 1c, 1d, 1e).
// "Today" is 17 Jul 2026, the same mock day as the mockup.
// Every `total` is computed from the Results mock with the rules Results applies, so a sentence and the list its action opens
// cannot drift apart; `delta` ("since yesterday") is authored: the Results mock has no dates.
// TODO(api): the server returns these notifications, with `total`, `delta` and `target` computed there.

interface ListFilter {
  /** A `TIMELINES` id; omitted for "all timelines". */
  readonly timelineId?: string;
  readonly stage?: QaStage;
  readonly program?: string;
  readonly status?: ResultStatus;
}

/** What Results lists for a filter: only results under assessment (with a QA stage), by timeline name, stage, program and status. */
function totalInResults(filter: ListFilter): number {
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

/** "Round 1 · Assessed by 2 assessors" → ["Round 1", "Assessed by 2 assessors"]; "Quality assessed" → ["Quality assessed"]. */
const labelParts = (stage: QaStage): readonly string[] => QA_STAGE_LABELS[stage].split(' · ');

/** Stage word and round of a two-part label, as the label writes them. */
function stageAndRound(stage: QaStage): { readonly stage: string; readonly round: string } {
  const [round, word] = labelParts(stage);
  return { round, stage: word };
}

const timelineName = (id: string): string => TIMELINES.find((t) => t.id === id)!.name;

/** The sentence's total and its target for one list filter. */
function listOf(filter: ListFilter): { readonly total: number; readonly target: NotificationTarget } {
  return { total: totalInResults(filter), target: listTarget(filter) };
}

// ---------- Grouped notifications ----------

/** Stage: one per assessed stage reached, per timeline, per day. */
function stageEntry(id: string, filter: ListFilter & { timelineId: string; stage: QaStage }, delta: number, when: Pick<Notification, 'day' | 'time' | 'unread'>): Notification {
  const { total, target } = listOf(filter);
  const { stage, round } = stageAndRound(filter.stage);
  return {
    id,
    type: 'Stage',
    subject: `${num(total)} results`,
    text: `reached ${stage} in ${round}. ${num(delta)} since yesterday.`,
    timelineId: filter.timelineId,
    ...when,
    target,
    total,
    delta,
    action: 'View results',
  };
}

function qualityAssessedEntry(id: string, timelineId: string, delta: number, when: Pick<Notification, 'day' | 'time' | 'unread'>): Notification {
  const { total, target } = listOf({ timelineId, stage: 'quality-assessed' });
  return {
    id,
    type: 'Quality assessed',
    subject: `${num(total)} results`,
    text: `are ${QA_STAGE_LABELS['quality-assessed']}. ${num(delta)} since yesterday.`,
    timelineId,
    ...when,
    target,
    total,
    delta,
    action: 'View results',
  };
}

function programResponseEntry(id: string, program: string, when: Pick<Notification, 'day' | 'time' | 'unread'>): Notification {
  const { total, target } = listOf({ program, status: 'Answered' });
  return {
    id,
    type: 'Program response',
    subject: program,
    text: `has answered ${num(total)} returned results.`,
    timelineId: 'all',
    ...when,
    target,
    total,
    delta: null,
    action: 'View results',
  };
}

function waitingEntry(id: string, when: Pick<Notification, 'day' | 'time' | 'unread'>): Notification {
  const { total, target } = listOf({ status: 'Awaiting response' });
  return {
    id,
    type: 'Waiting',
    subject: `${num(total)} returned results`,
    text: 'are waiting on a program.',
    timelineId: 'all',
    ...when,
    target,
    total,
    delta: null,
    action: 'View results',
  };
}

function atRiskEntry(id: string, timelineId: string, step: number, daysLeft: number, stage: QaStage, when: Pick<Notification, 'day' | 'time' | 'unread'>): Notification {
  const { total, target } = listOf({ timelineId, stage });
  const words = stageAndRound(stage);
  return {
    id,
    type: 'At risk',
    subject: `Step ${step} of ${timelineName(timelineId)}`,
    text: `closes in ${daysLeft} days with ${num(total)} results still ${words.stage} in ${words.round}.`,
    timelineId,
    ...when,
    target,
    total,
    delta: null,
    action: 'View results',
  };
}

function loadEntry(id: string, timelineId: string, when: Pick<Notification, 'day' | 'time' | 'unread'>): Notification {
  const { total, target } = listOf({ timelineId });
  return {
    id,
    type: 'Load',
    subject: timelineName(timelineId),
    text: `now has ${num(total)} results in QA. ${num(total)} loaded today.`,
    timelineId,
    ...when,
    target,
    total,
    // A first load: everything in the timeline arrived today.
    delta: total,
    action: 'View results',
  };
}

// ---------- Single-result notifications ----------
// Codes exist in review.mock.ts and are not Automatic (QA-2026-0806 and QA-2026-0803 are): Review would not show a result's flow for them.

function singleEntry(
  id: string,
  type: 'Escalation' | 'Third-party broker' | 'PPU',
  code: string,
  text: string,
  timelineId: string,
  when: Pick<Notification, 'day' | 'time' | 'unread'>,
): Notification {
  return { id, type, subject: code, text, timelineId, ...when, target: { path: `/results/${code}` }, total: null, delta: null, action: 'View result' };
}

/** Newest first, as the panel and the page list them. */
export const NOTIFICATIONS: readonly Notification[] = [
  // Today
  stageEntry('n-01', { timelineId: 'annual', stage: 'r1-two' }, 18, { day: 'today', time: '11:20', unread: true }),
  singleEntry('n-02', 'Escalation', 'QA-2026-0841', 'was escalated to the third-party broker.', 'jul', { day: 'today', time: '10:42', unread: true }),
  programResponseEntry('n-03', 'SP09', { day: 'today', time: '09:15', unread: true }),
  loadEntry('n-04', 'jul', { day: 'today', time: '08:05', unread: false }),
  // Yesterday
  atRiskEntry('n-05', 'annual', 4, 6, 'r2-pending', { day: 'yesterday', time: '16:30', unread: true }),
  qualityAssessedEntry('n-06', 'annual', 12, { day: 'yesterday', time: '14:10', unread: false }),
  stageEntry('n-07', { timelineId: 'jul', stage: 'r1-one' }, 7, { day: 'yesterday', time: '11:45', unread: false }),
  singleEntry('n-08', 'PPU', 'QA-2026-0824', 'was marked Done by PPU.', 'jul', { day: 'yesterday', time: '09:30', unread: false }),
  // Earlier
  waitingEntry('n-09', { day: 'earlier', time: '15 Jul', unread: false }),
  singleEntry('n-10', 'Third-party broker', 'QA-2026-0830', 'moves to PPU.', 'annual', { day: 'earlier', time: '14 Jul', unread: false }),
  stageEntry('n-11', { timelineId: 'annual', stage: 'r2-assessed' }, 9, { day: 'earlier', time: '13 Jul', unread: false }),
];
