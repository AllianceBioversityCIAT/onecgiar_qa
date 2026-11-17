import { Component, computed, input } from '@angular/core';
import { SpFieldLabels } from '../../core/api/sp.models';
import { valueLines } from './sp-format';

/** A reported value as plain text: one line, a list, or `member: value` lines. Never HTML. */
@Component({
  selector: 'qa-sp-field-value',
  host: { class: 'block min-w-0 text-(length:--fs-14) leading-[1.5] text-(--text-2)' },
  template: `
    @if (notApplicable()) {
      <span class="text-(--text-4) italic">Not applicable</span>
    } @else if (lines().length === 0) {
      <span class="text-(--text-4) italic">Not reported</span>
    } @else if (lines().length === 1 && !lines()[0].label) {
      <span class="break-words whitespace-pre-line">{{ lines()[0].text }}</span>
    } @else {
      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        @for (line of lines(); track $index) {
          <li class="break-words whitespace-pre-line">
            @if (line.label) {
              <span class="font-medium text-(--text-3)">{{ line.label }}: </span>
            }
            {{ line.text }}
          </li>
        }
      </ul>
    }
  `,
})
export class SpFieldValue {
  readonly value = input<unknown>(null);
  readonly labels = input<SpFieldLabels | null>(null);
  readonly notApplicable = input(false);

  protected readonly lines = computed(() => valueLines(this.value(), this.labels()));
}
