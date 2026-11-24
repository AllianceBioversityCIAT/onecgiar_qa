import { Component, input } from '@angular/core';
import { LoadReturnedNotResubmitted } from '../../../core/api/loads.models';
import { formatNumber } from './cycle.logic';
import type { LoadDrawerNames } from './load-drawer';

let nextId = 0;

/**
 * Results this timeline returned to their program in round 1 that have not been submitted again, by program
 * and by result type (preview and summary of a sync). The parent shows it only when `total > 0`.
 */
@Component({
  selector: 'qa-cycle-load-returned',
  template: `
    <h3 class="m-0 mb-1 text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">
      Waiting for their program: <span class="font-(family-name:--qa-mono) tabular-nums">{{ fmt(returned().total) }}</span>
    </h3>
    <!-- Not the same number as the skip row: that one counts only what the Reporting Tool still lists (contract § 4). -->
    <p class="m-0 mb-2 text-(length:--fs-13) leading-[1.5] text-pretty text-(--text-3)">All results returned in round 1 and not submitted again yet, including any the program has taken back. They come back into this timeline once submitted again.</p>
    <div class="grid gap-4 sm:grid-cols-2 sm:gap-6">
      <div>
        <span [id]="uid + '-programs'" class="text-(length:--fs-12) font-medium text-(--text-4)">By science program</span>
        <ul class="m-0 flex list-none flex-col p-0" [attr.aria-labelledby]="uid + '-programs'">
          @for (row of returned().byProgram; track row.programId) {
            <li class="flex min-h-9 items-center justify-between gap-3 border-b border-(--surface-4)">
              <span class="min-w-0 truncate text-(length:--fs-13) text-(--text-2)">{{ names().program(row.programId, row.code) }}</span>
              <span class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--text-2) tabular-nums">{{ fmt(row.count) }}</span>
            </li>
          }
        </ul>
      </div>
      <div>
        <span [id]="uid + '-types'" class="text-(length:--fs-12) font-medium text-(--text-4)">By result type</span>
        <ul class="m-0 flex list-none flex-col p-0" [attr.aria-labelledby]="uid + '-types'">
          @for (row of returned().byResultType; track row.key) {
            <li class="flex min-h-9 items-center justify-between gap-3 border-b border-(--surface-4)">
              <span class="min-w-0 truncate text-(length:--fs-13) text-(--text-2)">{{ names().type(row.key) }}</span>
              <span class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--text-2) tabular-nums">{{ fmt(row.count) }}</span>
            </li>
          }
        </ul>
      </div>
    </div>
  `,
  host: { class: 'block' },
})
export class LoadReturned {
  readonly returned = input.required<LoadReturnedNotResubmitted>();
  readonly names = input.required<LoadDrawerNames>();

  protected readonly fmt = formatNumber;
  /** Unique per instance: the preview and the summary may both be in the page. */
  protected readonly uid = `cycle-returned-${++nextId}`;
}
