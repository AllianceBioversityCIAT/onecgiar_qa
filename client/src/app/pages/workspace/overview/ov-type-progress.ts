import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface TypeProgressVm {
  readonly type: string;
  /** Results still in Round 1, in Round 2, and quality assessed. */
  readonly r1: number;
  readonly r2: number;
  readonly qa: number;
  readonly total: string;
  readonly qaText: string;
  /** Share quality assessed (rows are sorted by it, least advanced first). */
  readonly pct: number;
}

/** Same colors as the rounds in the hero: indigo for Round 1, blue for Round 2, green for the final state. */
const BUCKETS = [
  { key: 'r1', label: 'In Round 1', cls: 'bg-(--st-indigo-fg)/65' },
  { key: 'r2', label: 'In Round 2', cls: 'bg-(--st-submitted-fg)' },
  { key: 'qa', label: 'Quality assessed', cls: 'bg-(--st-approved-fg)' },
] as const;

/** "Progress by result type": one 100% bar per type, so types of any size compare at a glance. */
@Component({
  selector: 'qa-ov-type-progress',
  imports: [RouterLink],
  host: { class: 'block @container' },
  template: `
    <section aria-labelledby="overview-types-title" class="flex h-full flex-col rounded-[12px] border border-(--border) bg-(--surface) pt-5">
      <div class="flex flex-col gap-0.5 px-5 pb-3">
        <h3 id="overview-types-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">Progress by result type</h3>
        <p class="m-0 text-(length:--fs-13) text-(--text-3)">Where each result type is in QA, least advanced first. Click a row to open its results.</p>
      </div>

      <ul class="m-0 flex list-none flex-col p-0">
        @for (r of rows(); track r.type) {
          <li>
            <a
              routerLink="/results"
              [queryParams]="{ type: r.type }"
              [attr.aria-label]="r.type + ': ' + r.r1 + ' in Round 1, ' + r.r2 + ' in Round 2, ' + r.qaText + ' quality assessed'"
              class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-5 py-2 no-underline hover:bg-(--surface-2) focus-visible:shadow-(--focus-ring) focus-visible:outline-none @xl:grid-cols-[13rem_minmax(0,1fr)_6.5rem]"
            >
              <span class="min-w-0 truncate text-(length:--fs-13) text-(--text-2)">{{ r.type }}</span>
              <span class="col-span-2 row-start-2 flex h-3.5 gap-0.5 @xl:col-span-1 @xl:row-start-auto" aria-hidden="true">
                @for (b of buckets; track b.key) {
                  @if (r[b.key] > 0) {
                    <span class="h-full min-w-[3px] rounded-[3px]" [class]="b.cls" [style.flex-grow]="r[b.key]" [title]="b.label + ': ' + r[b.key]"></span>
                  }
                }
              </span>
              <span class="text-right text-(length:--fs-12) whitespace-nowrap text-(--text-3)"
                ><b class="text-(length:--fs-13) tabular-nums text-(--text)">{{ r.pct }}%</b> {{ r.qaText }} of {{ r.total }}</span
              >
            </a>
          </li>
        }
      </ul>

      <div class="mt-auto flex flex-wrap gap-x-4 gap-y-1 px-5 pt-3 pb-5 text-(length:--fs-12) text-(--text-3)">
        @for (b of buckets; track b.key) {
          <span class="inline-flex items-center gap-1.5"><i class="inline-block size-2.5 rounded-[3px]" [class]="b.cls"></i>{{ b.label }}</span>
        }
      </div>
    </section>
  `,
})
export class OvTypeProgress {
  readonly rows = input.required<readonly TypeProgressVm[]>();
  protected readonly buckets = BUCKETS;
}
