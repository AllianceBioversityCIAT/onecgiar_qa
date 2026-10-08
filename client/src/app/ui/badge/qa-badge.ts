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
const TONES: Record<QaBadgeStatus, string> = {
  pending: 'bg-(--surface-3) text-(--text-muted)',
  'in-review': 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  awaiting: 'bg-(--st-editing-bg) text-(--st-editing-fg)',
  answered: 'bg-(--st-submitted-bg) text-(--st-submitted-fg)',
  assessed: 'bg-(--st-approved-bg) text-(--st-approved-fg)',
  approved: 'bg-(--st-approved-bg) text-(--st-approved-fg)',
  rejected: 'bg-(--st-rejected-bg) text-(--st-rejected-fg)',
  editing: 'bg-(--st-editing-bg) text-(--st-editing-fg)',
  submitted: 'bg-(--st-submitted-bg) text-(--st-submitted-fg)',
  indigo: 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  qa: 'bg-(--st-qa-bg) text-(--st-qa-fg)',
  neutral: 'bg-(--surface-3) text-(--text-4)',
};

/**
 * Status pill. `size="md"` = table status (10px/3px padding), `size="sm"` = chips inside pickers ("Live").
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
      `inline-flex flex-none items-center gap-[5px] rounded-full font-semibold whitespace-nowrap text-(length:--fs-11) ${
        this.size() === 'sm' ? 'px-2 py-0.5' : 'px-[10px] py-[3px]'
      } ${TONES[this.status()]}`,
  );
}
