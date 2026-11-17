import { Component, computed, input } from '@angular/core';

export interface SplitVm {
  readonly title: string;
  readonly subtitle: string;
  readonly segments: readonly { readonly label: string; readonly n: number; readonly cls: string }[];
}

/**
 * One 100% bar split into a few parts, with each part's count and share below it.
 * Assessor: what happened to their comments. TPB: their decisions. Neutral colors: it informs, it does not grade.
 */
@Component({
  selector: 'qa-ov-split',
  host: { class: 'block' },
  template: `
    @let d = data();
    <section [attr.aria-labelledby]="headingId()" class="flex h-full flex-col gap-4 rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex flex-col gap-0.5">
        <h3 [id]="headingId()" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">{{ d.title }}</h3>
        <p class="m-0 text-(length:--fs-13) text-(--text-3)">{{ d.subtitle }}</p>
      </div>
      <div class="flex h-3.5 gap-0.5" role="img" [attr.aria-label]="ariaLabel()">
        @for (s of d.segments; track s.label) {
          @if (s.n > 0) {
            <span class="h-full min-w-[3px] rounded-[3px]" [class]="s.cls" [style.flex-grow]="s.n"></span>
          }
        }
      </div>
      <ul class="m-0 flex list-none flex-col p-0">
        @for (s of rows(); track s.label; let last = $last) {
          <li class="flex min-h-10 items-center gap-3" [class]="last ? '' : 'border-b border-(--surface-4)'">
            <i aria-hidden="true" class="inline-block size-2.5 flex-none rounded-[3px]" [class]="s.cls"></i>
            <span class="min-w-0 flex-1 text-(length:--fs-14) text-(--text-2)">{{ s.label }}</span>
            <span class="text-(length:--fs-12) text-(--text-3) tabular-nums">{{ s.pct }}%</span>
            <span class="w-10 flex-none text-right text-(length:--fs-16) font-bold tabular-nums text-(--text)">{{ s.n }}</span>
          </li>
        }
      </ul>
    </section>
  `,
})
export class OvSplit {
  readonly data = input.required<SplitVm>();
  /** Unique heading id when the page shows more than one. */
  readonly headingId = input('overview-split-title');

  protected readonly rows = computed(() => {
    const total = this.data().segments.reduce((a, s) => a + s.n, 0) || 1;
    return this.data().segments.map((s) => ({ ...s, pct: Math.round((s.n / total) * 100) }));
  });

  protected readonly ariaLabel = computed(() => this.data().segments.map((s) => `${s.label} ${s.n}`).join(', '));
}
