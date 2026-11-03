import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaButtonImports } from '../../../ui';
import { AssessorLoad } from './overview.mock';

/** "Assessor load": assessed vs still to assess per assessor, most pending first. */
@Component({
  selector: 'qa-ov-assessor-load',
  imports: [QaButtonImports, RouterLink],
  host: { class: 'block @container' },
  template: `
    <section aria-labelledby="overview-load-title" class="flex h-full flex-col rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex items-start justify-between gap-4 pb-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h3 id="overview-load-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">Assessor load</h3>
          <!-- Only timelines whose open step is the assessors' step count here. -->
          <p class="m-0 text-(length:--fs-13) text-(--text-3)">{{ scope() }}</p>
        </div>
        <a hlmBtn qaBtn tone="link" size="sm" routerLink="/assessors" class="-mr-2.5 flex-none">Open Assessors</a>
      </div>

      <ul class="m-0 flex list-none flex-col p-0">
        @for (a of rows(); track a.name) {
          <li class="grid grid-cols-[8.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 py-1.5">
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-(length:--fs-13) text-(--text-2)">{{ a.name }}</span>
              @if (a.neverSignedIn) {
                <span class="text-(length:--fs-11) font-semibold text-(--danger)">Never signed in</span>
              }
            </span>
            <span class="flex h-3.5 gap-0.5" [style.width.%]="a.width" [attr.aria-label]="a.name + ': ' + a.done + ' assessed, ' + a.left + ' still to assess'" role="img">
              @if (a.done > 0) {
                <span class="h-full rounded-[3px] bg-(--primary)" [style.flex-grow]="a.done" [title]="a.done + ' assessed'"></span>
              }
              <span class="h-full rounded-[3px] bg-(--tint-4)" [style.flex-grow]="a.left" [title]="a.left + ' still to assess'"></span>
            </span>
            <span class="text-right text-(length:--fs-12) whitespace-nowrap text-(--text-3)"><b class="text-(length:--fs-13) tabular-nums text-(--text)">{{ a.left }}</b> left</span>
          </li>
        }
      </ul>

      <div class="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-3 text-(length:--fs-12) text-(--text-3)">
        <span class="inline-flex items-center gap-1.5"><i class="inline-block size-2.5 rounded-[3px] bg-(--primary)"></i>Assessed</span>
        <span class="inline-flex items-center gap-1.5"><i class="inline-block size-2.5 rounded-[3px] bg-(--tint-4)"></i>Still to assess</span>
      </div>
    </section>
  `,
})
export class OvAssessorLoad {
  readonly load = input.required<readonly AssessorLoad[]>();
  /** "Timelines in the assessors' step: July 2026 sub-timeline, SP03 late reporting". */
  readonly scope = input.required<string>();

  /** Bars share one scale (the busiest assessor fills the track), most pending first. */
  protected readonly rows = computed(() => {
    const max = Math.max(1, ...this.load().map((a) => a.done + a.left));
    return [...this.load()].sort((a, b) => b.left - a.left).map((a) => ({ ...a, width: ((a.done + a.left) / max) * 100 }));
  });
}
