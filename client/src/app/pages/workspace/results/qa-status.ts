// @akili-spec assessment/step-1-assessment
import { QA_STATUS_LABELS, QaStatus } from '../../../core/api/assessment.models';

/** Pill colors of the 8 QA statuses (FR-5), from the existing status tokens. Shared by Results and Review. */
export const QA_STATUS_CLASSES: Readonly<Record<QaStatus, string>> = {
  pending: 'bg-(--surface-3) text-(--text-muted)',
  returned_to_program: 'bg-(--st-editing-bg) text-(--st-editing-fg)',
  clarification_requested: 'bg-(--st-submitted-bg) text-(--st-submitted-fg)',
  pending_tpb_review: 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  pending_ppu: 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  unresolved: 'bg-(--st-rejected-bg) text-(--st-rejected-fg)',
  quality_assessed: 'bg-(--st-approved-bg) text-(--st-approved-fg)',
  auto_validated: 'bg-(--surface-3) text-(--text-4)',
};

/** Label and pill class of a status; an unknown value (a newer server) shows as sent, in the neutral pill. */
export function qaStatusPill(status: string): { readonly label: string; readonly cls: string } {
  const known = Object.hasOwn(QA_STATUS_LABELS, status) ? (status as QaStatus) : null;
  return known
    ? { label: QA_STATUS_LABELS[known], cls: QA_STATUS_CLASSES[known] }
    : { label: status, cls: QA_STATUS_CLASSES.pending };
}
