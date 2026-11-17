import { Component, computed, input } from '@angular/core';

export interface RankedVm {
  readonly title: string;
  readonly subtitle: string;
  /** Biggest first. `code` is shown in mono before the label (programs). */
  readonly rows: readonly { readonly code?: string; readonly label: string; readonly n: number }[];
}

/** A ranked list with one bar per row on a shared scale (lead assessor: rejections by program, most discussed fields). */
@Component({
  selector: 'qa-ov-ranked',
  host: { class: 'block @container' },
  template: `
    @let d = data();
    <section [attr.aria-labelledby]="headingId()" class="flex h-full flex-col gap-3 rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex flex-col gap-0.5">
        <h3 [id]="headingId()" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">{{ d.title }}</h3>
        <p class="m-0 text-(length:--fs-13) text-(--text-3)">{{ d.subtitle }}</p>
      </div>
      <ul class="m-0 flex list-none flex-col p-0">
        @for (r of rows(); track r.label) {
          <li class="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-x-3 gap-y-1 py-1.5 @md:grid-cols-[12rem_minmax(0,1fr)_2.5rem]">
            <span class="min-w-0 truncate text-(length:--fs-13) text-(--text-2)">
              @if (r.code) {<span class="mr-1.5 font-(family-name:--qa-mono) font-semibold text-(--text-2)">{{ r.code }}</span>}{{ r.label }}
            </span>
            <span class="col-span-2 row-start-2 flex h-3 @md:col-span-1 @md:row-start-auto" aria-hidden="true">
              <span class="h-full rounded-[3px] bg-(--primary)" [style.width.%]="r.width"></span>
            </span>
            <span class="row-start-1 text-right text-(length:--fs-13) font-bold tabular-nums text-(--text) @md:row-start-auto">{{ r.n }}</span>
          </li>
        }
      </ul>
    </section>
  `,
})
export class OvRanked {
  readonly data = input.required<RankedVm>();
  readonly headingId = input('overview-ranked-title');

  protected readonly rows = computed(() => {
    const max = Math.max(1, ...this.data().rows.map((r) => r.n));
    return this.data().rows.map((r) => ({ ...r, width: (r.n / max) * 100 }));
  });
}
