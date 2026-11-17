import { QaStatus } from '../../../core/api/assessment.models';

/*
 * The 8 QA statuses as text and pill, shared by Results and Review (one home, so both screens always agree).
 */

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

/** Label and pill class of a status; an unknown value (a newer server) shows as sent, in the neutral pill. */
export function qaStatusPill(status: string): { readonly label: string; readonly cls: string } {
  const known = Object.hasOwn(STATUS_LABELS, status) ? (status as QaStatus) : null;
  return known
    ? { label: STATUS_LABELS[known], cls: STATUS_CLASSES[known] }
    : { label: status, cls: STATUS_CLASSES.pending };
}
