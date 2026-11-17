import type { QaBadgeStatus } from '../../ui';
import type { QaStatus, StepState } from '../../core/api/assessment.models';
import { formatMoment, nowInRome, splitMoment } from '../../core/domain/rome-date';
import type { SpFieldLabels, SpResponseKind, SpStep } from '../../core/api/sp.models';

/** QA status labels of the SP view (P2-3911 AC5). */
export const SP_STATUS_LABEL: Readonly<Record<QaStatus, string>> = {
  pending: 'Pending',
  returned_to_program: 'Returned to program',
  clarification_requested: 'Clarification requested',
  pending_tpb_review: 'Pending for TPB review',
  pending_ppu: 'Pending PPU',
  unresolved: 'Unresolved',
  quality_assessed: 'Quality Assessed',
  auto_validated: 'Auto-validated',
};

const STATUS_TONE: Readonly<Record<QaStatus, QaBadgeStatus>> = {
  pending: 'pending',
  returned_to_program: 'editing',
  clarification_requested: 'awaiting',
  pending_tpb_review: 'indigo',
  pending_ppu: 'indigo',
  unresolved: 'rejected',
  quality_assessed: 'approved',
  auto_validated: 'neutral',
};

export function statusLabel(status: string | null): string {
  return status && status in SP_STATUS_LABEL ? SP_STATUS_LABEL[status as QaStatus] : 'Not started';
}

export function statusTone(status: string | null): QaBadgeStatus {
  return status && status in STATUS_TONE ? STATUS_TONE[status as QaStatus] : 'neutral';
}

export const STEP_STATE_LABEL: Readonly<Record<StepState, string>> = {
  upcoming: 'Upcoming',
  in_progress: 'Open for responses',
  closed: 'Closed',
};

export function stepTone(state: StepState): QaBadgeStatus {
  return state === 'in_progress' ? 'approved' : state === 'upcoming' ? 'submitted' : 'neutral';
}

/** `21 Nov 2026, 09:00 – 30 Nov 2026, 17:30 (Rome time)`. */
export function stepWindow(step: SpStep): string {
  return `${formatMoment(step.opensAt)} – ${formatMoment(step.closesAt)} (Rome time)`;
}

/**
 * A moment the API sends as an instant (`2026-11-10T09:00:00.000Z`) shown on the Rome clock, like the
 * rest of the SP view: `10 Nov 2026, 10:00`. A Rome wall-clock moment (`2026-11-10T10:00`) is formatted
 * as is; anything unreadable is returned as given.
 */
export function romeMoment(text: string): string {
  if (splitMoment(text)) return formatMoment(text);
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? text : formatMoment(nowInRome(at));
}

/** Choices of the response form, in the order the form shows them. */
export const RESPONSE_OPTIONS: readonly { readonly kind: SpResponseKind; readonly label: string; readonly hint: string }[] = [
  { kind: 'accept', label: 'Accept', hint: 'You agree and will correct it in Reporting.' },
  { kind: 'accept_with_comment', label: 'Accept with comment', hint: 'You agree and add a note.' },
  { kind: 'disagree', label: 'Disagree', hint: 'Explain why the value is right.' },
  { kind: 'request_clarification', label: 'Request clarification', hint: 'Ask the assessor what they mean.' },
];

/** How a saved response reads. */
export const RESPONSE_KIND_LABEL: Readonly<Record<SpResponseKind, string>> = {
  accept: 'Accepted',
  accept_with_comment: 'Accepted with comment',
  disagree: 'Disagreed',
  request_clarification: 'Clarification requested',
};

export function responseKindLabel(kind: string): string {
  return kind in RESPONSE_KIND_LABEL ? RESPONSE_KIND_LABEL[kind as SpResponseKind] : kind;
}

/** Text length as the server counts it (code points, so an emoji is one). */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/** One line of a rendered value: `label` is set for an object's member. */
export interface ValueLine {
  readonly label: string | null;
  readonly text: string;
}

/**
 * A reported value as plain lines: ids get their catalog label when the field carries one, lists
 * become one line per item, an object one line per member. Never HTML.
 */
export function valueLines(value: unknown, labels: SpFieldLabels | null | undefined): readonly ValueLine[] {
  if (isEmpty(value)) return [];
  if (Array.isArray(value)) {
    return value.filter((v) => !isEmpty(v)).flatMap((item) => (isPlainObject(item) ? [{ label: null, text: objectText(item, labels) }] : [{ label: null, text: scalarText(item, labels) }]));
  }
  if (isPlainObject(value)) {
    return Object.entries(value)
      .filter(([, v]) => !isEmpty(v))
      .map(([key, v]) => ({ label: humanize(key), text: Array.isArray(v) || isPlainObject(v) ? nestedText(v, labels) : scalarText(v, labels) }));
  }
  return [{ label: null, text: scalarText(value, labels) }];
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarText(value: unknown, labels: SpFieldLabels | null | undefined): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') {
    const label = lookup(String(value), labels);
    return label ?? String(value);
  }
  return nestedText(value, labels);
}

function objectText(value: Record<string, unknown>, labels: SpFieldLabels | null | undefined): string {
  return Object.entries(value)
    .filter(([, v]) => !isEmpty(v))
    .map(([k, v]) => `${humanize(k)}: ${Array.isArray(v) || isPlainObject(v) ? nestedText(v, labels) : scalarText(v, labels)}`)
    .join(' · ');
}

function nestedText(value: unknown, labels: SpFieldLabels | null | undefined): string {
  if (Array.isArray(value)) return value.map((v) => (isPlainObject(v) ? objectText(v, labels) : scalarText(v, labels))).join(', ');
  if (isPlainObject(value)) return objectText(value, labels);
  return String(value);
}

/** The first catalog that knows this id. */
function lookup(id: string, labels: SpFieldLabels | null | undefined): string | null {
  if (!labels) return null;
  for (const list of Object.values(labels)) {
    const label = list[id];
    if (label) return label;
  }
  return null;
}

/** `result_type_id` → `Result type id`. */
function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** Same value now as when the comment was written (to hide a repeated "value when commented"). */
export function sameValue(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
