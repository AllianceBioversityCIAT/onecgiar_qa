import { Component, computed, effect, model, output, signal, untracked } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { QaDrawerImports, QaMultiSelect, QaSelect, QaSelectOption, QaTooltipImports } from '../../../ui';
import { fmt, loadEstimate } from './overview-calc';
import { LOAD_TARGETS, PROGRAMS, RESULT_TYPES } from './overview.mock';

/** "Load results into QA": target step, filters and a live estimate of what will be pulled in. */
@Component({
  selector: 'qa-ov-load-drawer',
  imports: [HlmButton, QaDrawerImports, QaSelect, QaTooltipImports, QaMultiSelect],
  host: { class: 'contents' },
  template: `
    <qa-drawer
      [(open)]="open"
      title="Load results into QA"
      subtitle="Brings in results that science programs have submitted. Results already in QA are not affected."
      width="720px"
    >
      @if (open()) {
        <!-- Target step -->
        <div class="flex flex-col items-start gap-[6px]">
          <div class="flex items-center gap-1">
            <span id="overview-load-target-label" class="text-(length:--fs-13) font-semibold text-(--text-2)">Target step</span>
            <button
              type="button"
              qaTooltip="Results land in this step and follow the timeline from there."
              aria-label="More about Target step"
              class="flex size-4 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-(--text-muted) hover:text-(--primary) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01"></path></svg>
            </button>
          </div>
          <qa-select [(value)]="target" [options]="targetOptions" label="Target step" placeholder="Select a step" class="w-[420px] max-w-full" />
        </div>

        <div class="flex flex-col items-start gap-[6px]">
          <span id="overview-load-types-label" class="text-(length:--fs-13) font-semibold text-(--text-2)">Result types</span>
          <qa-multi-select
            appearance="field"
            [(value)]="types"
            [options]="typeOptions"
            label="Result types"
            placeholder="All result types"
            searchPlaceholder="Search result types"
            panelWidth="300px"
            listMaxHeight="240px"
            sideOffset="6"
            class="max-sm:w-full"
          />
        </div>
        <div class="flex flex-col items-start gap-[6px]">
          <span id="overview-load-programs-label" class="text-(length:--fs-13) font-semibold text-(--text-2)">Science programs</span>
          <qa-multi-select
            appearance="field"
            [(value)]="programs"
            [options]="programOptions"
            label="Science programs"
            placeholder="All programs"
            searchPlaceholder="Search programs"
            panelWidth="300px"
            listMaxHeight="240px"
            sideOffset="6"
            class="max-sm:w-full"
          />
        </div>

        <!-- Rule -->
        <div class="flex items-start gap-[10px] rounded-[8px] bg-(--st-submitted-bg) px-[14px] py-3">
          <svg class="mt-[2px] flex-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--st-submitted-fg)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01"></path></svg>
          <span class="text-(length:--fs-13) leading-[1.55] font-normal text-pretty text-(--st-submitted-fg)">Only results already submitted by a science program can be pulled into QA. Results still being edited are skipped, even if they match the filters.</span>
        </div>

        <!-- Live estimate -->
        @let e = estimate();
        <div aria-live="polite" class="rounded-[8px] bg-(--surface-3) px-[14px] py-3 text-(length:--fs-13) leading-[1.55] font-normal text-(--text-2)">
          <span class="font-(family-name:--qa-mono) font-semibold tabular-nums text-(--text)">{{ n(e.matched) }}</span> submitted results match.
          <span class="font-(family-name:--qa-mono) font-semibold tabular-nums text-(--text)">{{ n(e.already) }}</span> are already in QA and will be skipped.
          <span class="font-(family-name:--qa-mono) font-semibold tabular-nums text-(--text)">{{ n(e.pulled) }}</span> will be pulled in.
          @if (e.notFirst) {
            <br />Knowledge products that were approved automatically are not pulled in again.
          }
          @for (j of e.joins; track j.what) {
            <br /><span class="font-(family-name:--qa-mono) font-semibold tabular-nums text-(--text)">{{ j.n }}</span> {{ j.what }} join at {{ j.phase }} instead.
          }
          @for (a of e.autos; track a.what) {
            <br /><span class="font-(family-name:--qa-mono) font-semibold tabular-nums text-(--text)">{{ a.n }}</span> {{ a.what }} are auto-approved and will enter with the status Automatic.
          }
        </div>
      }

      <div qaDrawerFooter class="contents">
        <button
          hlmBtn
          variant="outline"
          type="button"
          (click)="open.set(false)"
          class="h-auto min-h-9 rounded-[8px] border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium text-(--text-2) shadow-none hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:shadow-(--focus-ring) focus-visible:ring-0"
        >Cancel</button>
        <button
          hlmBtn
          type="button"
          [disabled]="!target()"
          (click)="submit()"
          class="h-auto min-h-9 rounded-[8px] border-0 bg-(--primary) px-[14px] text-(length:--fs-14) font-semibold text-(--surface) hover:bg-(--accent) focus-visible:shadow-(--focus-ring) focus-visible:ring-0"
        >Load results</button>
      </div>
    </qa-drawer>
  `,
})
export class OvLoadDrawer {
  readonly open = model(false);
  /** Emits the number of matching results when the user confirms (the view runs the load). */
  readonly load = output<number>();

  protected readonly target = signal<string | null>(LOAD_TARGETS[0].id);
  protected readonly types = signal<readonly string[]>([]);
  protected readonly programs = signal<readonly string[]>([]);

  protected readonly targetOptions: readonly QaSelectOption[] = LOAD_TARGETS.map((t) => ({ value: t.id, label: t.label, description: t.desc }));
  protected readonly typeOptions = RESULT_TYPES.map(([t]) => ({ value: t, label: t }));
  protected readonly programOptions = Object.entries(PROGRAMS).map(([code, name]) => ({ value: code, label: code + ' ' + name }));

  protected readonly estimate = computed(() => loadEstimate(this.target() ?? '', this.types(), this.programs()));
  protected readonly n = fmt;

  constructor() {
    // Every time the drawer opens it starts from the defaults, as in the mockup.
    effect(() => {
      if (this.open()) {
        untracked(() => {
          this.target.set(LOAD_TARGETS[0].id);
          this.types.set([]);
          this.programs.set([]);
        });
      }
    });
  }

  protected submit(): void {
    if (!this.target()) return;
    // TODO(api): POST the load request (target step, result types, programs) to the QA API.
    this.load.emit(this.estimate().matched);
    this.open.set(false);
  }
}
