import { Component, input, output } from '@angular/core';
import { FieldSectionVm } from './fields-config';
import { FieldsRow } from './fields-row';
import { FieldState } from './fields.mock';

export interface FieldRowEvent<T> {
  readonly id: string;
  readonly value: T;
}

/**
 * One collapsible section of the Fields matrix (sticky header + rows).
 * Host is display:contents so the sticky header shares the matrix as containing block.
 */
@Component({
  selector: 'qa-fields-section',
  imports: [FieldsRow],
  host: { class: 'contents' },
  template: `
    @let s = section();
    <button
      type="button"
      [attr.aria-expanded]="s.open"
      (click)="toggle.emit()"
      class="sticky z-11 flex min-h-10 w-full cursor-pointer items-center gap-2.5 border-0 border-b border-solid border-(--surface-4) bg-(--surface-2) px-5 text-left select-none focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
      [class]="compact() ? 'top-0' : 'top-[40px]'"
    >
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none transition-transform duration-[140ms]" [class.-rotate-90]="!s.open"><path d="M6 9l6 6 6-6"></path></svg>
      <span class="text-(length:--fs-13) font-semibold tracking-[0.06em] text-(--text-3) uppercase">{{ s.name }}</span>
      <span class="ml-auto text-(length:--fs-12) font-normal text-(--text-muted)"><span class="font-(family-name:--qa-mono) font-semibold text-(--text-3) tabular-nums">{{ s.assessed }}</span> of <span class="font-(family-name:--qa-mono) font-semibold text-(--text-3) tabular-nums">{{ s.total }}</span> assessed</span>
    </button>
    @if (s.open) {
      @for (row of s.rows; track row.id) {
        <qa-fields-row
          [row]="row"
          [compact]="compact()"
          (stateChange)="stateChange.emit({ id: row.id, value: $event })"
          (coreChange)="coreChange.emit({ id: row.id, value: $event })"
          (aiChange)="aiChange.emit({ id: row.id, value: $event })"
          (reset)="reset.emit(row.id)"
        />
      }
    }
  `,
})
export class FieldsSection {
  readonly section = input.required<FieldSectionVm>();
  readonly compact = input(false);

  readonly toggle = output<void>();
  readonly stateChange = output<FieldRowEvent<FieldState>>();
  readonly coreChange = output<FieldRowEvent<boolean>>();
  readonly aiChange = output<FieldRowEvent<boolean>>();
  readonly reset = output<string>();
}
