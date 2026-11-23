import {
  WorklistReadOnlyReason,
  WorklistRow,
  WorklistStep,
  WorklistTimeline,
} from '../../../core/api/assessment.models';
import { reviewerLabel } from '../../../core/api/acting-role';
import { formatDay, parseDay, splitMoment, zoneAt } from '../../../core/domain/rome-date';
import { QaSelectOption } from '../../../ui';
import { STATUS_CLASSES, STATUS_LABELS } from './qa-status';
import type { ResultRowVm } from './results-table';

export { STATUS_CLASSES, STATUS_LABELS };

/** Shown when the assessor has no nickname (FR-6). */
export const NO_NICKNAME = '—';

/** API row → table row. Program code always; "· nickname" once someone assessed it. */
export function toRowVm(row: WorklistRow): ResultRowVm {
  const assessor = row.assessedBy ? ` · ${reviewerLabel(row.assessedBy, NO_NICKNAME)}` : '';
  return {
    id: row.membershipId,
    code: String(row.resultCode),
    title: row.title ?? String(row.resultCode),
    meta: `${row.program.code}${assessor}`,
    type: row.resultType.label,
    comments: row.comments,
    updated: row.updated,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    statusClass: STATUS_CLASSES[row.status] ?? STATUS_CLASSES.pending,
  };
}

const STEP_STATE: Readonly<Record<WorklistStep['state'], string>> = {
  upcoming: 'Upcoming',
  in_progress: 'Open',
  closed: 'Closed',
};

/** `05 Nov 2026, 23:59 CET (Rome)` for a step moment; null when it is not a real `YYYY-MM-DDTHH:mm`. */
function stepMoment(text: string): string | null {
  const m = splitMoment(text);
  return m && parseDay(m.day) ? `${formatDay(m.day)}, ${m.time} ${zoneAt(m.day, m.time)} (Rome)` : null;
}

/**
 * Second line of a timeline option: where the caller's step stands and when, on the Rome clock (as wherever a
 * step moment shows). Without a readable moment it is the state alone; no date is invented.
 */
function stepNote(step: WorklistStep): string {
  const at = stepMoment(step.state === 'upcoming' ? step.opensAt : step.closesAt);
  if (!at) return STEP_STATE[step.state];
  if (step.state === 'upcoming') return `Opens ${at}`;
  return step.state === 'closed' ? `Closed ${at}` : `Open · closes ${at}`;
}

/**
 * Timeline picker: the official one first ("Main batch"), then the additional ones. The tag (next to the chosen
 * timeline) is the caller's step state; the second line of every option adds when that step closes or opens, so
 * a finished timeline is told apart before it is opened.
 */
export function timelineOptions(timelines: readonly WorklistTimeline[]): readonly QaSelectOption[] {
  return [...timelines]
    .sort((a, b) => Number(a.kind !== 'official') - Number(b.kind !== 'official'))
    .map((t) => ({
      value: String(t.id),
      label: t.name,
      group: t.kind === 'official' ? 'Main batch' : 'Complementary batches',
      description: t.step ? stepNote(t.step) : undefined,
      tag: t.step ? STEP_STATE[t.step.state] : undefined,
    }));
}

/**
 * Why the worklist is read only, from what the timelines answer already says (the page answer only has
 * `writable`). Same words as the rows' `readOnlyReason` (§ 3.2). `null` = the caller can write.
 */
export function readOnlyReasonOf(
  timeline: WorklistTimeline | null,
  writable: boolean,
): WorklistReadOnlyReason | null {
  if (writable || !timeline) return null;
  if (!timeline.roles.some((r) => r !== 'ADMIN')) return 'admin_read_only';
  if (!timeline.step) return 'no_step';
  if (timeline.step.state === 'upcoming') return 'step_upcoming';
  if (timeline.step.state === 'closed') return 'step_closed';
  return null;
}

/** Read-only banner text per reason. */
export function readOnlyText(reason: WorklistReadOnlyReason | null): string | null {
  switch (reason) {
    case null:
      return null;
    case 'admin_read_only':
      return 'You are viewing this timeline as an admin: results open read only.';
    case 'step_upcoming':
      return 'Your assessment step has not opened yet: results open read only until it does.';
    case 'step_closed':
      return 'Your assessment step has closed: results open read only.';
    case 'no_step':
      return 'This timeline has no step for your role: results open read only.';
    case 'auto_validated':
      return 'Auto-validated: this result is not assessed.';
  }
}
