import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaButtonImports } from '../../../ui';
import { QaStage } from '../results/results.mock';

export interface RoundStageVm {
  readonly stage: QaStage;
  readonly label: string;
  /** One short line under the label: what the state means. */
  readonly hint: string;
  readonly n: number;
  readonly count: string;
}

export interface RoundVm {
  readonly id: 'r1' | 'r2';
  readonly title: string;
  /** Who works in the round. */
  readonly who: string;
  readonly total: string;
  readonly stages: readonly RoundStageVm[];
}

export interface CycleHeroVm {
  /** "2 live timelines". */
  readonly eyebrow: string;
  readonly total: string;
  readonly rounds: readonly RoundVm[];
  /** Results that finished every QA step (the only place "Quality assessed" is used). */
  readonly final: { readonly count: string; readonly pct: number };
}

/** Solid color per stage. Each round goes from grey (not started) to its full color (assessed); green is kept for the final state. */
const STAGE_COLOR: Record<QaStage, string> = {
  'r1-pending': 'bg-(--text-muted)',
  'r1-review': 'bg-(--st-indigo-fg)/35',
  'r1-one': 'bg-(--st-indigo-fg)/65',
  'r1-two': 'bg-(--st-indigo-fg)',
  'r2-pending': 'bg-(--text-muted)',
  'r2-assessed': 'bg-(--st-submitted-fg)',
  'quality-assessed': 'bg-(--st-approved-fg)',
};

/** Top of the Overview: the whole cycle at a glance, with Round 1 and Round 2 side by side so they can be compared. */
@Component({
  selector: 'qa-ov-cycle-hero',
  imports: [QaButtonImports, RouterLink],
  host: { class: 'block @container' },
  template: `
    <section
      aria-labelledby="overview-hero-title"
      class="relative flex flex-col gap-6 overflow-hidden rounded-[16px] bg-(--surface-3) p-5 @2xl:p-7"
    >
      <!-- Context row: cycle on the left, link on the right. The current step is in the page header line, so it is not repeated here. Then the total. -->
      <div class="flex flex-wrap items-center justify-between gap-x-8 gap-y-1">
        <span class="text-(length:--fs-13) font-medium text-(--text-3)">{{ data().eyebrow }}</span>
        <a hlmBtn qaBtn tone="link" size="sm" routerLink="/cycle" class="-ml-2.5 @2xl:-mr-2.5 @2xl:ml-0">See the full cycle</a>
      </div>

      <h2 id="overview-hero-title" class="m-0 -mt-3 flex flex-wrap items-baseline gap-x-3">
        <span class="text-[2rem] leading-[1.05] font-bold tracking-[-0.02em] tabular-nums text-(--text) @2xl:text-[2.75rem]">{{ data().total }}</span>
        <span class="text-(length:--fs-16) font-semibold text-(--text-2)">results in QA</span>
      </h2>

      <!-- Round 1 and Round 2 side by side (stacked on narrow screens). Every row opens Results filtered by that stage. -->
      <div class="-mt-1 grid grid-cols-1 gap-3 @3xl:grid-cols-2">
        @for (r of data().rounds; track r.id) {
          <section [attr.aria-labelledby]="'hero-' + r.id + '-title'" class="flex flex-col gap-4 rounded-[12px] border border-(--border) bg-(--surface) p-4 @2xl:p-5">
            <div class="flex items-start justify-between gap-4">
              <div class="flex min-w-0 flex-col gap-[2px]">
                <h3 [id]="'hero-' + r.id + '-title'" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">{{ r.title }}</h3>
                <span class="text-(length:--fs-12) text-(--text-4)">{{ r.who }}</span>
              </div>
              <span class="flex flex-none items-baseline gap-[6px]">
                <span class="text-(length:--fs-20) font-bold tabular-nums text-(--text)">{{ r.total }}</span>
                <span class="text-(length:--fs-12) text-(--text-muted)">results</span>
              </span>
            </div>

            <div class="flex h-2 w-full gap-[3px] overflow-hidden rounded-full" role="img" [attr.aria-label]="barLabel(r)">
              @for (s of r.stages; track s.stage) {
                @if (s.n > 0) {
                  <span class="h-full first:rounded-l-full last:rounded-r-full" [class]="color[s.stage]" [style.flex-grow]="s.n"></span>
                }
              }
            </div>

            <ul class="m-0 -mx-2 flex list-none flex-col p-0">
              @for (s of r.stages; track s.stage) {
                <li>
                  <a
                    routerLink="/results"
                    [queryParams]="{ stage: s.stage }"
                    [attr.aria-label]="r.title + ', ' + s.label + ': ' + s.count + ' results'"
                    class="group flex min-h-11 items-center gap-3 rounded-[8px] px-2 py-[7px] no-underline hover:bg-(--surface-2) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
                  >
                    <span aria-hidden="true" class="size-[10px] flex-none rounded-[3px]" [class]="color[s.stage]"></span>
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="text-(length:--fs-14) font-medium text-(--text-2)">{{ s.label }}</span>
                      <span class="text-(length:--fs-12) leading-[1.4] text-(--text-4)">{{ s.hint }}</span>
                    </span>
                    <span class="flex-none text-(length:--fs-16) font-bold tabular-nums text-(--text)">{{ s.count }}</span>
                    <svg class="flex-none text-(--text-muted) group-hover:text-(--text-3)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
                  </a>
                </li>
              }
            </ul>
          </section>
        }
      </div>

      <!-- Final state: the only place "Quality assessed" appears -->
      <a
        routerLink="/results"
        [queryParams]="{ stage: 'quality-assessed' }"
        [attr.aria-label]="'Quality assessed: ' + data().final.count + ' results, ' + data().final.pct + '% of results in QA'"
        class="group -mt-3 flex min-h-11 items-center gap-3 rounded-[12px] bg-(--st-approved-bg) px-4 py-3 no-underline focus-visible:shadow-(--focus-ring) focus-visible:outline-none @2xl:px-5"
      >
        <span aria-hidden="true" class="flex size-5 flex-none items-center justify-center rounded-full bg-(--st-approved-fg)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-x-3 @xl:flex-row @xl:items-baseline">
          <span class="text-(length:--fs-14) font-semibold text-(--st-approved-fg)">Quality assessed</span>
          <span class="text-(length:--fs-12) text-(--st-approved-fg) @xl:text-(length:--fs-13)">Finished every QA step</span>
        </span>
        <span class="flex flex-none items-baseline gap-[6px]">
          <span class="text-(length:--fs-16) font-bold tabular-nums text-(--st-approved-fg)">{{ data().final.count }}</span>
          <span class="text-(length:--fs-12) tabular-nums text-(--st-approved-fg)">{{ data().final.pct }}%</span>
        </span>
        <svg class="flex-none text-(--st-approved-fg)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
      </a>
    </section>
  `,
})
export class OvCycleHero {
  readonly data = input.required<CycleHeroVm>();

  protected readonly color = STAGE_COLOR;

  protected barLabel(r: RoundVm): string {
    return `${r.title} by stage: ` + r.stages.map((s) => `${s.label} ${s.count}`).join(', ');
  }
}
