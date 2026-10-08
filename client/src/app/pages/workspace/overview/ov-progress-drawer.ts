import { Component, input, model } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { QaDrawerImports, QaProgress } from '../../../ui';
import { fmt } from './overview-calc';
import { PROGRAMS, PROGRAM_PROGRESS } from './overview.mock';

export interface ProgressVm {
  readonly title: string;
  readonly subtitle: string;
  readonly pct: number;
  readonly done: number;
  readonly of: number;
}

/** "View progress": the open step's progress, broken down by science program. */
@Component({
  selector: 'qa-ov-progress-drawer',
  imports: [HlmButton, QaDrawerImports, QaProgress],
  host: { class: 'contents' },
  template: `
    <qa-drawer [(open)]="open" [title]="data()?.title ?? 'Step progress'" [subtitle]="data()?.subtitle ?? ''" width="720px">
      @if (open() && data(); as d) {
        <div class="flex flex-col gap-1">
          <span class="font-(family-name:--qa-mono) text-(length:--fs-26) font-bold tabular-nums text-(--text)">{{ n(d.done) }} of {{ n(d.of) }}</span>
          <span class="text-(length:--fs-13) text-(--text-3)">reviewed in this step</span>
          <div class="mt-2 h-2 overflow-hidden rounded-full bg-(--surface-4)" role="progressbar" aria-label="Reviewed in this step" [attr.aria-valuenow]="d.pct" aria-valuemin="0" aria-valuemax="100">
            <div class="h-full rounded-full bg-(--primary)" [style.width.%]="d.pct"></div>
          </div>
        </div>

        <h4 class="m-0 text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">By science program</h4>

        <ul class="-mt-[14px] mb-0 flex list-none flex-col p-0">
          @for (r of rows; track r.code; let last = $last) {
            <li class="grid min-h-14 grid-cols-[minmax(0,1fr)_100px] items-center gap-4 border-(--surface-4)" [class.border-b]="!last">
              <div class="flex min-w-0 flex-col gap-[6px]">
                <div class="flex min-w-0 items-baseline gap-[10px]">
                  <span class="flex-none font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--text-2)">{{ r.code }}</span>
                  <span class="min-w-0 truncate text-(length:--fs-14) font-normal text-(--text)">{{ r.name }}</span>
                </div>
                <qa-progress [value]="r.done" [max]="r.of" [attr.aria-label]="r.code + ' reviewed'" />
              </div>
              <span class="text-right font-(family-name:--qa-mono) text-(length:--fs-13) tabular-nums"
                ><span class="font-semibold text-(--text)">{{ r.done }}</span><span class="text-(--text-4)"> of {{ r.of }}</span></span
              >
            </li>
          }
        </ul>
      }

      <div qaDrawerFooter class="contents">
        <button
          hlmBtn
          variant="outline"
          type="button"
          (click)="exportComments()"
          class="h-auto min-h-9 rounded-[8px] border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium text-(--text-2) shadow-none hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:shadow-(--focus-ring) focus-visible:ring-0"
        >Export comments</button>
      </div>
    </qa-drawer>
  `,
})
export class OvProgressDrawer {
  readonly open = model(false);
  readonly data = input<ProgressVm | null>(null);

  protected readonly rows = PROGRAM_PROGRESS.map((p) => ({ ...p, name: PROGRAMS[p.code] ?? p.code }));
  protected readonly n = fmt;

  protected exportComments(): void {
    // TODO(api): export the comments of this step (the mockup button does nothing yet).
  }
}
