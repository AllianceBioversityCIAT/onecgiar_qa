import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
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
  imports: [RouterLink],
  host: { class: 'block @container' },
  template: `
    <section aria-labelledby="overview-stages-title" class="flex flex-col gap-4 rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex flex-col gap-1">
        <h3 id="overview-stages-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">Stage completion</h3>
        <p class="m-0 text-(length:--fs-13) font-normal text-(--text-3)">Each stage closes when its own condition is met. Nothing closes on a date alone.</p>
      </div>

      <!-- >= @4xl: the mockup table. @2xl-@4xl: Status moves under the stage name. < @2xl: rows stack, no header row.
           No sticky header: five fixed stages (~400px) never outgrow the viewport. -->
      <div>
        <table class="w-full table-fixed border-collapse @max-2xl:block">
          <caption class="sr-only">Stage completion</caption>
          <colgroup class="@max-2xl:hidden">
            <col class="w-[48px]" />
            <col />
            <col class="w-[236px] @max-4xl:w-[200px]" />
            <col class="w-[126px] @max-4xl:w-[96px]" />
            <col class="w-[154px] @max-4xl:w-0" />
          </colgroup>
          <thead class="@max-2xl:hidden">
            <tr class="h-10 border-b border-(--surface-4)">
              <th scope="col" class="pr-4 pl-1"><span class="sr-only">Step</span></th>
              <th scope="col" class="pr-4 text-left text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">Stage</th>
              <th scope="col" class="pr-4 text-left text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">Completion</th>
              <th scope="col" class="pr-4 text-right @max-4xl:pr-1 text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">Remaining</th>
              <th scope="col" class="pr-1 text-right @max-4xl:hidden text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">Status</th>
            </tr>
          </thead>
          <tbody class="@max-2xl:block">
            @for (s of stages(); track s.n; let last = $last) {
              <tr
                class="relative h-[68px] cursor-pointer border-(--surface-4) hover:bg-(--surface-2) @max-2xl:grid @max-2xl:h-auto @max-2xl:grid-cols-[20px_minmax(0,1fr)_auto] @max-2xl:gap-x-3 @max-2xl:gap-y-2 @max-2xl:py-3"
                [class.border-b]="!last"
              >
                <td class="pt-3 pr-4 pb-[10px] pl-1 align-top @max-2xl:col-start-1 @max-2xl:row-start-1 @max-2xl:p-0 @max-2xl:pt-px font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold tabular-nums text-(--text-muted)">{{ s.n }}</td>
                <td class="py-[10px] pr-4 align-middle @max-2xl:col-start-2 @max-2xl:row-start-1 @max-2xl:p-0">
                  <div class="flex min-w-0 flex-col gap-[3px]">
                    <a
                      routerLink="/results"
                      [queryParams]="{ status: s.statuses }"
                      [title]="s.name"
                      class="truncate text-(length:--fs-14) font-semibold @max-2xl:whitespace-normal text-(--text) no-underline after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-[6px] focus-visible:after:shadow-(--focus-ring)"
                    >{{ s.name }}</a>
                    <span class="line-clamp-2 text-(length:--fs-12) leading-[1.45] font-normal text-(--text-4)">{{ s.criterion }}</span>
                    <span class="flex flex-wrap items-center gap-2 text-(length:--fs-11) font-medium text-(--text-muted)"
                      >{{ s.round }}
                      <span class="hidden rounded-full px-2 py-px font-semibold whitespace-nowrap @2xl:@max-4xl:inline" [class]="chip[s.status]">{{ s.status }}</span></span
                    >
                  </div>
                </td>
                <td class="py-[10px] pr-4 align-middle @max-2xl:contents">
                  <div class="flex min-w-0 flex-col gap-[5px] @max-2xl:contents">
                    <div class="h-2 overflow-hidden rounded-full bg-(--surface-4) @max-2xl:col-[2/-1] @max-2xl:row-start-2">
                      <div class="h-full rounded-full transition-[width] duration-200" [class]="s.closed ? 'bg-(--border-strong)' : 'bg-(--primary)'" [style.width.%]="s.pct"></div>
                    </div>
                    <span class="truncate text-(length:--fs-12) font-normal text-(--text-3) @max-2xl:col-start-2 @max-2xl:row-start-3 @max-2xl:self-center @max-2xl:whitespace-normal"
                      ><span class="font-(family-name:--qa-mono) font-bold whitespace-nowrap tabular-nums text-(--text)">{{ s.pct }}%</span
                      ><span class="text-(--text-4)">{{ s.detail }}</span></span
                    >
                  </div>
                </td>
                <td
                  class="py-[10px] pr-4 text-right align-middle font-(family-name:--qa-mono) text-(length:--fs-14) font-bold whitespace-nowrap tabular-nums @max-4xl:pr-1 @max-2xl:col-start-3 @max-2xl:row-start-3 @max-2xl:self-center @max-2xl:p-0 @max-2xl:text-(length:--fs-13)"
                  [class]="s.left ? 'text-(--text)' : 'text-(--text-muted)'"
                >{{ s.leftText }}<span class="hidden font-sans text-(length:--fs-12) font-normal text-(--text-4) @max-2xl:inline"> left</span></td>
                <td class="py-[10px] pr-1 text-right align-middle @max-4xl:hidden @max-2xl:col-start-3 @max-2xl:row-start-1 @max-2xl:block @max-2xl:self-start @max-2xl:p-0">
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

  protected readonly chip = STAGE_CHIP;
}
