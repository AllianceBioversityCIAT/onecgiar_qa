import { Component, computed, input } from '@angular/core';
import { fmt } from './overview-calc';

export interface OutcomesVm {
  /** Results that entered QA, already formatted ("1,330"). */
  readonly total: string;
  readonly approvedFirstPass: number;
  readonly returnedResolved: number;
  readonly returnedOpen: number;
  readonly neverFinished: number;
  readonly autoApproved: number;
}

/** "Assessment outcomes": stacked bar + legend of how results came out of QA. */
@Component({
  selector: 'qa-ov-outcomes',
  host: { class: 'block' },
  template: `
    <section aria-labelledby="overview-oc-title" class="flex flex-col gap-[18px] rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex flex-col gap-1">
        <h3 id="overview-oc-title" class="m-0 text-(length:--fs-16) font-bold text-(--text)">Assessment outcomes</h3>
        <p class="m-0 text-(length:--fs-13) text-(--text-3)"><span class="font-(family-name:--qa-mono) font-semibold tabular-nums text-(--text)">{{ data().total }}</span> results have entered QA this cycle.</p>
      </div>
      <div role="img" [attr.aria-label]="barLabel()" class="flex h-3 w-full overflow-hidden rounded-full bg-(--border-soft)">
        @for (s of segments(); track s.label) {
          <div [title]="s.label + ' · ' + s.pct + '%'" [class]="s.color" [style.width.%]="s.pct"></div>
        }
      </div>
      <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
        @for (s of segments(); track s.label) {
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-[7px]"><span aria-hidden="true" class="size-2 flex-none rounded-full" [class]="s.color"></span><span class="text-(length:--fs-13) font-medium text-(--text-2)">{{ s.label }}</span></div>
            <div class="font-(family-name:--qa-mono) text-(length:--fs-22) font-bold tabular-nums text-(--text)">{{ s.value }}</div>
            <div class="text-(length:--fs-12) font-normal text-(--text-4)">{{ s.help }}</div>
          </div>
        }
      </div>
      <div class="flex items-center gap-2 border-t border-(--surface-4) pt-3 text-(length:--fs-13) font-normal text-(--text-3)">
        <svg class="flex-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
        <span><span class="font-(family-name:--qa-mono) font-semibold tabular-nums text-(--text-2)">{{ auto() }}</span> knowledge products were approved automatically and did not go to an assessor.</span>
      </div>
    </section>
  `,
})
export class OvOutcomes {
  readonly data = input.required<OutcomesVm>();

  protected readonly segments = computed(() => {
    const d = this.data();
    const parts = [
      { label: 'Approved first pass', help: 'No comments needed', n: d.approvedFirstPass, color: 'bg-(--chart-4)' },
      { label: 'Returned and resolved', help: 'Comments answered, approved', n: d.returnedResolved, color: 'bg-(--chart-3)' },
      { label: 'Returned, open', help: 'Waiting on the program', n: d.returnedOpen, color: 'bg-(--chart-2)' },
      { label: 'Started, never finished', help: 'No response before the step closed', n: d.neverFinished, color: 'bg-(--chart-1)' },
    ];
    const sum = parts.reduce((a, p) => a + p.n, 0);
    return parts.map((p) => ({ ...p, value: fmt(p.n), pct: sum ? Math.round((p.n / sum) * 100) : 0 }));
  });

  protected readonly barLabel = computed(() => this.segments().map((s) => `${s.label} ${s.pct}%`).join(', '));
  protected readonly auto = computed(() => fmt(this.data().autoApproved));
}
