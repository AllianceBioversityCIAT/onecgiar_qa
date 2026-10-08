import { Component, computed, input, linkedSignal, model, output } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { QaDrawerImports, QaMultiSelect, QaSelect, QaSelectOption, QaTooltipImports } from '../../../ui';
import { PROGRAMS, RESULT_TYPES, Timeline } from './cycle.mock';
import { formatNumber, loadSummary, runTargets } from './cycle.logic';

/** What opens the load drawer: the page button, a timeline menu ("Add results…") or a step. */
export interface RunRequest {
  target: string;
  types: readonly string[];
  programs: readonly string[];
  /** Opened from a step drawer ("Load results into this step"): shows the "From step" tag. */
  fromStep: boolean;
  /** Timeline name when opened from "Add results to this timeline". */
  addTo: string | null;
}

export const PROGRAM_OPTIONS = Object.entries(PROGRAMS).map(([value, name]) => ({ value, label: `${value} ${name}` }));
export const TYPE_OPTIONS = RESULT_TYPES.map(([t]) => ({ value: t, label: t }));

/** "Load results into QA" / "Add results to <timeline>" drawer with the live estimate. */
@Component({
  selector: 'qa-cycle-load-drawer',
  imports: [HlmButton, QaDrawerImports, QaSelect, QaTooltipImports, QaMultiSelect],
  template: `
    <qa-drawer [(open)]="open" [title]="title()" [subtitle]="subtitle()" width="720px">
      @if (open()) {
        <div class="flex flex-col items-start gap-[6px]">
          <div class="flex items-center gap-1">
            <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Target step</span>
            <button type="button" qaTooltip="Results land in this step and follow the timeline from there." aria-label="More about Target step" class="flex size-4 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-(--text-muted) outline-none hover:text-(--primary) focus-visible:shadow-(--focus-ring)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" /></svg></button>
            @if (fromStep()) {
              <span class="ml-1 rounded-full bg-(--tint-2) px-1.5 py-px text-(length:--fs-10) font-semibold whitespace-nowrap text-(--accent)">From step</span>
            }
          </div>
          <qa-select [(value)]="target" [options]="targetOptions()" label="Target step" placeholder="Select a step" panelWidth="440px" class="w-[420px]" />
        </div>
        <div class="flex flex-col items-start gap-[6px]">
          <label for="cycle-load-types" class="text-(length:--fs-13) font-semibold text-(--text-2)">Result types</label>
          <qa-multi-select triggerId="cycle-load-types" [(value)]="types" [options]="typeOptions" label="Result types" placeholder="All result types" searchPlaceholder="Search result types" appearance="field" summaryMax="99" panelWidth="300px" listMaxHeight="260px" />
        </div>
        <div class="flex flex-col items-start gap-[6px]">
          <label for="cycle-load-programs" class="text-(length:--fs-13) font-semibold text-(--text-2)">Science programs</label>
          <qa-multi-select triggerId="cycle-load-programs" [(value)]="programs" [options]="programOptions" label="Science programs" placeholder="All programs" searchPlaceholder="Search programs" appearance="field" summaryMax="99" panelWidth="300px" listMaxHeight="260px" />
        </div>
        <div class="flex items-start gap-[10px] rounded-[8px] bg-(--st-submitted-bg) px-[14px] py-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--st-submitted-fg)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="mt-[2px] flex-none" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" /></svg>
          <span class="text-(length:--fs-13) leading-[1.55] font-normal text-pretty text-(--st-submitted-fg)">Only results already submitted by a science program can be pulled into QA. Results still being edited are skipped, even if they match the filters.</span>
        </div>
        @let s = summary();
        <div aria-live="polite" class="rounded-[8px] bg-(--surface-3) px-[14px] py-3 text-(length:--fs-13) leading-[1.55] font-normal text-(--text-2)">
          <span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ fmt(s.matched) }}</span> submitted results match. <span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ fmt(s.already) }}</span> are already in QA and will be skipped. <span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ fmt(s.pulled) }}</span> will be pulled in.
          @if (s.notFirst) {
            <br />Knowledge products that were approved automatically are not pulled in again.
          }
          @for (j of s.joins; track j.what) {
            <br /><span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ j.n }}</span> {{ j.what }} join at {{ j.step }} instead.
          }
          @for (a of s.autos; track a.what) {
            <br /><span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ a.n }}</span> {{ a.what }} are auto-approved and will enter with the status Automatic.
          }
        </div>
      }
      <div qaDrawerFooter class="contents">
        <button hlmBtn variant="ghost" type="button" (click)="open.set(false)" class="h-9 rounded-[8px] border border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium text-(--text-2) hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:border-(--border) focus-visible:ring-0 focus-visible:shadow-(--focus-ring) dark:hover:bg-(--surface-2)">Cancel</button>
        <button hlmBtn type="button" [disabled]="!target()" (click)="submit()" class="h-9 rounded-[8px] bg-(--primary) px-[14px] text-(length:--fs-14) font-semibold text-(--surface) hover:bg-(--accent) focus-visible:border-transparent focus-visible:ring-0 focus-visible:shadow-(--focus-ring)">Load results</button>
      </div>
    </qa-drawer>
  `,
})
export class LoadDrawer {
  readonly open = model(false);
  readonly request = input.required<RunRequest>();
  readonly timelines = input.required<readonly Timeline[]>();
  readonly official = input.required<Timeline>();
  /** Emits how many submitted results the load matches (drives the "Loading results" counter). */
  readonly load = output<number>();

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly programOptions = PROGRAM_OPTIONS;
  protected readonly fmt = formatNumber;

  protected readonly target = linkedSignal<string | null>(() => this.request().target);
  protected readonly types = linkedSignal<readonly string[]>(() => [...this.request().types]);
  protected readonly programs = linkedSignal<readonly string[]>(() => [...this.request().programs]);

  protected readonly title = computed(() => {
    const addTo = this.request().addTo;
    return addTo ? `Add results to ${addTo}` : 'Load results into QA';
  });
  protected readonly subtitle = computed(() =>
    this.request().addTo
      ? 'Late submissions join the timeline in its current step.'
      : 'Brings in results that science programs have submitted. Results already in QA are not affected.',
  );
  protected readonly fromStep = computed(() => this.request().fromStep && this.target() === this.request().target);

  private readonly targets = computed(() => runTargets(this.request().target, this.timelines()));
  protected readonly targetOptions = computed<QaSelectOption[]>(() =>
    this.targets().map((t) => ({ value: t.id, label: t.label, description: t.desc })),
  );
  protected readonly summary = computed(() =>
    loadSummary(this.types(), this.programs(), this.target(), this.targets(), this.official()),
  );

  protected submit(): void {
    // TODO(api): POST the load (target step, result types, programs); progress comes from the server.
    this.load.emit(this.summary().matched);
    this.open.set(false);
  }
}
