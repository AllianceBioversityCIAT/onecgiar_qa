import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaButtonImports } from '../../../ui';
import { ResultStatus } from './overview.mock';

export interface CycleHeroVm {
  /** "2026 cycle, 2 live timelines". */
  readonly eyebrow: string;
  readonly total: string;
  /** Share of results already quality assessed (0–100). */
  readonly assessedPct: number;
  readonly assessed: string;
  /** Current step of the official timeline, e.g. "Step 5 of 5: QA platform open for PPU". */
  readonly step: string;
  /** "closes today" / "closes in 3 days". */
  readonly stepWhen: string;
  readonly statuses: readonly { readonly status: ResultStatus; readonly count: string; readonly pct: number }[];
}

/** Solid segment color per status (the strong side of each status chip). */
const STATUS_BAR: Record<ResultStatus, string> = {
  Pending: 'bg-(--text-muted)',
  'In review': 'bg-(--st-indigo-fg)',
  'Awaiting response': 'bg-(--st-editing-fg)',
  Answered: 'bg-(--st-submitted-fg)',
  'Quality assessed': 'bg-(--st-approved-fg)',
};

/** Top of the Overview: the whole cycle at a glance, with every result split by status. */
@Component({
  selector: 'qa-ov-cycle-hero',
  imports: [QaButtonImports, RouterLink],
  host: { class: 'block @container' },
  template: `
    <section
      aria-labelledby="overview-hero-title"
      class="relative flex flex-col gap-6 overflow-hidden rounded-[16px] bg-(--surface-3) p-5 @2xl:p-7"
    >
      <!-- Two rows that share the same left and right edges:
           1. context: cycle on the left, current step + link on the right (same small text, same line);
           2. figures: the total and the assessed share sit on one baseline. -->
      <div class="flex flex-wrap items-center justify-between gap-x-8 gap-y-1">
        <span class="text-(length:--fs-13) font-medium text-(--text-3)">{{ data().eyebrow }}</span>
        <span class="flex min-w-0 flex-wrap items-center gap-x-3 text-(length:--fs-13) text-pretty text-(--text-3)">
          <span><span class="font-medium text-(--text-2)">{{ data().step }}</span>, {{ data().stepWhen }}</span>
          <a hlmBtn qaBtn tone="link" size="sm" routerLink="/cycle" class="-ml-2.5 @2xl:-mr-2.5 @2xl:ml-0">See the full cycle</a>
        </span>
      </div>

      <div class="-mt-3 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h2 id="overview-hero-title" class="m-0 flex flex-wrap items-baseline gap-x-3">
          <span class="text-[2rem] leading-[1.05] font-bold tracking-[-0.02em] tabular-nums text-(--text) @2xl:text-[2.75rem]">{{ data().total }}</span>
          <span class="text-(length:--fs-16) font-semibold text-(--text-2)">results in QA</span>
        </h2>
        <span class="flex items-baseline gap-2">
          <span class="text-[2rem] leading-[1.05] font-bold tracking-[-0.02em] tabular-nums text-(--st-approved-fg) @2xl:text-[2.75rem]">{{ data().assessedPct }}%</span>
          <span class="text-(length:--fs-16) font-semibold text-(--text-2)">quality assessed</span>
          <span class="text-(length:--fs-13) text-(--text-4)">({{ data().assessed }} results)</span>
        </span>
      </div>

      <!-- Status bar: every result in QA, split by status -->
      <div class="flex flex-col gap-3">
        <div class="flex h-3 w-full gap-[3px] overflow-hidden rounded-full" role="img" [attr.aria-label]="barLabel()">
          @for (s of data().statuses; track s.status) {
            @if (s.pct > 0) {
              <span class="h-full first:rounded-l-full last:rounded-r-full" [class]="bar[s.status]" [style.flex-grow]="s.pct"></span>
            }
          }
        </div>

        <ul class="m-0 grid list-none grid-cols-1 gap-1 p-0 @md:grid-cols-2 @3xl:grid-cols-5 @3xl:gap-3">
          @for (s of data().statuses; track s.status) {
            <li class="min-w-0">
              <a
                routerLink="/results"
                [queryParams]="{ status: s.status }"
                [attr.aria-label]="s.status + ': ' + s.count + ' results'"
                class="flex min-h-10 min-w-0 items-center gap-2 rounded-[10px] px-2 py-[6px] no-underline hover:bg-(--surface)/70 focus-visible:shadow-(--focus-ring) focus-visible:outline-none @3xl:flex-col @3xl:items-start @3xl:gap-1"
              >
                <span class="flex min-w-0 flex-1 items-center gap-2">
                  <span aria-hidden="true" class="size-[10px] flex-none rounded-[3px]" [class]="bar[s.status]"></span>
                  <span class="truncate text-(length:--fs-13) font-medium text-(--text-3)">{{ s.status }}</span>
                </span>
                <span class="flex items-baseline gap-[6px]">
                  <span class="text-(length:--fs-20) font-bold tabular-nums text-(--text)">{{ s.count }}</span>
                  <span class="text-(length:--fs-12) tabular-nums text-(--text-muted)">{{ s.pct }}%</span>
                </span>
              </a>
            </li>
          }
        </ul>
      </div>
    </section>
  `,
})
export class OvCycleHero {
  readonly data = input.required<CycleHeroVm>();

  protected readonly bar = STATUS_BAR;

  protected readonly barLabel = computed(() => 'Results by status: ' + this.data().statuses.map((s) => `${s.status} ${s.count}`).join(', '));
}
