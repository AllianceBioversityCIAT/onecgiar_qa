import { DecimalPipe } from '@angular/common';
import { Component, computed, input, linkedSignal, model } from '@angular/core';
import { QaButtonImports, QaDrawerImports, QaMultiSelect, QaSelectImports, QaSelectOption, QaSwitch } from '../../../ui';
import { PHASE_NAMES, PHASE_SHORT } from '../overview/overview.mock';
import {
  PROGRAMS,
  PROGRAM_CODES,
  QA_STAGES,
  RESULTS,
  RESULT_STAGE_LABELS,
  RESULT_TYPES,
  TIMELINES,
  qaStage,
} from '../results/results.mock';
import { FIELD_DEFS } from '../review/review.mock';

/** What the button that opens the drawer already knows (P2-3914: "the three Export comments open the same dialog"). */
export interface ExportCommentsPreset {
  /** "Export comments" in a result's menu (Results). */
  readonly resultCode?: string;
  /** "Export comments" in a timeline's menu (Cycle). */
  readonly timelineId?: string;
  /** "Export comments" in a step's progress drawer (Cycle): index in PHASE_NAMES. */
  readonly step?: number;
}

/** Columns of the file, in order (Juanda, 2026-11-11). Shown so people know what they get before downloading. */
const COLUMN_GROUPS: readonly { readonly name: string; readonly columns: string }[] = [
  { name: 'Result', columns: 'Code, title, science program, result type, timeline, assessed by' },
  { name: 'Comment', columns: 'Field, field value when commented, author, date, status, withdrawn' },
  {
    name: 'After the comment',
    columns: 'Program’s answer, lead assessor’s highlight and instruction, third-party broker’s decision, done by PPU',
  },
];

/**
 * "Export comments" drawer (P2-3914): one .xlsx with one row per comment and every QA step after it.
 * The server builds the file and checks what each role may download; this drawer only picks the filters.
 * Opened from a result's menu (Results), a timeline's menu and a step's progress drawer (Cycle), with that scope set.
 */
@Component({
  selector: 'qa-export-comments-drawer',
  imports: [DecimalPipe, QaButtonImports, QaDrawerImports, QaMultiSelect, QaSelectImports, QaSwitch],
  host: { class: 'contents' },
  template: `
    <qa-drawer [(open)]="open" title="Export comments" subtitle="One row per comment, with its result and every QA step after it." width="480px">
      @if (open()) {
        @if (resultCode(); as code) {
          <!-- Opened from one result: that result is fixed, only fields and withdrawn comments are chosen (Juanpa, 2026-11-11). -->
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Result</span>
            <span class="font-(family-name:--qa-mono) text-(length:--fs-14) font-semibold text-(--accent) tabular-nums">{{ code }}</span>
            @if (resultTitle(); as title) {
              <span class="text-(length:--fs-13) leading-[1.5] text-pretty text-(--text-3)">{{ title }}</span>
            }
          </div>
        } @else {
          <!-- One field per row: the 480px drawer has no room for two selects side by side (min 280px each). -->
          <div class="flex min-w-0 flex-col gap-1.5">
            <label for="export-timeline" class="text-(length:--fs-13) font-semibold text-(--text-2)">Timeline</label>
            <qa-select triggerId="export-timeline" [(value)]="timeline" [options]="timelineOptions" label="Timeline" appearance="field" searchable searchPlaceholder="Search timelines" panelWidth="320px" />
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <label for="export-step" class="text-(length:--fs-13) font-semibold text-(--text-2)">Step</label>
            <qa-select triggerId="export-step" [(value)]="step" [options]="stepOptions" label="Step" appearance="field" panelWidth="320px" />
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <label for="export-programs" class="text-(length:--fs-13) font-semibold text-(--text-2)">Science programs</label>
            <qa-multi-select triggerId="export-programs" [(value)]="programs" [options]="programOptions" label="Science programs" placeholder="All programs" searchPlaceholder="Search programs" appearance="field" panelWidth="320px" />
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <label for="export-types" class="text-(length:--fs-13) font-semibold text-(--text-2)">Result types</label>
            <qa-multi-select triggerId="export-types" [(value)]="types" [options]="typeOptions" label="Result types" placeholder="All result types" [searchable]="false" appearance="field" panelWidth="320px" />
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <label for="export-stages" class="text-(length:--fs-13) font-semibold text-(--text-2)">QA stage</label>
            <qa-multi-select triggerId="export-stages" [(value)]="stages" [options]="stageOptions" label="QA stage" placeholder="All stages" [searchable]="false" appearance="field" panelWidth="320px" />
          </div>
        }
        <div class="flex min-w-0 flex-col gap-1.5">
          <label for="export-fields" class="text-(length:--fs-13) font-semibold text-(--text-2)">Fields</label>
          <qa-multi-select triggerId="export-fields" [(value)]="fields" [options]="fieldOptions" label="Fields" placeholder="All fields" searchPlaceholder="Search fields" appearance="field" panelWidth="320px" />
        </div>

        <div class="flex min-h-[52px] items-center gap-4">
          <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span id="export-withdrawn" class="text-(length:--fs-14) font-medium text-(--text-2)">Include withdrawn comments</span>
            <span id="export-withdrawn-hint" class="text-(length:--fs-13) text-pretty text-(--text-4)">They are marked as withdrawn in the file.</span>
          </div>
          <qa-switch [(checked)]="withdrawn" aria-labelledby="export-withdrawn" aria-describedby="export-withdrawn-hint" />
        </div>

        <!-- What the file will hold. TODO(api): the count comes from the export endpoint (or a count endpoint). -->
        <div aria-live="polite" class="rounded-[8px] bg-(--surface-3) px-[14px] py-3 text-(length:--fs-13) leading-[1.55] text-(--text-2)">
          @if (estimate().comments > 0) {
            About <span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ estimate().comments | number }}</span>
            {{ estimate().comments === 1 ? 'comment' : 'comments' }} from
            <span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ estimate().results | number }}</span>
            {{ estimate().results === 1 ? 'result' : 'results' }}.
          } @else {
            No comments match these filters.
          }
        </div>

        <section aria-labelledby="export-columns" class="flex flex-col gap-2">
          <h3 id="export-columns" class="m-0 text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">Columns in the file</h3>
          <dl class="m-0 flex flex-col gap-2">
            @for (g of columnGroups; track g.name) {
              <div class="flex flex-col gap-[2px]">
                <dt class="text-(length:--fs-13) font-semibold text-(--text-2)">{{ g.name }}</dt>
                <dd class="m-0 text-(length:--fs-13) leading-[1.5] text-pretty text-(--text-3)">{{ g.columns }}</dd>
              </div>
            }
          </dl>
        </section>
      }
      <div qaDrawerFooter class="contents">
        <button hlmBtn qaBtn tone="secondary" type="button" (click)="open.set(false)">Cancel</button>
        <button hlmBtn qaBtn tone="primary" type="button" [disabled]="estimate().comments === 0" (click)="download()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
          Download .xlsx
        </button>
      </div>
    </qa-drawer>
  `,
})
export class ExportCommentsDrawer {
  readonly open = model(false);
  readonly preset = input<ExportCommentsPreset>({});

  protected readonly timelineOptions: readonly QaSelectOption[] = [
    { value: 'all', label: 'All timelines' },
    ...TIMELINES.map((t) => ({ value: t.id, label: t.name, group: t.kind === 'Official timeline' ? 'Official timeline' : 'Sub-timelines' })),
  ];
  protected readonly stepOptions: readonly QaSelectOption[] = [
    { value: 'all', label: 'All steps' },
    ...PHASE_NAMES.map((name, i) => ({ value: String(i), label: `${i + 1}. ${PHASE_SHORT[name]}` })),
  ];
  protected readonly programOptions: readonly QaSelectOption[] = PROGRAM_CODES.map((c) => ({ value: c, label: `${c} ${PROGRAMS[c]}` }));
  protected readonly typeOptions: readonly QaSelectOption[] = RESULT_TYPES.map((t) => ({ value: t, label: t }));
  protected readonly stageOptions: readonly QaSelectOption[] = QA_STAGES.map((s) => ({ value: s, label: RESULT_STAGE_LABELS[s] }));
  protected readonly fieldOptions: readonly QaSelectOption[] = FIELD_DEFS.filter((d) => d.mode === 'core' || d.mode === 'assessed').map(
    (d) => ({ value: d.id, label: d.label }),
  );
  protected readonly columnGroups = COLUMN_GROUPS;

  // The result is fixed by the button; every time the drawer opens, the filters start again from what the button knows.
  protected readonly resultCode = computed(() => this.preset().resultCode ?? null);
  protected readonly resultTitle = computed(() => RESULTS.find((r) => r.code === this.resultCode())?.title ?? '');
  protected readonly timeline = linkedSignal<string | null>(() => (this.open() ? (this.preset().timelineId ?? 'all') : 'all'));
  protected readonly step = linkedSignal<string | null>(() => {
    const s = this.open() ? this.preset().step : undefined;
    return s == null ? 'all' : String(s);
  });
  protected readonly programs = linkedSignal<boolean, readonly string[]>({ source: this.open, computation: () => [] });
  protected readonly types = linkedSignal<boolean, readonly string[]>({ source: this.open, computation: () => [] });
  protected readonly stages = linkedSignal<boolean, readonly string[]>({ source: this.open, computation: () => [] });
  protected readonly fields = linkedSignal<boolean, readonly string[]>({ source: this.open, computation: () => [] });
  protected readonly withdrawn = linkedSignal<boolean, boolean>({ source: this.open, computation: () => false });

  /** Mock estimate from the Results rows (the step filter is not modelled in the mock). */
  protected readonly estimate = computed(() => {
    const code = this.resultCode();
    const tl = TIMELINES.find((t) => t.id === this.timeline());
    const programs = this.programs();
    const types = this.types();
    const stages = this.stages();
    const rows = RESULTS.filter((r) => {
      if (!r.comments) return false;
      if (code) return r.code === code;
      if (tl && r.batch !== tl.name) return false;
      if (programs.length && !programs.includes(r.program)) return false;
      if (types.length && !types.includes(r.type)) return false;
      if (stages.length && !stages.includes(qaStage(r) ?? '')) return false;
      return true;
    });
    const share = this.fields().length ? Math.min(1, this.fields().length / this.fieldOptions.length) : 1;
    const comments = Math.round(rows.reduce((n, r) => n + (r.comments?.[1] ?? 0), 0) * share * (this.withdrawn() ? 1.08 : 1));
    return { results: rows.length, comments: rows.length ? Math.max(comments, 1) : 0 };
  });

  protected download(): void {
    // TODO(api): ask the export endpoint (P2-3914) for the .xlsx with these filters and download it:
    // resultCode(), timeline(), step(), programs(), types(), stages(), fields(), withdrawn().
    this.open.set(false);
  }
}
