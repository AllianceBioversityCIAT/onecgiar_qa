import { Component, computed, input } from '@angular/core';

export type QaBadgeStatus =
  | 'pending'
  | 'in-review'
  | 'awaiting'
  | 'answered'
  | 'assessed'
  | 'approved'
  | 'rejected'
  | 'editing'
  | 'submitted'
  | 'indigo'
  | 'qa'
  | 'neutral';

export type QaBadgeSize = 'md' | 'sm';

/**
 * Mapping taken from the mockup's STATUS table (QA Platform.dc.html) and the static views:
 * Pending → surface-3/text-muted · In review → indigo · Awaiting response → editing (amber) ·
 * Answered → submitted (blue) · Quality assessed → approved (green). `neutral` = mockup "Automatic".
 */
/**
 * One neutral badge for every status, the colour only in its dot (direction A, Juanpa 2026-11-25): a table full of
 * statuses stays calm and the dot still tells them apart. `neutral` has no dot (a plain tag such as "Official").
 */
const DOT = 'qa-dot gap-1.5 bg-(--surface-5) text-(--text-2)';
const TONES: Record<QaBadgeStatus, string> = {
  pending: `${DOT} [--qa-dot:var(--text-muted)]`,
  'in-review': `${DOT} [--qa-dot:var(--st-indigo-fg)]`,
  awaiting: `${DOT} [--qa-dot:var(--warning)]`,
  answered: `${DOT} [--qa-dot:var(--st-submitted-fg)]`,
  assessed: `${DOT} [--qa-dot:var(--success)]`,
  approved: `${DOT} [--qa-dot:var(--success)]`,
  rejected: `${DOT} [--qa-dot:var(--danger)]`,
  editing: `${DOT} [--qa-dot:var(--warning)]`,
  submitted: `${DOT} [--qa-dot:var(--st-submitted-fg)]`,
  indigo: `${DOT} [--qa-dot:var(--st-indigo-fg)]`,
  qa: `${DOT} [--qa-dot:var(--st-qa-fg)]`,
  neutral: 'bg-(--surface-5) text-(--text-3)',
};

/**
 * Status badge (neutral, coloured dot). `size="md"` = table status (10px/3px padding), `size="sm"` = chips inside pickers ("Live").
 *
 * <qa-badge status="awaiting">Awaiting response</qa-badge>
 */
@Component({
  selector: 'qa-badge',
  host: { '[class]': 'classes()' },
  template: `<ng-content />`,
})
export class QaBadge {
  readonly status = input<QaBadgeStatus>('neutral');
  readonly size = input<QaBadgeSize>('md');

  protected readonly classes = computed(
    () =>
      `inline-flex flex-none items-center gap-[5px] rounded-md font-medium whitespace-nowrap text-(length:--fs-12) ${
        this.size() === 'sm' ? 'px-2 py-0.5' : 'px-[10px] py-[3px]'
      } ${TONES[this.status()]}`,
  );
}
