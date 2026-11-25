import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, linkedSignal, model } from '@angular/core';
import { AccessControl } from '../../../core/access/access-control';
import { Permission } from '../../../core/access/role-definitions';
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
import { FIELD_DEFS, SECTIONS } from '../review/review.mock';
import { ExportFieldGroup, ExportFieldPicker } from './export-field-picker';

/** What the button that opens the drawer already knows (P2-3914: "the three Export comments open the same dialog"). */
export interface ExportCommentsPreset {
  /** "Export comments" in a result's menu (Results). */
  readonly resultCode?: string;
  /** "Export comments" in a timeline's menu (Cycle). */
  readonly timelineId?: string;
  /** Name of that timeline, for timelines the mock list does not know (Cycle reads them from the API). */
  readonly timelineName?: string;
  /** "Export comments" in a step's progress drawer (Cycle): index in PHASE_NAMES. */
  readonly step?: number;
}

/**
 * Columns of the file, in order (P2-3914 criteria 4 and 5; Juanda, 2026-11-11, for the later steps).
 * Shown so people know what they get before downloading.
 */
const COLUMN_GROUPS: readonly { readonly name: string; readonly columns: string }[] = [
  { name: 'Result', columns: 'Code, title, science program, result type, timeline, assessed by, current QA status' },
  { name: 'Field', columns: 'Field, its value, validation status (green or grey)' },
  { name: 'Comment', columns: 'Comment, reviewer’s nickname, date and time, step it was made in, deleted' },
  { name: 'Program’s response', columns: 'Accept, Accept with comment, Disagree or Request clarification, and its text' },
  { name: 'Later steps', columns: 'Lead assessor’s decision and comment, third-party broker’s decision, done by PPU' },
];

/** Assessed fields by review section (core and assessed only: hidden and view-only fields carry no comments). */
const FIELD_GROUPS: readonly ExportFieldGroup[] = SECTIONS.map((s) => ({
  id: s.id,
  name: s.name,
  fields:
    s.id === 'toc'
      ? // The theory of change has one card per contribution, different in each result: one checkbox for all of them.
        [{ id: 'toc', label: 'Contributions to the theory of change' }]
      : FIELD_DEFS.filter((d) => d.sec === s.id && (d.mode === 'core' || d.mode === 'assessed')).map((d) => ({ id: d.id, label: d.label })),
})).filter((g) => g.fields.length > 0);

const ALL_FIELD_IDS: readonly string[] = FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.id));

/**
 * "Export fields and comments" drawer (P2-3914): one .xlsx with the chosen fields of each result, every comment on them
 * and every QA step after each comment. The server builds the file and checks what each role may download (criterion 1:
 * the QA admin any timeline, other reviewers only their scope); this drawer only picks the filters and the fields.
 * Opened from a result's menu (Results), a timeline's menu and a step's progress drawer (Cycle), with that scope set.
 */
@Component({
  selector: 'qa-export-comments-drawer',
  imports: [DecimalPipe, ExportFieldPicker, QaButtonImports, QaDrawerImports, QaMultiSelect, QaSelectImports, QaSwitch],
  host: { class: 'contents' },
  template: `
    <qa-drawer
      [(open)]="open"
      title="Export fields and comments"
      subtitle="An Excel file with the chosen fields of each result, their comments and what happened after them."
      width="720px"
    >
      @if (open()) {
        @if (resultCode(); as code) {
          <!-- Opened from one result: that result is fixed, only fields and deleted comments are chosen (Juanpa, 2026-11-11). -->
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Result</span>
            <span class="font-(family-name:--qa-mono) text-(length:--fs-14) font-semibold text-(--accent) tabular-nums">{{ code }}</span>
            @if (resultTitle(); as title) {
              <span class="text-(length:--fs-13) leading-[1.5] text-pretty text-(--text-3)">{{ title }}</span>
            }
          </div>
        } @else {
          <!-- Two per row in the 720px drawer; one per row when it is narrower (phones). -->
          <div class="@container">
            <div class="grid grid-cols-2 gap-x-4 gap-y-4 @max-[34rem]:grid-cols-1">
              <div class="flex min-w-0 flex-col gap-1.5">
                <label for="export-timeline" class="text-(length:--fs-13) font-semibold text-(--text-2)">Timeline</label>
                <qa-select triggerId="export-timeline" [(value)]="timeline" [options]="timelineOptions()" label="Timeline" appearance="field" searchable searchPlaceholder="Search timelines" panelWidth="320px" />
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
                <label for="export-stages" class="text-(length:--fs-13) font-semibold text-(--text-2)">QA status</label>
                <qa-multi-select triggerId="export-stages" [(value)]="stages" [options]="stageOptions" label="QA status" placeholder="All statuses" [searchable]="false" appearance="field" panelWidth="320px" />
              </div>
            </div>
          </div>
          @if (!isAdmin()) {
            <p class="m-0 text-(length:--fs-13) text-pretty text-(--text-3)">The file has only the results in your scope.</p>
          }
        }

        <qa-export-field-picker [groups]="fieldGroups" [(value)]="fields" />

        <div class="flex min-h-[52px] items-center gap-4">
          <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span id="export-deleted" class="text-(length:--fs-14) font-medium text-(--text-2)">Include deleted comments</span>
            <span id="export-deleted-hint" class="text-(length:--fs-13) text-pretty text-(--text-4)">They are marked as deleted in the file.</span>
          </div>
          <qa-switch [(checked)]="deleted" aria-labelledby="export-deleted" aria-describedby="export-deleted-hint" />
        </div>

        <!-- What the file will hold. TODO(api): the count comes from the export endpoint (or a count endpoint). -->
        <div aria-live="polite" class="rounded-lg bg-(--surface-3) px-[14px] py-3 text-(length:--fs-13) leading-[1.55] text-(--text-2)">
          @if (fields().length === 0) {
            Choose at least one field to export.
          } @else if (estimate().results === 0) {
            No results match these filters.
          } @else {
            <span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ estimate().results | number }}</span>
            {{ estimate().results === 1 ? 'result' : 'results' }} with
            <span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ fields().length }}</span>
            {{ fields().length === 1 ? 'field' : 'fields' }} each, and about
            <span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ estimate().comments | number }}</span>
            {{ estimate().comments === 1 ? 'comment' : 'comments' }}.
          }
        </div>

        <section aria-labelledby="export-columns" class="flex flex-col gap-2">
          <h3 id="export-columns" class="m-0 text-(length:--fs-12) font-medium text-(--text-muted)">Columns in the file</h3>
          <p class="m-0 text-(length:--fs-13) leading-[1.5] text-pretty text-(--text-3)">One row per comment. A field with no comments still gets a row, with its value and status.</p>
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
        <button hlmBtn qaBtn tone="primary" type="button" [disabled]="!canDownload()" (click)="download()">
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

  private readonly access = inject(AccessControl);
  protected readonly isAdmin = computed(() => this.access.canAny(Permission.ADMIN_ACCESS));

  /** The mock timelines, plus the one the button named when the mock list does not have it (an API timeline in Cycle). */
  protected readonly timelineOptions = computed<readonly QaSelectOption[]>(() => {
    const { timelineId, timelineName } = this.preset();
    const known = TIMELINES.some((t) => t.id === timelineId);
    return [
      { value: 'all', label: 'All timelines' },
      ...(timelineId && !known ? [{ value: timelineId, label: timelineName ?? timelineId }] : []),
      ...TIMELINES.map((t) => ({ value: t.id, label: t.name, group: t.kind === 'Official timeline' ? 'Official timeline' : 'Sub-timelines' })),
    ];
  });
  protected readonly stepOptions: readonly QaSelectOption[] = [
    { value: 'all', label: 'All steps' },
    ...PHASE_NAMES.map((name, i) => ({ value: String(i), label: `${i + 1}. ${PHASE_SHORT[name]}` })),
  ];
  protected readonly programOptions: readonly QaSelectOption[] = PROGRAM_CODES.map((c) => ({ value: c, label: `${c} ${PROGRAMS[c]}` }));
  protected readonly typeOptions: readonly QaSelectOption[] = RESULT_TYPES.map((t) => ({ value: t, label: t }));
  // Results in Editing are not in QA, so they are never exported (P2-3914, out of scope).
  protected readonly stageOptions: readonly QaSelectOption[] = QA_STAGES.map((s) => ({ value: s, label: RESULT_STAGE_LABELS[s] }));
  protected readonly fieldGroups = FIELD_GROUPS;
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
  /** Every field starts checked (Juanpa, 2026-11-23): people take out what they do not need. */
  protected readonly fields = linkedSignal<boolean, readonly string[]>({ source: this.open, computation: () => ALL_FIELD_IDS });
  protected readonly deleted = linkedSignal<boolean, boolean>({ source: this.open, computation: () => false });

  /** Mock estimate from the Results rows (the step filter is not modelled in the mock). */
  protected readonly estimate = computed(() => {
    const code = this.resultCode();
    const tl = TIMELINES.find((t) => t.id === this.timeline());
    const programs = this.programs();
    const types = this.types();
    const stages = this.stages();
    const rows = RESULTS.filter((r) => {
      if (code) return r.code === code;
      if (tl && r.batch !== tl.name) return false;
      if (programs.length && !programs.includes(r.program)) return false;
      if (types.length && !types.includes(r.type)) return false;
      if (stages.length && !stages.includes(qaStage(r) ?? '')) return false;
      return true;
    });
    const share = this.fields().length / ALL_FIELD_IDS.length;
    const comments = Math.round(rows.reduce((n, r) => n + (r.comments?.[1] ?? 0), 0) * share * (this.deleted() ? 1.08 : 1));
    return { results: rows.length, comments };
  });

  protected readonly canDownload = computed(() => this.fields().length > 0 && this.estimate().results > 0);

  protected download(): void {
    // TODO(api): ask the export endpoint (P2-3914) for the .xlsx with these filters and download it:
    // resultCode(), timeline(), step(), programs(), types(), stages(), fields(), deleted().
    this.open.set(false);
  }
}
