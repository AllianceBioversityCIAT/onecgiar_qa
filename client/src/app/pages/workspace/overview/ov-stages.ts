import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan/button';
import { ResultStatus } from './overview.mock';

export type StageStatus = 'Closed' | 'In progress' | 'Behind' | 'Not started';

export interface StageVm {
  readonly n: number;
  readonly name: string;
  readonly criterion: string;
  readonly round: string;
  readonly pct: number;
  /** " · 191 of 234 corrected". */
  readonly detail: string;
  readonly left: number;
  readonly leftText: string;
  readonly status: StageStatus;
  readonly closed: boolean;
  readonly statuses: readonly ResultStatus[];
}

const STAGE_CHIP: Record<StageStatus, string> = {
  Closed: 'bg-(--surface-3) text-(--text-muted)',
  'In progress': 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  Behind: 'bg-(--st-editing-bg) text-(--st-editing-fg)',
  'Not started': 'bg-(--surface-3) text-(--text-muted) opacity-70',
};

/** "Stage completion" table: one row per stage, each row opens its results. */
@Component({
  selector: 'qa-ov-stages',
  imports: [HlmButton, RouterLink],
  host: { class: 'block' },
  template: `
    <section aria-labelledby="overview-stages-title" class="flex flex-col gap-4 rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex flex-wrap items-start gap-4">
        <div class="flex min-w-[220px] flex-1 flex-col gap-1 max-sm:min-w-0">
          <h3 id="overview-stages-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">Stage completion</h3>
          <p class="m-0 text-(length:--fs-13) font-normal text-(--text-3)">Each stage closes when its own condition is met. Nothing closes on a date alone.</p>
        </div>
        <button
          hlmBtn
          variant="outline"
          type="button"
          (click)="export.emit()"
          class="h-auto min-h-9 flex-none gap-2 rounded-[8px] border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium whitespace-nowrap text-(--text-2) shadow-none hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:shadow-(--focus-ring) focus-visible:ring-0"
        >
          <svg class="flex-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"></path></svg>Export progress
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full min-w-[720px] table-fixed border-collapse">
          <caption class="sr-only">Stage completion</caption>
          <colgroup>
            <col class="w-[48px]" />
            <col />
            <col class="w-[236px]" />
            <col class="w-[126px]" />
            <col class="w-[154px]" />
          </colgroup>
          <thead>
            <tr class="h-10 border-b border-(--surface-4)">
              <th scope="col" class="pr-4 pl-1"><span class="sr-only">Step</span></th>
              <th scope="col" class="pr-4 text-left text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">Stage</th>
              <th scope="col" class="pr-4 text-left text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">Completion</th>
              <th scope="col" class="pr-4 text-right text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">Remaining</th>
              <th scope="col" class="pr-1 text-right text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (s of stages(); track s.n; let last = $last) {
              <tr class="relative h-[68px] cursor-pointer border-(--surface-4) hover:bg-(--surface-2)" [class.border-b]="!last">
                <td class="pt-3 pr-4 pb-[10px] pl-1 align-top font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold tabular-nums text-(--text-muted)">{{ s.n }}</td>
                <td class="py-[10px] pr-4 align-middle">
                  <div class="flex min-w-0 flex-col gap-[3px]">
                    <a
                      routerLink="/results"
                      [queryParams]="{ status: s.statuses }"
                      [title]="s.name"
                      class="truncate text-(length:--fs-14) font-semibold text-(--text) no-underline after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-[6px] focus-visible:after:shadow-(--focus-ring)"
                    >{{ s.name }}</a>
                    <span class="line-clamp-2 text-(length:--fs-12) leading-[1.45] font-normal text-(--text-4)">{{ s.criterion }}</span>
                    <span class="text-(length:--fs-11) font-medium text-(--text-muted)">{{ s.round }}</span>
                  </div>
                </td>
                <td class="py-[10px] pr-4 align-middle">
                  <div class="flex min-w-0 flex-col gap-[5px]">
                    <div class="h-2 overflow-hidden rounded-full bg-(--surface-4)">
                      <div class="h-full rounded-full transition-[width] duration-200" [class]="s.closed ? 'bg-(--border-strong)' : 'bg-(--primary)'" [style.width.%]="s.pct"></div>
                    </div>
                    <span class="truncate text-(length:--fs-12) font-normal text-(--text-3)"
                      ><span class="font-(family-name:--qa-mono) font-bold tabular-nums text-(--text)">{{ s.pct }}%</span
                      ><span class="text-(--text-4)">{{ s.detail }}</span></span
                    >
                  </div>
                </td>
                <td class="py-[10px] pr-4 text-right align-middle font-(family-name:--qa-mono) text-(length:--fs-14) font-bold tabular-nums" [class]="s.left ? 'text-(--text)' : 'text-(--text-muted)'">{{ s.leftText }}</td>
                <td class="py-[10px] pr-1 text-right align-middle">
                  <span class="rounded-full px-[10px] py-[3px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="chip[s.status]">{{ s.status }}</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (shortNote(); as note) {
        <div class="flex items-center gap-2 border-t border-(--surface-4) pt-[14px] text-(length:--fs-13) font-normal text-(--text-3)">
          <svg class="flex-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01"></path></svg>
          <span>{{ note }}</span>
        </div>
      }
    </section>
  `,
})
export class OvStages {
  readonly stages = input.required<readonly StageVm[]>();
  readonly shortNote = input<string | null>(null);
  readonly export = output();

  protected readonly chip = STAGE_CHIP;
}
