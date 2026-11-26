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

/**
 * Badge classes: one neutral badge for every status, the colour only in its dot (qa-dot, styles.css), so a table full
 * of statuses stays calm and the colour still tells them apart (direction A, Juanpa 2026-11-25).
 */
const BADGE = 'qa-dot gap-1.5 bg-(--surface-5) text-(--text-2)';
export const STATUS_CLASSES: Readonly<Record<QaStatus, string>> = {
  pending: `${BADGE} [--qa-dot:var(--text-muted)]`,
  returned_to_program: `${BADGE} [--qa-dot:var(--warning)]`,
  clarification_requested: `${BADGE} [--qa-dot:var(--st-indigo-fg)]`,
  pending_tpb_review: `${BADGE} [--qa-dot:var(--st-qa-fg)]`,
  pending_ppu: `${BADGE} [--qa-dot:var(--st-qa-fg)]`,
  unresolved: `${BADGE} [--qa-dot:var(--danger)]`,
  quality_assessed: `${BADGE} [--qa-dot:var(--success)]`,
  auto_validated: `${BADGE} text-(--text-4) [--qa-dot:var(--border-strong)]`,
};

/** Label and pill class of a status; an unknown value (a newer server) shows as sent, in the neutral pill. */
export function qaStatusPill(status: string): { readonly label: string; readonly cls: string } {
  const known = Object.hasOwn(STATUS_LABELS, status) ? (status as QaStatus) : null;
  return known
    ? { label: STATUS_LABELS[known], cls: STATUS_CLASSES[known] }
    : { label: status, cls: STATUS_CLASSES.pending };
}
