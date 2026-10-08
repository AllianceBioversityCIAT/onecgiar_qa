import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ResultStatus } from './overview.mock';

export interface ResultsInQaVm {
  readonly officialCount: string;
  readonly officialLine: string;
  readonly subsCount: string;
  readonly subsLine: string;
  readonly statuses: readonly { readonly status: ResultStatus; readonly count: string }[];
}

const STATUS_CHIP: Record<ResultStatus, string> = {
  Pending: 'bg-(--surface-3) text-(--text-muted)',
  'In review': 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  'Awaiting response': 'bg-(--st-editing-bg) text-(--st-editing-fg)',
  Answered: 'bg-(--st-submitted-bg) text-(--st-submitted-fg)',
  'Quality assessed': 'bg-(--st-approved-bg) text-(--st-approved-fg)',
};

/** "Results in QA": official vs sub-timeline totals and the count per status (links to Results). */
@Component({
  selector: 'qa-ov-results-in-qa',
  imports: [RouterLink],
  host: { class: 'block' },
  template: `
    <section aria-labelledby="overview-rq-title" class="flex flex-col gap-4 rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex flex-col gap-1">
        <h3 id="overview-rq-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">Results in QA</h3>
        <p class="m-0 text-(length:--fs-13) font-normal text-(--text-3)">Where the results came in from.</p>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button type="button" (click)="officialClick.emit()" class="flex cursor-pointer flex-col gap-[6px] rounded-[10px] border border-(--border) bg-(--surface-2) px-4 py-[14px] text-left hover:border-(--border-strong) focus-visible:shadow-(--focus-ring) focus-visible:outline-none">
          <span class="text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">Official timeline</span>
          <span class="font-(family-name:--qa-mono) text-(length:--fs-26) font-bold tabular-nums text-(--text)">{{ data().officialCount }}</span>
          <span class="text-(length:--fs-12) font-normal text-(--text-4)">{{ data().officialLine }}</span>
        </button>
        <button type="button" (click)="subsClick.emit()" class="flex cursor-pointer flex-col gap-[6px] rounded-[10px] border border-(--border) bg-(--surface-2) px-4 py-[14px] text-left hover:border-(--border-strong) focus-visible:shadow-(--focus-ring) focus-visible:outline-none">
          <span class="text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">Sub-timelines</span>
          <span class="font-(family-name:--qa-mono) text-(length:--fs-26) font-bold tabular-nums text-(--text)">{{ data().subsCount }}</span>
          <span class="text-(length:--fs-12) font-normal text-(--text-4)">{{ data().subsLine }}</span>
        </button>
      </div>
      <div class="grid grid-cols-2 gap-3 border-t border-(--surface-4) pt-[14px] sm:grid-cols-3 lg:grid-cols-5">
        @for (s of data().statuses; track s.status) {
          <a
            routerLink="/results"
            [queryParams]="{ status: s.status }"
            [attr.aria-label]="s.status + ': ' + s.count + ' results'"
            class="-m-[6px] flex min-w-0 cursor-pointer flex-col gap-[3px] rounded-[8px] p-[6px] no-underline hover:bg-(--surface-2) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
          >
            <span class="self-start rounded-full px-[10px] py-[3px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="chip[s.status]">{{ s.status }}</span>
            <span class="font-(family-name:--qa-mono) text-(length:--fs-20) font-bold tabular-nums text-(--text)">{{ s.count }}</span>
          </a>
        }
      </div>
    </section>
  `,
})
export class OvResultsInQa {
  readonly data = input.required<ResultsInQaVm>();
  readonly officialClick = output();
  readonly subsClick = output();

  protected readonly chip = STATUS_CHIP;
}
