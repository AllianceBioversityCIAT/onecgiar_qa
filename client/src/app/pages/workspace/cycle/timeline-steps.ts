import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { QaProgress } from '../../../ui';
import { TimelineVM } from './cycle.logic';

/**
 * Body of a timeline card: QA round band, rail with one node per step and the step cards.
 * Below 1000px of card width the rail hides and the cards wrap (3, 2, then 1 column),
 * showing a small state dot instead, as in the mockup.
 */
@Component({
  selector: 'qa-cycle-timeline-steps',
  imports: [NgTemplateOutlet, QaProgress],
  host: { class: 'block' },
  template: `
    @let t = timeline();
    <div
      class="overflow-x-hidden p-5 @container"
      [style.--n]="cols().n"
      [style.--n3]="cols().n3"
      [style.--n2]="cols().n2"
    >
      <!-- Round band -->
      <div class="mb-[6px] hidden h-6 grid-cols-[repeat(var(--n),minmax(0,1fr))] gap-3 @min-[1000px]:grid">
        @for (r of t.rounds; track $index) {
          <div class="flex min-w-0 items-center gap-2" [style.grid-column]="'span ' + r.span">
            <span
              class="text-(length:--fs-11) font-semibold tracking-[0.08em] whitespace-nowrap uppercase"
              [class]="r.on ? 'text-(--accent)' : 'text-(--text-muted)'"
            >{{ r.label }}</span>
          </div>
        }
      </div>
      <!-- Rail -->
      <div class="relative hidden h-[34px] @min-[1000px]:block" aria-hidden="true">
        <div
          class="absolute top-2 right-[9px] left-[9px] h-[2px] rounded-full"
          [class]="t.closed ? 'bg-(--border-strong)' : 'bg-(--surface-4)'"
        ></div>
        @if (t.progressWidth) {
          <div class="absolute top-2 left-[9px] h-[2px] rounded-full bg-(--primary)" [style.width]="t.progressWidth"></div>
        }
        <div class="absolute inset-0 grid grid-cols-[repeat(var(--n),minmax(0,1fr))] gap-3">
          @for (kind of t.rail; track $index) {
            <div class="relative flex flex-col items-start">
              @switch (kind) {
                @case ('done') {
                  <div
                    class="relative z-[2] flex size-[18px] flex-none items-center justify-center rounded-full"
                    [class]="t.closed ? 'bg-(--border-strong)' : 'bg-(--primary)'"
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-7" stroke="var(--surface)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  </div>
                }
                @case ('active') {
                  <div class="relative z-[2] flex size-[18px] flex-none items-center justify-center rounded-full bg-(--primary) shadow-[0_0_0_3px_var(--surface),0_0_0_5px_var(--primary)]"></div>
                }
                @default {
                  <div class="relative z-[2] size-[18px] flex-none rounded-full border-2 border-(--border-strong) bg-(--surface)"></div>
                }
              }
              <div
                class="relative z-[1] ml-2 h-2 w-px flex-none"
                [class]="t.closed ? 'bg-(--border-soft)' : 'bg-(--border)'"
              ></div>
            </div>
          }
        </div>
      </div>
      <!-- Step cards: the whole card opens the step drawer through a stretched button on its title -->
      <ol
        class="m-0 grid list-none grid-cols-1 gap-3 p-0 @min-[480px]:grid-cols-[repeat(var(--n2),minmax(0,1fr))] @min-[700px]:grid-cols-[repeat(var(--n3),minmax(0,1fr))] @min-[1000px]:grid-cols-[repeat(var(--n),minmax(0,1fr))]"
      >
        @for (s of t.steps; track $index) {
          <li
            class="relative flex min-h-[164px] min-w-0 flex-col gap-2 rounded-[10px] border p-[14px] text-left hover:border-(--border-strong) has-[[data-step-open]:focus-visible]:shadow-(--focus-ring)"
            [class]="s.state === 'active' ? 'border-(--border-accent) bg-(--surface) shadow-(--shadow-seg)' : 'border-(--border) bg-(--surface-2)'"
            [attr.aria-current]="s.state === 'active' ? 'step' : null"
          >
            <!-- State dot, only when the rail is hidden (narrow cards) -->
            @switch (s.state) {
              @case ('done') {
                <span aria-hidden="true" class="absolute top-[14px] right-[14px] flex size-[14px] items-center justify-center rounded-full bg-(--primary) @min-[1000px]:hidden">
                  <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-7" stroke="var(--surface)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </span>
              }
              @case ('active') {
                <span aria-hidden="true" class="absolute top-[14px] right-[14px] box-border size-[14px] rounded-full bg-(--primary) shadow-[0_0_0_2px_var(--surface),0_0_0_3.5px_var(--primary)] @min-[1000px]:hidden"></span>
              }
              @default {
                <span aria-hidden="true" class="absolute top-[14px] right-[14px] box-border size-[14px] rounded-full border-2 border-(--border-strong) bg-(--surface) @min-[1000px]:hidden"></span>
              }
            }
            <div class="text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">Step {{ s.n }}</div>
            <button
              type="button"
              data-step-open
              [title]="s.name"
              [attr.aria-label]="'Step ' + s.n + ': ' + s.name"
              (click)="openStep.emit($index)"
              class="cursor-pointer border-0 bg-transparent p-0 text-left outline-none after:absolute after:inset-0 after:rounded-[10px]"
            >
              <span class="line-clamp-3 text-(length:--fs-14) leading-[1.3] font-semibold text-pretty text-(--text)">{{ s.name }}</span>
            </button>
            <div class="font-(family-name:--qa-mono) text-(length:--fs-12) font-medium text-(--text-4) tabular-nums">{{ s.dates }}</div>
            @if (s.hasBatch) {
              <span class="inline-flex items-center gap-1 self-start rounded-full bg-(--tint-2) px-1.5 py-px text-(length:--fs-10) font-semibold whitespace-nowrap text-(--accent)"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M12 3v12M8 11l4 4 4-4M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" /></svg>Loads results</span>
            }
            @if (s.joinText) {
              <span [title]="s.joinTitle" class="-mt-1 text-(length:--fs-12) font-normal text-(--text-4)">{{ s.joinText }}</span>
            }
            <div class="mt-auto flex flex-col items-start gap-1.5 border-t border-(--surface-4) pt-[10px]">
              @switch (s.state) {
                @case ('done') {
                  <span class="rounded-full bg-(--surface-4) px-2 py-[2px] text-(length:--fs-11) font-semibold text-(--text-4)">Completed</span>
                  <span class="text-(length:--fs-12) text-(--text-4)">{{ s.doneText }}</span>
                  @if (s.syncText) {
                    <ng-container [ngTemplateOutlet]="sync" [ngTemplateOutletContext]="{ $implicit: s.syncText }" />
                  }
                }
                @case ('active') {
                  <qa-progress [value]="s.pct" [max]="100" [attr.aria-label]="'Step ' + s.n + ' reviewed'" />
                  <span class="text-(length:--fs-12) text-(--text-3)"><span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ s.reviewed }}</span> of <span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ s.of }}</span> reviewed</span>
                  @if (s.syncText) {
                    <ng-container [ngTemplateOutlet]="sync" [ngTemplateOutletContext]="{ $implicit: s.syncText }" />
                  }
                  <button
                    type="button"
                    (click)="viewProgress.emit($index)"
                    class="relative z-10 -mt-[2px] flex min-h-6 cursor-pointer items-center rounded-[6px] border-0 bg-transparent p-0 text-left text-(length:--fs-12) font-semibold text-(--accent) outline-none hover:text-(--accent-strong) focus-visible:shadow-(--focus-ring)"
                  >View progress</button>
                }
                @default {
                  <span class="text-(length:--fs-12) text-(--text-muted)">Opens in <span class="font-(family-name:--qa-mono) tabular-nums">{{ s.days }}</span> {{ s.dayWord }}</span>
                }
              }
            </div>
          </li>
        }
      </ol>
    </div>

    <ng-template #sync let-text>
      <span class="inline-flex items-center gap-[5px] text-(length:--fs-12) font-normal text-(--text-4)"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" /></svg>{{ text }}</span>
    </ng-template>
  `,
})
export class TimelineSteps {
  readonly timeline = input.required<TimelineVM>();
  /** Index of the clicked step card. */
  readonly openStep = output<number>();
  readonly viewProgress = output<number>();

  protected readonly cols = computed(() => {
    const n = Math.max(1, this.timeline().stepCount);
    return { n, n3: Math.min(3, n), n2: Math.min(2, n) };
  });
}
