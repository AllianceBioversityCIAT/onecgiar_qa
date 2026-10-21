import { Component, input, output } from '@angular/core';
import { QaButtonImports } from '../../../ui';
import { TimelineStatus } from './overview.mock';

export type LaneStepState = 'done' | 'active' | 'future';

export interface TimelineLaneVm {
  readonly id: string;
  readonly name: string;
  /** "Official timeline" / "Sub-timeline". */
  readonly kind: string;
  readonly status: TimelineStatus;
  readonly results: string;
  readonly steps: readonly { readonly name: string; readonly state: LaneStepState }[];
  /** "Step 5 of 5: QA platform open for PPU". */
  readonly stepText: string;
  /** "closes today" / "opens 01 Sep". */
  readonly whenText: string;
  /** Progress of the open step, or null when no step is open yet. */
  readonly progress: { readonly done: string; readonly of: string; readonly pct: number } | null;
  readonly highlighted: boolean;
}

const STATUS_CHIP: Record<TimelineStatus, string> = {
  Live: 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  Scheduled: 'bg-(--st-submitted-bg) text-(--st-submitted-fg)',
  Closed: 'bg-(--surface-3) text-(--text-muted)',
};

/** One lane per open timeline: where each one is in its own steps and how far the open step has gone. */
@Component({
  selector: 'qa-ov-timeline-lanes',
  imports: [QaButtonImports],
  host: { class: 'block @container' },
  template: `
    <!-- Same card as the other Overview sections: title inside, lanes as full-width rows below it. -->
    <section aria-labelledby="overview-lanes-title" class="flex flex-col gap-4 overflow-hidden rounded-[12px] border border-(--border) bg-(--surface) pt-5">
      <h3 id="overview-lanes-title" class="m-0 px-5 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">Timelines</h3>

      <ol class="m-0 flex list-none flex-col p-0">
        @for (lane of lanes(); track lane.id) {
          <li
            [id]="'lane-' + lane.id"
            class="grid scroll-mt-6 grid-cols-1 items-center gap-x-6 gap-y-3 border-t border-(--surface-4) px-5 py-4 transition-colors duration-500 first:border-t-0 @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1fr)]"
            [class.bg-(--tint)]="lane.highlighted"
          >
            <!-- Who -->
            <div class="flex min-w-0 items-stretch gap-3">
              <span aria-hidden="true" class="w-1 flex-none rounded-full" [class]="lane.status === 'Live' ? 'bg-(--primary)' : 'bg-(--surface-4)'"></span>
              <div class="flex min-w-0 flex-col gap-1">
                <span class="truncate text-(length:--fs-15) font-semibold text-(--text)">{{ lane.name }}</span>
                <span class="flex flex-wrap items-center gap-2 text-(length:--fs-12) text-(--text-4)">
                  <span class="rounded-full px-2 py-[2px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="chip[lane.status]">{{ lane.status }}</span>
                  <span>{{ lane.kind }},</span>
                  <span><span class="font-semibold tabular-nums text-(--text-2)">{{ lane.results }}</span> results</span>
                </span>
              </div>
            </div>

            <!-- Where: the timeline's own steps -->
            <div class="flex min-w-0 flex-col gap-2">
              <ol class="m-0 flex list-none items-center p-0" [attr.aria-label]="lane.name + ' steps'">
                @for (step of lane.steps; track $index; let last = $last) {
                  <li class="flex items-center" [class.flex-1]="!last" [attr.aria-current]="step.state === 'active' ? 'step' : null">
                    <span
                      class="flex size-[14px] flex-none items-center justify-center rounded-full border-2"
                      [class]="dot[step.state]"
                      [title]="'Step ' + ($index + 1) + ': ' + step.name"
                    >
                      <span class="sr-only">Step {{ $index + 1 }}: {{ step.name }} ({{ stateText[step.state] }})</span>
                    </span>
                    @if (!last) {
                      <span aria-hidden="true" class="mx-1 h-[2px] flex-1 rounded-full" [class]="step.state === 'done' ? 'bg-(--primary)' : 'bg-(--surface-4)'"></span>
                    }
                  </li>
                }
              </ol>
              <span class="text-(length:--fs-13) text-pretty text-(--text-3)">
                <span class="font-medium text-(--text-2)">{{ lane.stepText }}</span>, {{ lane.whenText }}
              </span>
            </div>

            <!-- How far: the open step -->
            <div class="flex min-w-0 flex-col gap-2">
              @if (lane.progress; as p) {
                <span class="flex flex-wrap items-baseline gap-x-2">
                  <span class="text-(length:--fs-16) font-bold tabular-nums text-(--text)">{{ p.pct }}%</span>
                  <span class="text-(length:--fs-12) text-(--text-4)"><span class="tabular-nums">{{ p.done }} of {{ p.of }}</span> reviewed</span>
                </span>
                <div class="h-2 overflow-hidden rounded-full bg-(--surface-4)" role="progressbar" [attr.aria-label]="lane.name + ': reviewed in the open step'" [attr.aria-valuenow]="p.pct" aria-valuemin="0" aria-valuemax="100">
                  <div class="h-full rounded-full bg-(--primary)" [style.width.%]="p.pct"></div>
                </div>
              } @else {
                <span class="text-(length:--fs-13) text-(--text-muted)">Not started yet</span>
              }
              <button
                hlmBtn
                qaBtn
                tone="link"
                size="sm"
                flush="start"
                type="button"
                (click)="viewStages.emit(lane.id)"
                [attr.aria-label]="'View stages of ' + lane.name"
                class="self-start"
              >
                View stages
              </button>
            </div>
          </li>
        }
      </ol>
    </section>
  `,
})
export class OvTimelineLanes {
  readonly lanes = input.required<readonly TimelineLaneVm[]>();
  /** Timeline id whose stages pop-up should open. */
  readonly viewStages = output<string>();

  protected readonly chip = STATUS_CHIP;
  protected readonly dot: Record<LaneStepState, string> = {
    done: 'border-(--primary) bg-(--primary)',
    active: 'border-(--primary) bg-(--surface) shadow-[0_0_0_4px_var(--tint-2)]',
    future: 'border-(--border-strong) bg-(--surface)',
  };
  protected readonly stateText: Record<LaneStepState, string> = { done: 'done', active: 'open now', future: 'not started' };
}
