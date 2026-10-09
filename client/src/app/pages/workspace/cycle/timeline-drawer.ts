import { Component, computed, input, linkedSignal, model, output } from '@angular/core';
import { FormField, applyEach, form, required, validate } from '@angular/forms/signals';
import { HlmButton } from '@spartan/button';
import { HlmInput } from '@spartan/input';
import { QaDatePicker, QaDrawerImports, QaMultiSelect, QaSwitch, QaTooltipImports } from '../../../ui';
import { DEFAULT_STEP_DATES, STEP_NAMES, Timeline } from './cycle.mock';
import { StepDraftRow, officialRelative, stepOrderErrors } from './cycle.logic';
import { PROGRAM_OPTIONS, TYPE_OPTIONS } from './load-drawer';

/** Edit an existing timeline (official or not) or create a new sub-timeline (timeline null). */
export interface TimelineRequest {
  timeline: Timeline | null;
}

export interface TimelineSaveEvent {
  /** Null for a new sub-timeline. */
  id: string | null;
  name: string;
  programs: string[];
  types: string[];
  test: boolean;
  runNow: boolean;
  steps: StepDraftRow[];
}

interface TimelineDraft {
  name: string;
  programs: readonly string[];
  types: readonly string[];
  steps: StepDraftRow[];
  test: boolean;
  runNow: boolean;
}

/** "Edit official timeline", "Edit timeline" and "New sub-timeline" drawers (steps table, validation). */
@Component({
  selector: 'qa-cycle-timeline-drawer',
  imports: [FormField, HlmButton, HlmInput, QaDatePicker, QaDrawerImports, QaSwitch, QaTooltipImports, QaMultiSelect],
  template: `
    <qa-drawer [(open)]="open" [title]="title()" [subtitle]="subtitle()" width="720px">
      @if (open()) {
        @let d = draft();
        @if (!isOfficialEdit()) {
          <div class="flex flex-col items-stretch gap-[6px]">
            <div class="flex items-center gap-1">
              <label for="cycle-tl-name" class="text-(length:--fs-13) font-semibold text-(--text-2)">Name</label>
              <span aria-hidden="true" class="text-(length:--fs-13) font-semibold text-(--danger-strong)">*</span>
            </div>
            <input
              hlmInput
              id="cycle-tl-name"
              type="text"
              [formField]="tlForm.name"
              placeholder="September 2026 sub-timeline"
              [attr.data-invalid]="!!nameError()"
              [attr.aria-invalid]="nameError() ? true : null"
              [attr.aria-describedby]="nameError() ? 'cycle-tl-name-err' : null"
              class="h-9 w-full rounded-[8px] border-(--border) bg-(--field-bg) px-3 py-0 text-(length:--fs-14) text-(--text) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[invalid=true]:border-(--danger) md:text-(length:--fs-14) dark:bg-(--field-bg)"
            />
            @if (nameError()) {
              <span id="cycle-tl-name-err" class="text-(length:--fs-13) text-(--danger)">{{ nameError() }}</span>
            }
          </div>
          <div class="flex flex-col items-start gap-[6px]">
            <div class="flex items-center gap-1">
              <label for="cycle-tl-programs" class="text-(length:--fs-13) font-semibold text-(--text-2)">Science programs</label>
              @if (!isMain()) {
                <span aria-hidden="true" class="text-(length:--fs-13) font-semibold text-(--danger-strong)">*</span>
                <button type="button" qaTooltip="Only results from these programs enter this timeline. Everyone else stays on the official timeline calendar." aria-label="More about Science programs" class="flex size-4 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-(--text-muted) outline-none hover:text-(--primary) focus-visible:shadow-(--focus-ring)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" /></svg></button>
              }
            </div>
            <qa-multi-select
              triggerId="cycle-tl-programs"
              [value]="d.programs"
              (valueChange)="patch({ programs: $event })"
              [options]="programOptions"
              label="Science programs"
              [placeholder]="isMain() ? 'All programs' : 'Select programs'"
              [mutedPlaceholder]="!isMain()"
              [invalid]="!!programsError()"
              searchPlaceholder="Search programs"
              appearance="field"
              summaryMax="99"
              panelWidth="300px"
              listMaxHeight="260px"
            />
            @if (programsError()) {
              <span class="text-(length:--fs-13) text-(--danger)">{{ programsError() }}</span>
            }
          </div>
          <div class="flex flex-col items-start gap-[6px]">
            <label for="cycle-tl-types" class="text-(length:--fs-13) font-semibold text-(--text-2)">Result types</label>
            <qa-multi-select triggerId="cycle-tl-types" [value]="d.types" (valueChange)="patch({ types: $event })" [options]="typeOptions" label="Result types" placeholder="All result types" searchPlaceholder="Search result types" appearance="field" summaryMax="99" panelWidth="300px" listMaxHeight="260px" />
          </div>
        }

        <div class="flex flex-col items-stretch gap-[6px] @container">
          <span id="cycle-tl-steps" class="text-(length:--fs-13) font-semibold text-(--text-2)">Steps</span>
          <!-- Wide drawer: table-like grid with a sticky header. Narrow (< 36rem): each step stacks as a card row with inline labels. -->
          <div class="rounded-[8px] border border-(--border)">
            <div aria-hidden="true" class="sticky top-0 z-10 hidden min-h-9 grid-cols-[24px_minmax(0,1fr)_148px_148px_44px_22px] items-center gap-3 rounded-t-[8px] border-b border-(--surface-4) bg-(--surface-3) px-[14px] text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase @xl:grid">
              <span></span><span>Step name</span><span>Opens</span><span>Closes</span><span class="text-center">Load</span><span></span>
            </div>
            @for (rf of tlForm.steps; track $index; let i = $index, last = $last) {
              @let row = rf().value();
              <div [class]="last ? '' : 'border-b border-(--surface-4)'">
                @if (confirmRow() === i) {
                  <div class="flex min-h-[52px] flex-wrap items-center gap-2 px-[14px] py-2 @xl:py-0">
                    <span class="mr-auto text-(length:--fs-13) text-(--text-2)">Remove step {{ i + 1 }}?</span>
                    <button type="button" (click)="confirmRow.set(null)" class="min-h-10 cursor-pointer rounded-[8px] border-0 bg-transparent px-[10px] text-(length:--fs-13) font-medium text-(--accent) outline-none hover:bg-(--tint) focus-visible:shadow-(--focus-ring) @xl:min-h-8">Keep it</button>
                    <button type="button" (click)="removeRow(i)" class="min-h-10 cursor-pointer rounded-[8px] border-0 bg-transparent px-[10px] text-(length:--fs-12) font-semibold text-(--danger) outline-none hover:bg-(--danger-bg) focus-visible:shadow-(--focus-ring) @xl:min-h-8">Remove</button>
                  </div>
                } @else {
                  <div class="grid grid-cols-[24px_minmax(0,1fr)_minmax(0,1fr)_40px] items-center gap-x-3 gap-y-2 px-[14px] py-3 @xl:min-h-[52px] @xl:grid-cols-[24px_minmax(0,1fr)_148px_148px_44px_22px] @xl:gap-y-0 @xl:py-0">
                    <span class="font-(family-name:--qa-mono) text-(length:--fs-12) font-semibold text-(--text-muted)">{{ i + 1 }}</span>
                    <span class="col-span-2 min-w-0 @xl:col-span-1">
                      <input hlmInput type="text" [formField]="rf.name" [attr.aria-label]="'Step ' + (i + 1) + ' name'" [title]="row.name" placeholder="QA platform open for assessors" [attr.data-invalid]="tried() && !row.name.trim()" class="h-10 min-w-0 rounded-[8px] border-(--border) bg-(--field-bg) px-[10px] py-0 text-(length:--fs-13) text-ellipsis text-(--text) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[invalid=true]:border-(--danger) md:text-(length:--fs-13) @xl:h-8 dark:bg-(--field-bg)" />
                    </span>
                    <span class="col-span-2 col-start-2 flex min-w-0 flex-col gap-1 @xl:col-span-1 @xl:col-start-auto">
                      <span aria-hidden="true" class="text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase @xl:hidden">Opens</span>
                      <span class="relative flex">
                        <input hlmInput type="text" [formField]="rf.start" [attr.aria-label]="'Step ' + (i + 1) + ' opens'" placeholder="06 Jul 2026" [attr.data-invalid]="rowErrorShown(i)" [attr.aria-invalid]="rowErrorShown(i) || null" class="h-10 min-w-0 rounded-[8px] border-(--border) bg-(--field-bg) py-0 pr-9 pl-[10px] font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text) tabular-nums shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[invalid=true]:border-(--danger) md:text-(length:--fs-13) @xl:h-8 dark:bg-(--field-bg)" />
                        <qa-date-picker [value]="rf.start().value()" (valueChange)="rf.start().value.set($event)" [label]="'Pick step ' + (i + 1) + ' opening date'" class="absolute top-1/2 right-1 -translate-y-1/2" />
                      </span>
                    </span>
                    <span class="col-span-2 col-start-2 flex min-w-0 flex-col gap-1 @xl:col-span-1 @xl:col-start-auto">
                      <span aria-hidden="true" class="text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase @xl:hidden">Closes</span>
                      <span class="relative flex">
                        <input hlmInput type="text" [formField]="rf.end" [attr.aria-label]="'Step ' + (i + 1) + ' closes'" [placeholder]="last ? 'Optional' : '11 Jul 2026'" class="h-10 min-w-0 rounded-[8px] border-(--border) bg-(--field-bg) py-0 pr-9 pl-[10px] font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text) tabular-nums shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 md:text-(length:--fs-13) @xl:h-8 dark:bg-(--field-bg)" />
                        <qa-date-picker [value]="rf.end().value()" (valueChange)="rf.end().value.set($event)" [label]="'Pick step ' + (i + 1) + ' closing date'" class="absolute top-1/2 right-1 -translate-y-1/2" />
                      </span>
                    </span>
                    <span class="col-span-3 col-start-2 flex min-h-10 items-center justify-between gap-3 @xl:col-span-1 @xl:col-start-auto @xl:min-h-0 @xl:justify-center">
                      <span aria-hidden="true" class="text-(length:--fs-13) font-medium text-(--text-2) @xl:hidden">Loads results</span>
                      <qa-switch [checked]="row.batch" (checkedChange)="patchRow(i, { batch: $event })" [aria-label]="'Step ' + (i + 1) + ' loads results'" />
                    </span>
                    <span class="col-start-4 row-start-1 flex justify-end @xl:col-start-auto @xl:row-start-auto @xl:block">
                      <button type="button" (click)="confirmRow.set(i)" [attr.aria-label]="'Remove step ' + (i + 1)" class="flex size-10 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-(--text-3) outline-none hover:text-(--danger) focus-visible:shadow-(--focus-ring) @xl:size-[22px]"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
                    </span>
                  </div>
                }
              </div>
            }
            <div class="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-t border-(--surface-4) px-[6px] py-1 @xl:py-0">
              <button type="button" (click)="addRow()" class="min-h-10 cursor-pointer rounded-[8px] border-0 bg-transparent px-2 text-(length:--fs-13) font-medium text-(--accent) outline-none hover:bg-(--tint) focus-visible:shadow-(--focus-ring) @xl:min-h-8">Add step</button>
              <button type="button" (click)="resetRows()" class="min-h-10 cursor-pointer rounded-[8px] border-0 bg-transparent px-2 text-(length:--fs-13) font-medium text-(--accent) outline-none hover:bg-(--tint) focus-visible:shadow-(--focus-ring) @xl:min-h-8">Reset to official timeline</button>
            </div>
          </div>
          @if (orderError()) {
            <span role="alert" class="text-(length:--fs-13) text-(--danger)">{{ orderError() }}</span>
          }
        </div>

        @if (!isOfficialEdit()) {
          <div class="flex min-h-[52px] items-center gap-4">
            <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span id="cycle-tl-test" class="text-(length:--fs-14) font-medium text-(--text-2)">Test timeline</span>
              <span class="text-(length:--fs-13) font-normal text-pretty text-(--text-4)">Nobody is notified and you can clear the results afterwards. Use it to rehearse before the reporting peak.</span>
            </div>
            <qa-switch [checked]="d.test" (checkedChange)="patch({ test: $event })" aria-labelledby="cycle-tl-test" />
          </div>
        }
        @if (isNew()) {
          <button type="button" role="checkbox" [attr.aria-checked]="d.runNow" (click)="patch({ runNow: !d.runNow })" class="flex w-full cursor-pointer items-start gap-[10px] rounded-[8px] border-0 bg-(--surface-3) p-[14px] text-left outline-none focus-visible:shadow-(--focus-ring)">
            <span class="mt-[2px] flex size-4 flex-none items-center justify-center rounded-[4px] border-[1.5px]" [class]="d.runNow ? 'border-(--primary) bg-(--primary)' : 'border-(--border-strong) bg-transparent'">
              @if (d.runNow) {
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
              }
            </span>
            <span class="flex flex-col gap-[2px]">
              <span class="text-(length:--fs-14) font-medium text-(--text-2)">Load results into step 1 now</span>
              <span class="text-(length:--fs-13) font-normal text-(--text-3)">Pulls in matching submitted results as soon as the timeline is created.</span>
            </span>
          </button>
        }
      }
      <div qaDrawerFooter class="contents">
        <button hlmBtn variant="ghost" type="button" (click)="open.set(false)" class="h-9 rounded-[8px] border border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium text-(--text-2) hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:border-(--border) focus-visible:ring-0 focus-visible:shadow-(--focus-ring) dark:hover:bg-(--surface-2)">Cancel</button>
        <button hlmBtn type="button" (click)="save()" class="h-9 rounded-[8px] bg-(--primary) px-[14px] text-(length:--fs-14) font-semibold text-(--surface) hover:bg-(--accent) focus-visible:border-transparent focus-visible:ring-0 focus-visible:shadow-(--focus-ring)">{{ isNew() ? 'Create sub-timeline' : 'Save changes' }}</button>
      </div>
    </qa-drawer>
  `,
})
export class TimelineDrawer {
  readonly open = model(false);
  readonly request = input.required<TimelineRequest>();
  /** Source of "Reset to official timeline" and of the default step names. */
  readonly official = input.required<Timeline>();
  readonly saveTimeline = output<TimelineSaveEvent>();

  protected readonly programOptions = PROGRAM_OPTIONS;
  protected readonly typeOptions = TYPE_OPTIONS;

  protected readonly isNew = computed(() => !this.request().timeline);
  protected readonly isOfficialEdit = computed(() => this.request().timeline?.id === 'official');
  /** Official timelines cover every program, so programs are optional. */
  protected readonly isMain = computed(() => {
    const t = this.request().timeline;
    return !!t && (t.id === 'official' || t.kind === 'Official timeline');
  });

  protected readonly title = computed(() =>
    this.isOfficialEdit() ? 'Edit official timeline' : this.isNew() ? 'New sub-timeline' : 'Edit timeline',
  );
  protected readonly subtitle = computed(() =>
    this.isOfficialEdit()
      ? 'The official calendar for the 2026 cycle. Every program follows it unless you add a sub-timeline.'
      : this.isMain()
        ? 'Covers the whole cycle for every program.'
        : 'Runs on its own calendar, alongside the official timeline.',
  );

  protected readonly draft = linkedSignal<TimelineDraft>(() => {
    const t = this.request().timeline;
    if (t) {
      return {
        name: t.name,
        programs: [...t.programs],
        types: [...t.types],
        steps: t.steps.map((p) => ({ name: p.name, start: p.start, end: p.end, batch: p.batch })),
        test: !!t.test,
        runNow: false,
      };
    }
    const off = this.official();
    return {
      name: '',
      programs: [],
      types: [],
      steps: DEFAULT_STEP_DATES.map(([start, end], i) => ({ name: off.steps[i]?.name ?? STEP_NAMES[i], start, end, batch: i === 0 })),
      test: false,
      runNow: true,
    };
  });

  protected readonly tlForm = form(this.draft, (f) => {
    required(f.name, { message: 'Enter a name for the timeline.', when: () => !this.isOfficialEdit() });
    validate(f.programs, ({ value }) =>
      !this.isMain() && !value().length ? { kind: 'required', message: 'Select at least one program.' } : undefined,
    );
    applyEach(f.steps, (s) => {
      required(s.name, { message: 'Enter a name for the step.' });
    });
  });

  protected readonly tried = linkedSignal({ source: this.request, computation: () => false });
  protected readonly confirmRow = linkedSignal<TimelineRequest, number | null>({ source: this.request, computation: () => null });

  protected readonly nameError = computed(() => (this.tried() ? (this.tlForm.name().errors()[0]?.message ?? '') : ''));
  protected readonly programsError = computed(() =>
    this.tried() ? (this.tlForm.programs().errors()[0]?.message ?? '') : '',
  );
  private readonly orderErrors = computed(() => stepOrderErrors(this.draft().steps));

  /** A step that opens before the previous one closes: shown once its date was left (blur) or on save. */
  protected rowErrorShown(i: number): boolean {
    return !!this.orderErrors()[i] && (this.tried() || !!this.tlForm.steps[i]?.start().touched());
  }

  protected readonly orderError = computed(() => {
    const steps = this.draft().steps;
    const i = steps.findIndex((_, k) => this.rowErrorShown(k));
    return i < 0 ? '' : `${steps[i].name.trim() || `Step ${i + 1}`} starts before the previous step closes.`;
  });

  protected patch(p: Partial<TimelineDraft>): void {
    this.draft.update((d) => ({ ...d, ...p }));
  }

  protected patchRow(i: number, p: Partial<StepDraftRow>): void {
    this.draft.update((d) => ({ ...d, steps: d.steps.map((s, k) => (k === i ? { ...s, ...p } : s)) }));
  }

  protected addRow(): void {
    this.confirmRow.set(null);
    this.draft.update((d) => ({ ...d, steps: [...d.steps, { name: '', start: '', end: '', batch: false }] }));
  }

  protected removeRow(i: number): void {
    this.confirmRow.set(null);
    this.draft.update((d) => ({ ...d, steps: d.steps.filter((_, k) => k !== i) }));
  }

  protected resetRows(): void {
    this.confirmRow.set(null);
    this.draft.update((d) => ({ ...d, steps: officialRelative(d.steps[0]?.start ?? '', this.official()) }));
  }

  protected save(): void {
    this.tried.set(true);
    if (this.tlForm().invalid() || this.orderErrors().some(Boolean)) return;
    const d = this.draft();
    // TODO(api): PUT the timeline (or POST a new sub-timeline).
    this.saveTimeline.emit({
      id: this.request().timeline?.id ?? null,
      name: d.name.trim(),
      programs: [...d.programs],
      types: [...d.types],
      test: d.test,
      runNow: d.runNow,
      steps: d.steps
        .filter((s) => s.start.trim())
        .map((s) => ({ name: s.name.trim(), start: s.start.trim(), end: s.end.trim(), batch: s.batch })),
    });
    this.open.set(false);
  }
}
