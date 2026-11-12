import { Component, input, output } from '@angular/core';
import { QaButtonImports } from '../../../ui';
import { CardAction, FieldActions } from './review-model';

/**
 * Button row of a field card. The buttons depend on the role (review-model.ts `roleActions`):
 * assessor Approve / Undo / Add comment · lead assessor Mark as highlight (Edit instruction, Remove highlight) ·
 * TPB Agreed with program / Required changes (with a note for the PPU; Edit note) · PPU Mark when done. Everyone can open the comments.
 */
@Component({
  selector: 'qa-review-card-actions',
  imports: [QaButtonImports],
  host: { class: 'flex flex-wrap items-center gap-2' },
  template: `
    @let a = actions();
    @if (a.approve) {
      <button hlmBtn qaBtn tone="primary" size="sm" type="button" [attr.aria-label]="'Approve ' + label()" (click)="act.emit('approve')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>Approve</button>
    }
    @if (a.highlight === 'mark') {
      <button hlmBtn qaBtn tone="primary" size="sm" type="button" aria-haspopup="dialog" (click)="act.emit('highlight')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" /></svg>Mark as highlight<span class="sr-only">: {{ label() }}</span></button>
    }
    @if (a.highlight === 'edit') {
      <button hlmBtn qaBtn tone="secondary" size="sm" type="button" aria-haspopup="dialog" (click)="act.emit('highlight')">Edit instruction<span class="sr-only"> for {{ label() }}</span></button>
      <button hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="act.emit('unhighlight')">Remove highlight<span class="sr-only"> from {{ label() }}</span></button>
    }
    @if (a.decide) {
      <button hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="act.emit('agree')">Agreed with program<span class="sr-only">: {{ label() }}</span></button>
      <button hlmBtn qaBtn tone="secondary" size="sm" type="button" aria-haspopup="dialog" (click)="act.emit('changes')">Required changes<span class="sr-only">: {{ label() }}</span></button>
    }
    @if (a.editNote) {
      <button hlmBtn qaBtn tone="secondary" size="sm" type="button" aria-haspopup="dialog" (click)="act.emit('edit-note')">Edit note<span class="sr-only"> for the PPU on {{ label() }}</span></button>
    }
    @if (a.markDone) {
      <button hlmBtn qaBtn tone="primary" size="sm" type="button" (click)="act.emit('done')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>Mark when done<span class="sr-only">: {{ label() }}</span></button>
    }
    @if (a.undo; as undo) {
      <button hlmBtn qaBtn tone="secondary" size="sm" type="button" [attr.aria-label]="undoLabel(undo) + label()" (click)="act.emit('undo')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></svg>Undo</button>
    }
    @if (a.secondary) {
      <button hlmBtn qaBtn tone="secondary" size="sm" type="button" aria-haspopup="dialog" (click)="act.emit('comment')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>{{ a.secondaryLabel }}@if (a.count > 0) {<span class="font-(family-name:--qa-mono) text-(length:--fs-12) font-bold text-(--accent) tabular-nums">{{ a.count }}</span>}<span class="sr-only"> for {{ label() }}</span></button>
    }
  `,
})
export class ReviewCardActions {
  readonly actions = input.required<FieldActions>();
  /** Field label, for accessible button names. */
  readonly label = input('');
  readonly act = output<CardAction>();

  protected undoLabel(kind: NonNullable<FieldActions['undo']>): string {
    if (kind === 'decision') return 'Undo decision on ';
    if (kind === 'done') return 'Undo done on ';
    return 'Undo approval of ';
  }
}
