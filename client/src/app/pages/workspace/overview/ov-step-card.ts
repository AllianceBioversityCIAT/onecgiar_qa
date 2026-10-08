import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan/button';

export interface StepCardVm {
  readonly eyebrow: string;
  readonly audience: string;
  readonly dates: string;
  readonly tailPre: string;
  readonly tailNum: string;
  readonly tailPost: string;
  /** "1,047 of 1,114". */
  readonly big: string;
  readonly pct: number;
  /** False when the step has not opened yet (nothing to show in View progress). */
  readonly canOpen: boolean;
}

/** Current step of the selected timeline, with its progress and "View progress". */
@Component({
  selector: 'qa-ov-step-card',
  imports: [HlmButton, RouterLink],
  host: { class: 'block' },
  template: `
    <section aria-label="Current step" class="flex flex-col gap-[14px] rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex flex-wrap items-center gap-6">
        <div class="flex min-w-[240px] flex-1 flex-col gap-[6px] max-sm:min-w-0">
          <div class="text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">{{ card().eyebrow }}</div>
          <div class="text-(length:--fs-18) font-bold tracking-[-0.01em] text-(--text)">{{ card().audience }}</div>
          <div class="text-(length:--fs-13) font-normal text-(--text-3)">
            <span class="font-(family-name:--qa-mono) font-semibold tabular-nums text-(--text-2)">{{ card().dates }}</span> · {{ card().tailPre
            }}<span class="font-(family-name:--qa-mono) font-semibold tabular-nums text-(--text-2)">{{ card().tailNum }}</span>{{ card().tailPost }}
          </div>
        </div>
        <div class="flex min-w-[280px] flex-none flex-col items-stretch gap-2 max-sm:min-w-0 max-sm:flex-1">
          <div class="flex items-baseline gap-2">
            <span class="text-(length:--fs-20) font-bold tracking-[-0.01em] tabular-nums text-(--text)">{{ card().big }}</span>
            <span class="text-(length:--fs-13) font-normal text-(--text-3)">reviewed</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-(--surface-4)" role="progressbar" aria-label="Reviewed in this step" [attr.aria-valuenow]="card().pct" aria-valuemin="0" aria-valuemax="100">
            <div class="h-full rounded-full bg-(--primary) transition-[width] duration-200" [style.width.%]="card().pct"></div>
          </div>
          <button
            hlmBtn
            variant="outline"
            type="button"
            [disabled]="!card().canOpen"
            (click)="viewProgress.emit()"
            class="h-auto min-h-8 self-start rounded-[8px] border-(--border) bg-(--field-bg) px-3 text-(length:--fs-13) font-medium text-(--text-2) shadow-none hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:shadow-(--focus-ring) focus-visible:ring-0"
          >View progress</button>
        </div>
      </div>
      <div class="mt-4 w-full self-stretch border-t border-(--surface-4) pt-[14px]">
        <div class="flex flex-wrap items-center">
          <a hlmBtn variant="ghost" routerLink="/cycle" class="-ml-[10px] h-auto min-h-8 rounded-[8px] border-0 px-[10px] text-(length:--fs-13) font-medium text-(--accent) no-underline hover:bg-(--tint) hover:text-(--accent) focus-visible:shadow-(--focus-ring) focus-visible:ring-0">See the full cycle</a>
          @if (subsLiveText(); as text) {
            <span aria-hidden="true" class="mx-3 h-[14px] w-px bg-(--border)"></span>
            <button hlmBtn variant="ghost" type="button" (click)="openSubs.emit()" class="-ml-[10px] h-auto min-h-8 rounded-[8px] border-0 px-[10px] text-(length:--fs-13) font-medium text-(--accent) hover:bg-(--tint) hover:text-(--accent) focus-visible:shadow-(--focus-ring) focus-visible:ring-0">{{ text }}</button>
          }
        </div>
      </div>
    </section>
  `,
})
export class OvStepCard {
  readonly card = input.required<StepCardVm>();
  /** "1 sub-timeline is also live" (only for All timelines), or null. */
  readonly subsLiveText = input<string | null>(null);
  readonly viewProgress = output();
  readonly openSubs = output();
}
