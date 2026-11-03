import { Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaButtonImports } from '../../../ui';

export type LaneStepState = 'done' | 'active' | 'future';

export interface LaneStepVm {
  readonly state: LaneStepState;
  /** "Third-party broker", under the bar (no number: it differs across timelines). */
  readonly label: string;
  /** "QA platform open for third-party broker", on hover. */
  readonly title: string;
}

export interface TimelineLaneVm {
  readonly id: string;
  readonly name: string;
  /** ["Main batch", "All programs", "989 results"]: shown with " · " between them, each part kept on one line. */
  readonly meta: readonly string[];
  readonly scheduled: boolean;
  /** One entry per step of this timeline (each timeline has its own steps). */
  readonly steps: readonly LaneStepVm[];
  /** Number of the open step (1-based), or null when no step is open. */
  readonly step: number | null;
  /** "Closes 23 Jul (4 days left)" / "Starts 01 Sep". */
  readonly whenText: string;
  /** Progress of the open step, or null when no step is open yet. */
  readonly progress: { readonly done: string; readonly of: string; readonly pct: number } | null;
}

/** Rows shown before "Show all". */
const VISIBLE = 5;

/** Track of each step: finished (light tint), open (outlined, filled by its progress) or not started (grey). */
const TRACK_CLASS: Record<LaneStepState, string> = {
  done: 'bg-(--tint-2)',
  active: 'bg-(--tint) shadow-[inset_0_0_0_1.5px_var(--primary)]',
  future: 'bg-(--surface-4)',
};
const LABEL_CLASS: Record<LaneStepState, string> = {
  done: 'text-(--text-3)',
  active: 'font-bold text-(--accent)',
  future: 'text-(--text-muted)',
};

/**
 * "Timeline progress": one row per open or scheduled timeline, so the block reads the same with 1 timeline or with 10.
 * The page's filters can hide timelines; the count then reads "1 of 5" so it is clear the others are filtered out.
 * Each row is one bar with the timeline's steps named under it; the open step says "Now · 88%" and fills up as its results get done.
 */
@Component({
  selector: 'qa-ov-timeline-lanes',
  imports: [QaButtonImports, RouterLink],
  host: { class: 'block @container' },
  template: `
    <section aria-labelledby="overview-lanes-title" class="flex flex-col overflow-hidden rounded-[12px] border border-(--border) bg-(--surface)">
      <div class="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
        <h3 id="overview-lanes-title" class="m-0 flex items-baseline gap-2 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">
          Timeline progress
          <span class="text-(length:--fs-13) font-semibold tabular-nums text-(--text-4)">{{ lanes().length < total() ? lanes().length + ' of ' + total() : lanes().length }}</span>
        </h3>
        <a hlmBtn qaBtn tone="link" size="sm" routerLink="/cycle" class="-mr-2.5">Open Cycle</a>
      </div>

      <ul class="m-0 flex list-none flex-col p-0">
        @for (l of shown(); track l.id) {
          <li class="border-t border-(--surface-4)">
            <!-- The whole row opens the stages pop-up of that timeline. -->
            <button
              type="button"
              (click)="viewStages.emit(l.id)"
              [attr.aria-label]="l.name + (l.step ? ', step ' + l.step + ' of ' + l.steps.length + ', ' + (l.progress?.pct ?? 0) + '% done' : ', not started') + ', ' + l.whenText + ': view stages'"
              class="grid w-full cursor-pointer grid-cols-1 items-center gap-3 border-0 bg-transparent px-5 py-3.5 text-left hover:bg-(--surface-2) focus-visible:shadow-(--focus-ring) focus-visible:outline-none @3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_10.5rem] @3xl:gap-7"
            >
              <span class="flex min-w-0 flex-col gap-1">
                <span class="flex items-center gap-2 text-(length:--fs-14) font-semibold text-(--text)">
                  <span class="truncate">{{ l.name }}</span>
                  @if (l.scheduled) {
                    <span class="flex-none rounded-full bg-(--st-submitted-bg) px-2 py-px text-(length:--fs-11) font-semibold text-(--st-submitted-fg)">Scheduled</span>
                  }
                </span>
                <!-- Each part stays whole ("84 results" never splits); a narrow column wraps only between parts. -->
                <span class="text-(length:--fs-12) leading-[1.4] text-(--text-muted)"
                  >@for (part of l.meta; track $index; let first = $first) {@if (!first) {<span> · </span>}<span class="whitespace-nowrap">{{ part }}</span>}</span
                >
              </span>

              <!-- One bar: the steps of this timeline side by side, each named under it. The open one is outlined, says "Now · N%" and fills up. -->
              <span class="flex min-w-0 gap-1.5 pt-[18px]" aria-hidden="true">
                @for (s of l.steps; track $index; let last = $last) {
                  <!-- The open step is a bit wider so its name fits in bold. -->
                  <span class="relative flex min-w-0 flex-col gap-1.5" [class]="s.state === 'active' ? 'flex-[1.4]' : 'flex-1'" [title]="s.title">
                    @if (s.state === 'active') {
                      <span class="absolute -top-[18px] text-(length:--fs-11) font-bold whitespace-nowrap text-(--accent)" [class]="last ? 'right-0' : 'left-0'">Now · {{ l.progress?.pct ?? 0 }}%</span>
                    }
                    <span class="relative flex h-3 items-center justify-center overflow-hidden rounded-[4px]" [class]="trackClass[s.state]">
                      @if (s.state === 'active') {
                        <span class="absolute inset-y-0 left-0 bg-(--primary)" [style.width.%]="l.progress?.pct ?? 0"></span>
                      } @else if (s.state === 'done') {
                        <svg class="text-(--primary)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
                      }
                    </span>
                    <!-- Narrow cards only name the open step (whole name, may run past its segment); wider ones name every step.
                         A name never gets cut: when its segment is narrow it wraps onto a second line. -->
                    @if (s.state === 'active') {
                      <span class="text-(length:--fs-11) leading-[1.3] whitespace-nowrap @lg:whitespace-normal" [class]="labelClass[s.state] + (last ? ' self-end text-right' : '')">{{ s.label }}</span>
                    } @else {
                      <span class="hidden text-(length:--fs-11) leading-[1.3] @lg:block" [class]="labelClass[s.state] + (last ? ' text-right' : '')">{{ s.label }}</span>
                    }
                  </span>
                }
              </span>

              <!-- What the bar can't say: how many are done in the open step, and when it closes. -->
              <span class="flex min-w-0 flex-col gap-0.5 @3xl:text-right">
                @if (l.progress; as p) {
                  <span class="text-(length:--fs-13) text-(--text-2)"><span class="font-semibold tabular-nums text-(--text)">{{ p.done }} of {{ p.of }}</span> done in this step</span>
                } @else {
                  <span class="text-(length:--fs-13) text-(--text-2)">Not started</span>
                }
                <span class="text-(length:--fs-12) leading-[1.4] whitespace-nowrap text-(--text-muted)">{{ l.whenText }}</span>
              </span>
            </button>
          </li>
        }
      </ul>

      <!-- What the three kinds of step mean (the open one fills up as its results get done). -->
      <div class="flex flex-wrap gap-x-4 gap-y-1 border-t border-(--surface-4) px-5 py-3 text-(length:--fs-12) text-(--text-3)">
        <span class="inline-flex items-center gap-1.5"><i class="inline-block h-2.5 w-3.5 rounded-[3px] bg-(--tint-2)"></i>Step finished</span>
        <span class="inline-flex items-center gap-1.5"><i class="inline-block h-2.5 w-3.5 rounded-[3px] bg-[linear-gradient(90deg,var(--primary)_55%,var(--tint)_55%)] shadow-[inset_0_0_0_1.5px_var(--primary)]"></i>Open now · fills up as results get done</span>
        <span class="inline-flex items-center gap-1.5"><i class="inline-block h-2.5 w-3.5 rounded-[3px] bg-(--surface-4)"></i>Not started</span>
      </div>

      @if (lanes().length > visible) {
        <div class="flex min-h-12 items-center justify-between gap-4 border-t border-(--surface-4) bg-(--surface-2) px-5">
          <span class="text-(length:--fs-13) text-(--text-3)">{{ open() ? 'Showing all ' + lanes().length + ' timelines' : lanes().length - visible + ' more timelines' }}</span>
          <button hlmBtn qaBtn tone="link" size="sm" type="button" class="-mr-2.5" (click)="open.set(!open())" [attr.aria-expanded]="open()">
            {{ open() ? 'Show less' : 'Show all ' + lanes().length + ' →' }}
          </button>
        </div>
      }
    </section>
  `,
})
export class OvTimelineLanes {
  readonly lanes = input.required<readonly TimelineLaneVm[]>();
  /** Timelines before the page's filters (the "of 5" in "1 of 5"). */
  readonly total = input(0);
  /** Open the stages pop-up of a timeline. */
  readonly viewStages = output<string>();

  protected readonly visible = VISIBLE;
  protected readonly trackClass = TRACK_CLASS;
  protected readonly labelClass = LABEL_CLASS;
  protected readonly open = signal(false);
  protected readonly shown = computed(() => (this.open() ? this.lanes() : this.lanes().slice(0, VISIBLE)));
}
