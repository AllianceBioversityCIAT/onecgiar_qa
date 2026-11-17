import { QaStatus, WorklistReadOnlyReason, WorklistRow, WorklistStep, WorklistTimeline } from '../../../core/api/assessment.models';
import { QaSelectOption } from '../../../ui';
import { ResultRowVm } from './results-table';

/** FR-5 labels, as the contract spells them (§ 3.1). The server also sends them in `/worklist/options`. */
export const STATUS_LABELS: Readonly<Record<QaStatus, string>> = {
  pending: 'Pending',
  returned_to_program: 'Returned to program',
  clarification_requested: 'Clarification requested',
  pending_tpb_review: 'Pending for TPB review',
  pending_ppu: 'Pending PPU',
  unresolved: 'Unresolved',
  quality_assessed: 'Quality Assessed',
  auto_validated: 'Auto-validated',
};

/** Pill colors, existing status tokens only. */
export const STATUS_CLASSES: Readonly<Record<QaStatus, string>> = {
  pending: 'bg-(--surface-3) text-(--text-muted)',
  returned_to_program: 'bg-(--st-pending-bg) text-(--st-pending-fg)',
  clarification_requested: 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  pending_tpb_review: 'bg-(--st-qa-bg) text-(--st-qa-fg)',
  pending_ppu: 'bg-(--st-qa-bg) text-(--st-qa-fg)',
  unresolved: 'bg-(--st-rejected-bg) text-(--st-rejected-fg)',
  quality_assessed: 'bg-(--st-approved-bg) text-(--st-approved-fg)',
  auto_validated: 'bg-(--surface-3) text-(--text-4)',
};

/** Shown when the assessor has no nickname (FR-6). */
export const NO_NICKNAME = '—';

/** API row → table row. Program code always; "· nickname" once someone assessed it. */
export function toRowVm(row: WorklistRow): ResultRowVm {
  const assessor = row.assessedBy ? ` · ${row.assessedBy.nickname ?? NO_NICKNAME}` : '';
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

/** Timeline picker: the official one first ("Main batch"), then the additional ones; the tag is the caller's step state. */
export function timelineOptions(timelines: readonly WorklistTimeline[]): readonly QaSelectOption[] {
  return [...timelines]
    .sort((a, b) => Number(a.kind !== 'official') - Number(b.kind !== 'official'))
    .map((t) => ({
      value: String(t.id),
      label: t.name,
      group: t.kind === 'official' ? 'Main batch' : 'Complementary batches',
      tag: t.step ? STEP_STATE[t.step.state] : undefined,
    }));
}

/**
 * Why the worklist is read only, from what the timelines answer already says (the page answer only has
 * `writable`). Same words as the rows' `readOnlyReason` (§ 3.2). `null` = the caller can write.
 */
export function readOnlyReasonOf(timeline: WorklistTimeline | null, writable: boolean): WorklistReadOnlyReason | null {
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
  }
}
