import { Component, computed, input, linkedSignal, model, output } from '@angular/core';
import { DefaultStep } from '../../../core/api/cycles.models';
import { ApiFieldError } from '../../../core/http/api-envelope';
import { FormField, applyEach, form, required, validate } from '@angular/forms/signals';
import { HlmInput } from '@spartan/input';
import { QaButtonImports, QaDatePicker, QaDialogImports, QaDrawerImports, QaMultiSelect, QaSelectOption, QaSwitch, QaTooltipImports, discardGuard } from '../../../ui';
import { DEFAULT_STEP_DATES, PROGRAMS, STEP_NAMES, Timeline } from './cycle.mock';
import { StepDraftRow, formatNumber, officialRelative, stepOrderErrors, stepState } from './cycle.logic';
import { nextAudience, toApiDay } from './cycle.mapper';
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
  /** The admin already agreed to change a step in progress (live data: sent up front). */
  confirmed: boolean;
}

/** What the server answered to the last save (live data): shown on the fields, drawer stays open. */
export interface TimelineSaveFeedback {
  readonly message: string;
  readonly fields: readonly ApiFieldError[];
  readonly needsConfirm?: boolean;
}

/** The API allows 1 to 5 steps (one per audience). */
const MAX_STEPS = 5;

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
  imports: [FormField, QaButtonImports, HlmInput, QaDatePicker, QaDialogImports, QaDrawerImports, QaSwitch, QaTooltipImports, QaMultiSelect],
  template: `
    <qa-drawer [(open)]="open" [closeGuard]="discard.guard" [title]="title()" [subtitle]="subtitle()" width="720px">
      @if (open()) {
        @let d = draft();
        @if (feedback()?.message; as message) {
          <div role="alert" class="rounded-[8px] bg-(--danger-bg) px-3 py-2 text-(length:--fs-13) leading-[1.5] text-(--danger)">{{ message }}</div>
        }
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
              [attr.data-error]="!!nameError()"
              [attr.aria-invalid]="nameError() ? true : null"
              [attr.aria-describedby]="nameError() ? 'cycle-tl-name-err' : null"
              class="h-9 w-full rounded-[8px] border-(--border) bg-(--field-bg) px-3 py-0 text-(length:--fs-14) text-(--text) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[error=true]:border-(--danger) md:text-(length:--fs-14) dark:bg-(--field-bg)"
            />
            @if (nameError()) {
              <span id="cycle-tl-name-err" class="text-(length:--fs-13) text-(--danger)">{{ nameError() }}</span>
            }
          </div>
          @if (scopeSet()) {
            <!-- Step 1 has started: the scope is set, shown as text with the way forward. -->
            <div class="flex flex-col items-start gap-[6px]">
              <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Science programs</span>
              <span class="text-(length:--fs-14) text-(--text)">{{ programsText() }}</span>
            </div>
            <div class="flex flex-col items-start gap-[6px]">
              <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Result types</span>
              <span class="text-(length:--fs-14) text-(--text)">{{ d.types.length ? d.types.join(', ') : 'All result types' }}</span>
              <span class="text-(length:--fs-13) leading-[1.5] font-normal text-pretty text-(--text-4)">Set when step 1 opened on {{ d.steps[0]?.start }}. To cover other programs or result types, create a new sub-timeline.</span>
            </div>
          } @else {
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
              [options]="programOptions()"
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
            <qa-multi-select triggerId="cycle-tl-types" [value]="d.types" (valueChange)="patch({ types: $event })" [options]="typeOptions()" label="Result types" placeholder="All result types" searchPlaceholder="Search result types" appearance="field" summaryMax="99" panelWidth="300px" listMaxHeight="260px" />
            @if (serverError('resultTypeKeys'); as m) {
              <span class="text-(length:--fs-13) text-(--danger)">{{ m }}</span>
            }
          </div>
          }
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
                    <button hlmBtn qaBtn tone="link" size="sm" type="button" (click)="confirmRow.set(null)">Keep it</button>
                    <button hlmBtn qaBtn tone="danger" size="sm" type="button" (click)="removeRow(i)">Remove</button>
                  </div>
                } @else {
                  <div class="grid grid-cols-[24px_minmax(0,1fr)_minmax(0,1fr)_40px] items-center gap-x-3 gap-y-2 px-[14px] py-3 @xl:min-h-[52px] @xl:grid-cols-[24px_minmax(0,1fr)_148px_148px_44px_22px] @xl:gap-y-0 @xl:py-0">
                    <span class="font-(family-name:--qa-mono) text-(length:--fs-12) font-semibold text-(--text-muted)">{{ i + 1 }}</span>
                    <span class="col-span-2 min-w-0 @xl:col-span-1">
                      <input hlmInput type="text" [formField]="rf.name" [attr.aria-label]="'Step ' + (i + 1) + ' name'" [title]="row.name" placeholder="QA platform open for assessors" [attr.data-error]="tried() && !row.name.trim()" class="h-10 min-w-0 rounded-[8px] border-(--border) bg-(--field-bg) px-[10px] py-0 text-(length:--fs-13) text-ellipsis text-(--text) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[error=true]:border-(--danger) md:text-(length:--fs-13) @xl:h-8 dark:bg-(--field-bg)" />
                    </span>
                    <span class="col-span-2 col-start-2 flex min-w-0 flex-col gap-1 @xl:col-span-1 @xl:col-start-auto">
                      <span aria-hidden="true" class="text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase @xl:hidden">Opens</span>
                      @if (i < closedCount() || i === activeIndex()) {
                        <span class="flex min-h-10 items-center font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text-3) tabular-nums @xl:min-h-8">{{ row.start }}</span>
                      } @else {
                      <span class="relative flex">
                        <input hlmInput type="text" [formField]="rf.start" [attr.aria-label]="'Step ' + (i + 1) + ' opens'" placeholder="06 Jul 2026" [attr.data-error]="rowErrorShown(i)" [attr.aria-invalid]="rowErrorShown(i) || null" class="h-10 min-w-0 rounded-[8px] border-(--border) bg-(--field-bg) py-0 pr-9 pl-[10px] font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text) tabular-nums shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[error=true]:border-(--danger) md:text-(length:--fs-13) @xl:h-8 dark:bg-(--field-bg)" />
                        <qa-date-picker [value]="rf.start().value()" (valueChange)="rf.start().value.set($event)" [label]="'Pick step ' + (i + 1) + ' opening date'" class="absolute top-1/2 right-1 -translate-y-1/2" />
                      </span>
                      }
                    </span>
                    <span class="col-span-2 col-start-2 flex min-w-0 flex-col gap-1 @xl:col-span-1 @xl:col-start-auto">
                      <span aria-hidden="true" class="text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase @xl:hidden">Closes</span>
                      @if (i < closedCount()) {
                        <span class="flex min-h-10 items-center font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text-3) tabular-nums @xl:min-h-8">{{ row.end || '—' }}</span>
                      } @else {
                      <span class="relative flex">
                        <input hlmInput type="text" [formField]="rf.end" [attr.aria-label]="'Step ' + (i + 1) + ' closes'" [placeholder]="last && !live() ? 'Optional' : '11 Jul 2026'" class="h-10 min-w-0 rounded-[8px] border-(--border) bg-(--field-bg) py-0 pr-9 pl-[10px] font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text) tabular-nums shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 md:text-(length:--fs-13) @xl:h-8 dark:bg-(--field-bg)" />
                        <qa-date-picker [value]="rf.end().value()" (valueChange)="rf.end().value.set($event)" [label]="'Pick step ' + (i + 1) + ' closing date'" class="absolute top-1/2 right-1 -translate-y-1/2" />
                      </span>
                      }
                    </span>
                    <span class="col-span-3 col-start-2 flex min-h-10 items-center justify-between gap-3 @xl:col-span-1 @xl:col-start-auto @xl:min-h-0 @xl:justify-center">
                      <span aria-hidden="true" class="text-(length:--fs-13) font-medium text-(--text-2) @xl:hidden">Loads results</span>
                      @if (i < closedCount() || fixedSteps()) {
                        <span class="text-(length:--fs-13) text-(--text-3)">{{ row.batch ? 'Yes' : 'No' }}</span>
                      } @else {
                        <qa-switch [checked]="row.batch" (checkedChange)="patchRow(i, { batch: $event })" [aria-label]="'Step ' + (i + 1) + ' loads results'" />
                      }
                    </span>
                    <span class="col-start-4 row-start-1 flex justify-end @xl:col-start-auto @xl:row-start-auto @xl:block">
                      @if (i >= closedCount() && !fixedSteps()) {
                      <button type="button" (click)="confirmRow.set(i)" [attr.aria-label]="'Remove step ' + (i + 1)" class="flex size-10 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-(--text-3) outline-none hover:text-(--danger) focus-visible:shadow-(--focus-ring) @xl:size-[22px]"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
                      }
                    </span>
                  </div>
                  @if (rowServerError(i); as m) {
                    <span role="alert" class="block px-[14px] pb-2 text-(length:--fs-13) text-(--danger)">{{ m }}</span>
                  }
                }
              </div>
            } @empty {
              <p class="m-0 px-[14px] py-4 text-(length:--fs-13) text-pretty text-(--text-3)">No steps yet. Add the first step, or start from the official timeline.</p>
            }
            <div class="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-t border-(--surface-4) px-[6px] py-1 @xl:py-0">
              @if (!fixedSteps() && d.steps.length < maxSteps()) {
                <button hlmBtn qaBtn tone="link" size="sm" type="button" (click)="addRow()">Add step</button>
              } @else if (fixedSteps()) {
                <span class="px-2 text-(length:--fs-13) text-(--text-4)">Steps can't be added, removed or reordered once a timeline exists.</span>
              }
              @if (!closedCount() && !fixedSteps() && official()) {
                <button hlmBtn qaBtn tone="link" size="sm" type="button" (click)="resetRows()">Reset to official timeline</button>
              }
            </div>
          </div>
          @if (stepsError()) {
            <span role="alert" class="text-(length:--fs-13) text-(--danger)">{{ stepsError() }}</span>
          }
          @if (orderError()) {
            <span role="alert" class="text-(length:--fs-13) text-(--danger)">{{ orderError() }}</span>
          }
          @if (closedCount()) {
            <span class="text-(length:--fs-13) leading-[1.5] font-normal text-pretty text-(--text-4)">Closed steps keep their dates as the record of the cycle.</span>
          }
          @if (d.steps.length && !d.steps[0].batch) {
            <div role="status" class="rounded-[8px] bg-(--st-editing-bg) px-3 py-2 text-(length:--fs-13) leading-[1.5] text-(--st-editing-fg)">Step 1 doesn't load results, so this timeline starts with nothing to assess.</div>
          }
        </div>

        @if (!isOfficialEdit() && !live()) {
          <div class="flex min-h-[52px] items-center gap-4">
            <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span id="cycle-tl-test" class="text-(length:--fs-14) font-medium text-(--text-2)">Test timeline</span>
              <span class="text-(length:--fs-13) font-normal text-pretty text-(--text-4)">Nobody is notified and you can clear the results afterwards. Use it to rehearse before the reporting peak.</span>
            </div>
            <qa-switch [checked]="d.test" (checkedChange)="patch({ test: $event })" aria-labelledby="cycle-tl-test" />
          </div>
        }
        @if (isNew() && !live()) {
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
        @if (discard.confirming()) {
          <div role="alertdialog" aria-label="Discard changes" class="mr-auto flex min-w-0 flex-[1_1_280px] flex-col gap-1">
            <span class="text-(length:--fs-13) leading-[1.55] font-normal text-(--text-2)">Discard what you wrote?</span>
          </div>
          <button hlmBtn qaBtn tone="secondary" type="button" (click)="discard.keepWriting()">Keep writing</button>
          <button hlmBtn qaBtn tone="danger" type="button" (click)="discard.discard()">Discard and close</button>
        } @else {
          <button hlmBtn qaBtn tone="secondary" type="button" (click)="discard.requestClose()">Cancel</button>
          <button hlmBtn qaBtn tone="primary" type="button" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : isNew() ? (creatingOfficial() ? 'Create official timeline' : 'Create sub-timeline') : 'Save changes' }}</button>
        }
      </div>
    </qa-drawer>

    <qa-dialog [(open)]="confirmActive" title="Change a step in progress?" width="480px">
      <p class="m-0 text-(length:--fs-14) leading-[1.55] font-normal text-pretty text-(--text-2)">{{ activeNote() }}</p>
      <div qaDialogFooter class="contents">
        <button hlmBtn qaBtn tone="secondary" type="button" (click)="confirmActive.set(false)">Keep editing</button>
        <button hlmBtn qaBtn tone="primary" type="button" (click)="commit(true)">Save changes</button>
      </div>
    </qa-dialog>
  `,
})
export class TimelineDrawer {
  readonly open = model(false);
  readonly request = input.required<TimelineRequest>();
  /** Source of "Reset to official timeline" and of the default step names; null before the cycle has one. */
  readonly official = input.required<Timeline | null>();
  readonly saveTimeline = output<TimelineSaveEvent>();
  /** Live data (API): the drawer stays open until the parent closes it, and the API's rules apply. */
  readonly live = input(false);
  readonly saving = input(false);
  readonly feedback = input<TimelineSaveFeedback | null>(null);
  /** Step proposal of the server (`/timeline-defaults`), used when there is no official timeline yet. */
  readonly defaults = input<readonly DefaultStep[]>([]);
  readonly programOptions = input<readonly QaSelectOption[]>(PROGRAM_OPTIONS);
  readonly typeOptions = input<readonly QaSelectOption[]>(TYPE_OPTIONS);

  protected readonly maxSteps = computed(() => (this.live() ? MAX_STEPS : Infinity));
  /** An existing timeline keeps its steps (live data): no add, remove, reorder or load switch (spec S-4). */
  protected readonly fixedSteps = computed(() => this.live() && !this.isNew());
  /** The first timeline of a cycle is the official one (the server decides; this is the front's guess). */
  protected readonly creatingOfficial = computed(() => this.isNew() && this.live() && !this.official());

  protected readonly isNew = computed(() => !this.request().timeline);
  protected readonly isOfficialEdit = computed(() => this.request().timeline?.id === 'official');
  /** Official timelines cover every program, so programs are optional. */
  protected readonly isMain = computed(() => {
    const t = this.request().timeline;
    return (!!t && (t.id === 'official' || t.kind === 'Official timeline')) || this.creatingOfficial();
  });

  /** State of each saved step, in order (empty for a new sub-timeline). */
  private readonly states = computed(() => {
    const t = this.request().timeline;
    return t ? t.steps.map((p) => stepState(p, t)) : [];
  });
  /** Closed steps come first; their rows keep their dates. */
  protected readonly closedCount = computed(() => {
    const i = this.states().findIndex((s) => s.kind !== 'done');
    return i < 0 ? this.states().length : i;
  });
  /** Once step 1 has opened, programs and result types are set. */
  protected readonly scopeSet = computed(() => !this.isOfficialEdit() && !!this.states().length && this.states()[0].kind !== 'future');
  protected readonly programsText = computed(() => {
    const p = this.draft().programs;
    const label = (c: string) => this.programOptions().find((o) => o.value === c)?.label ?? `${c} ${PROGRAMS[c] ?? ''}`.trim();
    return p.length ? p.map(label).join(', ') : 'All programs';
  });
  /** The step running now: saving a change to it asks first (pop-up). */
  protected readonly activeIndex = computed(() => (this.live() ? this.states().findIndex((s) => s.kind === 'active') : -1));
  private readonly runningIndex = computed(() => this.states().findIndex((s) => s.kind === 'active'));
  protected readonly activeNote = computed(() => {
    const i = this.runningIndex();
    const st = this.states()[i];
    const progress = st?.kind === 'active' && st.of ? ` (${formatNumber(st.done)} of ${formatNumber(st.of)} results reviewed so far)` : '';
    return `Step ${i + 1} is running right now${progress}. Your changes apply as soon as you save.`;
  });
  private readonly activeChanged = computed(() => {
    const i = this.runningIndex();
    const p = this.request().timeline?.steps[i];
    const r = this.draft().steps[i];
    return !!p && (!r || r.name.trim() !== p.name || r.start.trim() !== p.start || r.end.trim() !== p.end || r.batch !== p.batch);
  });
  /** Also opens when the server asks (409 TIMELINES_IN_PROGRESS_UNCONFIRMED). */
  protected readonly confirmActive = linkedSignal({
    source: () => ({ request: this.request(), feedback: this.feedback() }),
    computation: ({ feedback }) => !!feedback?.needsConfirm,
  });

  protected readonly title = computed(() =>
    this.isOfficialEdit() ? 'Edit official timeline' : this.creatingOfficial() ? 'New official timeline' : this.isNew() ? 'New sub-timeline' : 'Edit timeline',
  );
  protected readonly subtitle = computed(() =>
    this.isOfficialEdit() || this.creatingOfficial()
      ? 'The official calendar of the cycle. Every program follows it unless you add a sub-timeline.'
      : this.isMain()
        ? 'Covers the whole cycle for every program.'
        : 'Runs on its own calendar, alongside the official timeline.',
  );

  protected readonly draft = linkedSignal<TimelineDraft>(() => this.initialDraft());
  /** Esc / overlay / X / Cancel ask before dropping edits (also blocks tab close while open). */
  protected readonly discard = discardGuard(this.open, () => JSON.stringify(this.draft()) !== JSON.stringify(this.initialDraft()));

  private initialDraft(): TimelineDraft {
    const t = this.request().timeline;
    if (t) {
      return {
        name: t.name,
        programs: [...t.programs],
        types: [...t.types],
        steps: t.steps.map((p) => ({ name: p.name, start: p.start, end: p.end, batch: p.batch, audience: p.audienceKey })),
        test: !!t.test,
        runNow: false,
      };
    }
    const off = this.official();
    if (this.live()) {
      // Same steps as the official timeline (or the server's proposal), dates left for the admin.
      const steps: StepDraftRow[] = off
        ? off.steps.map((p) => ({ name: p.name, start: '', end: '', batch: p.batch, audience: p.audienceKey }))
        : this.defaults().map((p) => ({ name: p.name, start: '', end: '', batch: p.requiresLoad, audience: p.audience }));
      return { name: '', programs: [], types: [], steps, test: false, runNow: false };
    }
    return {
      name: '',
      programs: [],
      types: [],
      steps: DEFAULT_STEP_DATES.map(([start, end], i) => ({ name: off?.steps[i]?.name ?? STEP_NAMES[i], start, end, batch: i === 0 })),
      test: false,
      runNow: true,
    };
  }

  protected readonly tlForm = form(this.draft, (f) => {
    required(f.name, { message: 'Enter a name for the timeline.', when: () => !this.isOfficialEdit() });
    validate(f.programs, ({ value }) =>
      !this.isMain() && !value().length ? { kind: 'required', message: 'Select at least one program.' } : undefined,
    );
    applyEach(f.steps, (s) => {
      required(s.name, { message: 'Enter a name for the step.' });
      // Live data: both dates of every step are required (the API has no open-ended step).
      validate(s.start, ({ value }) => (this.live() && !toApiDay(value()) ? { kind: 'date', message: 'Enter an opening date, for example 06 Jul 2026.' } : undefined));
      validate(s.end, ({ value }) => (this.live() && !toApiDay(value()) ? { kind: 'date', message: 'Enter a closing date, for example 11 Jul 2026.' } : undefined));
    });
  });

  protected readonly tried = linkedSignal({ source: this.request, computation: () => false });
  protected readonly confirmRow = linkedSignal<TimelineRequest, number | null>({ source: this.request, computation: () => null });

  protected readonly nameError = computed(
    () => (this.tried() || this.tlForm.name().touched() ? (this.tlForm.name().errors()[0]?.message ?? '') : '') || this.serverError('name'),
  );
  protected readonly programsError = computed(
    () => (this.tried() ? (this.tlForm.programs().errors()[0]?.message ?? '') : '') || this.serverError('programIds'),
  );

  /** First server message on exactly this field (`name`, `programIds`…). */
  protected serverError(field: string): string {
    return this.feedback()?.fields.find((f) => f.field === field)?.message ?? '';
  }

  /** Form errors of a row after a save attempt, then the server's ones (`steps[i].<key>`, i = place in the timeline). */
  protected rowServerError(i: number): string {
    if (this.tried()) {
      const row = this.tlForm.steps[i];
      const local = row ? [...row.start().errors(), ...row.end().errors()][0]?.message : '';
      if (local) return local;
    }
    return this.feedback()?.fields.find((f) => f.field.startsWith(`steps[${i}]`))?.message ?? '';
  }

  /** Whole-list problems: step 1 must load results (live data), or the server's `steps` message. */
  protected readonly stepsError = computed(() => {
    const first = this.draft().steps[0];
    if (this.live() && this.tried() && first && !first.batch) return 'Step 1 must load results.';
    return this.serverError('steps');
  });
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
    this.draft.update((d) => {
      if (d.steps.length >= this.maxSteps()) return d;
      const audience = this.live() ? nextAudience(d.steps.flatMap((s) => (s.audience ? [s.audience] : []))) ?? undefined : undefined;
      return { ...d, steps: [...d.steps, { name: '', start: '', end: '', batch: false, audience }] };
    });
  }

  protected removeRow(i: number): void {
    this.confirmRow.set(null);
    this.draft.update((d) => ({ ...d, steps: d.steps.filter((_, k) => k !== i) }));
  }

  protected resetRows(): void {
    this.confirmRow.set(null);
    const official = this.official();
    if (official) this.draft.update((d) => ({ ...d, steps: officialRelative(d.steps[0]?.start ?? '', official) }));
  }

  protected save(): void {
    this.tried.set(true);
    if (this.tlForm().invalid() || this.orderErrors().some(Boolean)) return;
    if (this.live() && this.draft().steps[0] && !this.draft().steps[0].batch) return;
    if (this.activeChanged()) {
      this.confirmActive.set(true);
      return;
    }
    this.commit();
  }

  protected commit(confirmed = false): void {
    this.confirmActive.set(false);
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
        .map((s) => ({ name: s.name.trim(), start: s.start.trim(), end: s.end.trim(), batch: s.batch, audience: s.audience })),
      confirmed,
    });
    // Live data: the parent closes the drawer once the server saved it.
    if (!this.live()) this.open.set(false);
  }
}
