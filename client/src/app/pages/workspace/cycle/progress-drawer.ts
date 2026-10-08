import { Component, input, model } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { QaDrawerImports, QaProgress } from '../../../ui';
import { PROGRAMS, PROGRAM_PROGRESS } from './cycle.mock';
import { formatNumber } from './cycle.logic';

export interface StepProgress {
  title: string;
  subtitle: string;
  pct: number;
  done: number;
  of: number;
}

/** "View progress" drawer of the running step: overall count and the per-program breakdown. */
@Component({
  selector: 'qa-cycle-progress-drawer',
  imports: [HlmButton, QaDrawerImports, QaProgress],
  template: `
    @let p = progress();
    <qa-drawer [(open)]="open" [title]="p.title" [subtitle]="p.subtitle" width="720px">
      @if (open()) {
        <div class="flex flex-col gap-1">
          <span class="font-(family-name:--qa-mono) text-(length:--fs-26) font-bold text-(--text) tabular-nums">{{ fmt(p.done) }} of {{ fmt(p.of) }}</span>
          <span class="text-(length:--fs-13) text-(--text-3)">reviewed in this step</span>
          <qa-progress [value]="p.pct" [max]="100" aria-label="Reviewed in this step" class="mt-2 h-2!" />
        </div>
        <h3 class="m-0 text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">By science program</h3>
        <!-- The mockup uses the same per-program sample rows for every step. -->
        <ul class="m-0 -mt-[14px] flex list-none flex-col p-0">
          @for (row of rows; track row.code; let last = $last) {
            <li class="grid min-h-14 grid-cols-[minmax(0,1fr)_100px] items-center gap-4" [class]="last ? '' : 'border-b border-(--surface-4)'">
              <div class="flex min-w-0 flex-col gap-1.5">
                <div class="flex min-w-0 items-baseline gap-[10px]"><span class="flex-none font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--text-2)">{{ row.code }}</span><span class="min-w-0 truncate text-(length:--fs-14) font-normal text-(--text)">{{ row.name }}</span></div>
                <qa-progress [value]="row.done" [max]="row.of" [attr.aria-label]="row.code + ' reviewed'" />
              </div>
              <span class="text-right font-(family-name:--qa-mono) text-(length:--fs-13) tabular-nums"><span class="font-semibold text-(--text)">{{ row.done }}</span><span class="text-(--text-4)"> of {{ row.of }}</span></span>
            </li>
          }
        </ul>
      }
      <div qaDrawerFooter class="contents">
        <!-- TODO(api): export the comments of this step (.xlsx). -->
        <button hlmBtn variant="ghost" type="button" class="h-9 rounded-[8px] border border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium text-(--text-2) hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:border-(--border) focus-visible:ring-0 focus-visible:shadow-(--focus-ring) dark:hover:bg-(--surface-2)">Export comments</button>
      </div>
    </qa-drawer>
  `,
})
export class ProgressDrawer {
  readonly open = model(false);
  readonly progress = input.required<StepProgress>();

  protected readonly fmt = formatNumber;
  protected readonly rows = PROGRAM_PROGRESS.map((r) => ({ ...r, name: PROGRAMS[r.code] ?? '' }));
}
