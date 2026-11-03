import { Component, computed, effect, input, linkedSignal, model, output, untracked } from '@angular/core';
import { FormField, form, required, validate } from '@angular/forms/signals';
import { HlmInput } from '@spartan/input';
import { QaButtonImports, QaDatePicker, QaDialogImports, QaDrawerImports, QaSegmented, QaSelect, QaSwitch, QaTooltipImports, discardGuard } from '../../../ui';
import { AUDIENCES, CORRECTION_AUDIENCE, CycleStep, DEMO_ACCESS, PROGRAMS, ReopenMode, Timeline } from './cycle.mock';
import { formatNumber, parseDate, stepState } from './cycle.logic';
import { boundaryPart, stepDateIssues, toApiDay } from './cycle.mapper';
import { DEFAULT_CLOSES_TIME, DEFAULT_OPENS_TIME, parseTime, zoneAt } from '../../../core/domain/rome-date';
import type { TimelineSaveFeedback } from './timeline-drawer';

/** Which step the drawer edits (index) or which timeline gets a new step (index null). */
export interface StepRequest {
  timeline: Timeline;
  isOfficial: boolean;
  index: number | null;
}

export interface StepSaveEvent {
  timelineId: string;
  isOfficial: boolean;
  index: number | null;
  step: Pick<CycleStep, 'name' | 'audience' | 'start' | 'end' | 'startTime' | 'endTime' | 'batch' | 'reopen' | 'access'>;
  /** The admin already agreed to change a step in progress (live data: sent up front). */
  confirmed: boolean;
}

interface AccessRow {
  code: string;
  range: string;
  isNew: boolean;
}

interface StepDraft {
  name: string;
  audience: string;
  opens: string;
  closes: string;
  /** Rome `HH:mm`, 24-hour, as typed. */
  opensTime: string;
  closesTime: string;
  batch: boolean;
  reopen: ReopenMode;
  access: AccessRow[];
}

/** "Edit step" / "New step" drawer (every step card and every "Add step" button). */
@Component({
  selector: 'qa-cycle-step-drawer',
  imports: [FormField, QaButtonImports, HlmInput, QaDatePicker, QaDialogImports, QaDrawerImports, QaSegmented, QaSelect, QaSwitch, QaTooltipImports],
  template: `
    <qa-drawer [(open)]="open" [closeGuard]="discard.guard" [title]="title()" [subtitle]="request().timeline.name" width="720px">
      @if (open()) {
        @let d = draft();
        <div class="flex flex-col items-stretch gap-[6px]">
          <div class="flex items-center gap-1">
            <label for="cycle-step-name" class="text-(length:--fs-13) font-semibold text-(--text-2)">Step name</label>
            <span aria-hidden="true" class="text-(length:--fs-13) font-semibold text-(--danger-strong)">*</span>
            <button type="button" qaTooltip="This is what assessors read in the timeline. Describe what happens, not who does it." aria-label="More about Step name" class="flex size-4 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-(--text-muted) outline-none hover:text-(--primary) focus-visible:shadow-(--focus-ring)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" /></svg></button>
          </div>
          <input
            hlmInput
            id="cycle-step-name"
            type="text"
            [formField]="stepForm.name"
            placeholder="QA platform open for assessors"
            [attr.aria-invalid]="nameError() ? true : null"
            [attr.aria-describedby]="nameError() ? 'cycle-step-name-err' : null"
            [attr.data-error]="!!nameError()"
            class="h-9 w-full rounded-[8px] border-(--border) bg-(--field-bg) px-3 py-0 text-(length:--fs-14) text-(--text) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[error=true]:border-(--danger) md:text-(length:--fs-14) dark:bg-(--field-bg)"
          />
          @if (nameError()) {
            <span id="cycle-step-name-err" class="text-(length:--fs-13) text-(--danger)">{{ nameError() }}</span>
          }
        </div>

        <div class="flex flex-col items-start gap-[6px]">
          <span id="cycle-step-who" class="text-(length:--fs-13) font-semibold text-(--text-2)">Who can work in this step</span>
          @if (d.audience === correctionAudience) {
            <div aria-labelledby="cycle-step-who" class="box-border w-full rounded-[8px] border border-(--border) bg-(--surface-3) px-3 py-[10px] text-(length:--fs-14) text-(--text)">Nobody works in QA during this step</div>
            <div class="text-(length:--fs-13) leading-[1.5] font-normal text-pretty text-(--text-4)">Programs correct their results in the reporting tool. QA picks up the changes automatically.</div>
          } @else if (locked() || live()) {
            <!-- Read-only: the step is completed, or (live data) the audience is fixed once the timeline exists. -->
            <div aria-labelledby="cycle-step-who" class="flex h-9 min-w-[280px] items-center rounded-[8px] border border-(--border) bg-(--surface-3) px-3 text-(length:--fs-14) text-(--text)">{{ d.audience }}</div>
          } @else {
            <qa-select [value]="d.audience || null" (valueChange)="patch({ audience: $event ?? '' })" [options]="audienceOptions" label="Who can work in this step" placeholder="Select who can work" class="w-[280px]" />
          }
        </div>

        @if (locked()) {
          <!-- Closed step: its dates are the record of the cycle, so they read as text. -->
          <div class="flex flex-col items-start gap-[6px]">
            <span id="cycle-step-dates" class="text-(length:--fs-13) font-semibold text-(--text-2)">Dates</span>
            <span aria-labelledby="cycle-step-dates" class="font-(family-name:--qa-mono) text-(length:--fs-14) text-(--text) tabular-nums">{{ d.opens }}, {{ d.opensTime }} – {{ d.closes ? d.closes + ', ' + d.closesTime : 'no closing date' }} {{ zoneText() }}</span>
            <span class="text-(length:--fs-13) leading-[1.5] font-normal text-pretty text-(--text-4)">This step closed{{ d.closes ? ' on ' + d.closes + ' at ' + d.closesTime : '' }} (Rome time). Its dates stay as the record of the cycle.</span>
          </div>
        } @else {
        <div class="flex flex-col items-start gap-[6px]">
          <div class="flex flex-wrap gap-3">
            <div class="flex flex-col gap-[6px]">
              <span id="cycle-step-opens" class="text-(length:--fs-13) font-semibold text-(--text-2)">Opens</span>
              @if (opensLocked()) {
                <span class="flex h-9 items-center font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text-3) tabular-nums">{{ d.opens }}, {{ d.opensTime }}</span>
              } @else {
              <span class="flex gap-1.5">
              <span class="relative flex">
                <input
                  hlmInput
                  type="text"
                  [formField]="stepForm.opens"
                  aria-labelledby="cycle-step-opens"
                  placeholder="06 Jul 2026"
                  [attr.aria-invalid]="bad().opens ? true : null"
                  [attr.aria-describedby]="opensError() ? 'cycle-step-opens-err' : null"
                  [attr.data-error]="bad().opens"
                  class="h-9 w-[180px] rounded-[8px] border-(--border) bg-(--field-bg) py-0 pr-10 pl-3 font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text) tabular-nums shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[error=true]:border-(--danger) md:text-(length:--fs-13) dark:bg-(--field-bg)"
                />
                <qa-date-picker [value]="stepForm.opens().value()" (valueChange)="stepForm.opens().value.set($event)" label="Pick the opening date" class="absolute top-1/2 right-1 -translate-y-1/2" />
              </span>
              <input
                hlmInput
                type="text"
                inputmode="numeric"
                [formField]="stepForm.opensTime"
                aria-label="Opening time, 24-hour, Rome"
                placeholder="00:00"
                (blur)="tidyTime('opensTime')"
                [attr.aria-invalid]="bad().opensTime ? true : null"
                [attr.aria-describedby]="opensError() ? 'cycle-step-opens-err' : null"
                [attr.data-error]="bad().opensTime"
                class="h-9 w-[72px] rounded-[8px] border-(--border) bg-(--field-bg) px-3 py-0 font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text) tabular-nums shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[error=true]:border-(--danger) md:text-(length:--fs-13) dark:bg-(--field-bg)"
              />
              </span>
              }
            </div>
            <div class="flex flex-col gap-[6px]">
              <span id="cycle-step-closes" class="text-(length:--fs-13) font-semibold text-(--text-2)">Closes</span>
              <span class="flex gap-1.5">
                <span class="relative flex">
                  <input hlmInput type="text" [formField]="stepForm.closes" aria-labelledby="cycle-step-closes" placeholder="11 Jul 2026" [attr.aria-invalid]="bad().closes ? true : null" [attr.aria-describedby]="opensError() ? 'cycle-step-opens-err' : null" [attr.data-error]="bad().closes" class="h-9 w-[180px] rounded-[8px] border-(--border) bg-(--field-bg) py-0 pr-10 pl-3 font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text) tabular-nums shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[error=true]:border-(--danger) md:text-(length:--fs-13) dark:bg-(--field-bg)" />
                  <qa-date-picker [value]="stepForm.closes().value()" (valueChange)="stepForm.closes().value.set($event)" label="Pick the closing date" class="absolute top-1/2 right-1 -translate-y-1/2" />
                </span>
                <input
                  hlmInput
                  type="text"
                  inputmode="numeric"
                  [formField]="stepForm.closesTime"
                  aria-label="Closing time, 24-hour, Rome"
                  placeholder="23:59"
                  (blur)="tidyTime('closesTime')"
                  [attr.aria-invalid]="bad().closesTime ? true : null"
                  [attr.aria-describedby]="opensError() ? 'cycle-step-opens-err' : null"
                  [attr.data-error]="bad().closesTime"
                  class="h-9 w-[72px] rounded-[8px] border-(--border) bg-(--field-bg) px-3 py-0 font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text) tabular-nums shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[error=true]:border-(--danger) md:text-(length:--fs-13) dark:bg-(--field-bg)"
                />
              </span>
            </div>
          </div>
          <span class="text-(length:--fs-13) font-normal text-(--text-4)">Rome time ({{ zoneText() }}), 24-hour clock.</span>
          @if (opensError()) {
            <span id="cycle-step-opens-err" class="text-(length:--fs-13) text-(--danger)">{{ opensError() }}</span>
          }
          @if (opensLocked()) {
            <span class="text-(length:--fs-13) leading-[1.5] font-normal text-pretty text-(--text-4)">This step is open, so its opening date and time stay. You can still move its closing date and time.</span>
          }
          @if (feedbackText(); as message) {
            <span role="alert" class="text-(length:--fs-13) text-(--danger)">{{ message }}</span>
          }
        </div>
        }

        <div class="flex flex-col items-stretch gap-[6px]">
          <div class="flex min-h-[52px] items-center gap-4">
            <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span id="cycle-step-load" class="text-(length:--fs-14) font-medium text-(--text-2)">Load results when this step opens</span>
              <span class="text-(length:--fs-13) font-normal text-pretty text-(--text-4)">Brings in results submitted since the last load, plus anything the programs corrected.</span>
            </div>
            @if (live()) {
              <span class="text-(length:--fs-13) text-(--text-3)">{{ d.batch ? 'Yes' : 'No' }}</span>
            } @else {
              <qa-switch [checked]="d.batch" (checkedChange)="patch({ batch: $event })" aria-labelledby="cycle-step-load" />
            }
          </div>
          @if (d.batch) {
            <div class="-mt-[6px] flex items-center gap-1.5 text-(length:--fs-12) font-medium text-(--accent)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" /></svg>
              <span>This step starts QA round {{ round() }}</span>
            </div>
          } @else if (first()) {
            <div role="status" class="-mt-[6px] rounded-[8px] bg-(--st-editing-bg) px-3 py-2 text-(length:--fs-13) leading-[1.5] text-(--st-editing-fg)">Step 1 doesn't load results, so this timeline starts with nothing to assess.</div>
          }
        </div>

        @if (live()) {
          <div class="flex flex-col items-start gap-1 rounded-[8px] bg-(--surface-3) px-3 py-2">
            <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Reopened fields and extended access</span>
            <span class="text-(length:--fs-13) text-(--text-4)">Coming soon.</span>
          </div>
        } @else {
        @if (d.batch && !first()) {
          <div class="flex flex-col items-start gap-[6px]">
            <span id="cycle-step-reopen" class="text-(length:--fs-13) font-semibold text-(--text-2)">Fields reopened in this step</span>
            <qa-segmented [value]="d.reopen" (valueChange)="patch({ reopen: $event === 'all' ? 'all' : 'comments' })" [options]="reopenOptions" size="compact" aria-labelledby="cycle-step-reopen" />
          </div>
        }

        <div class="flex flex-col items-stretch gap-[6px]">
          <div class="flex items-center gap-1">
            <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Extended access</span>
            <button type="button" qaTooltip="Give specific programs more time to correct their results after this step closes for everyone else." aria-label="More about Extended access" class="flex size-4 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-(--text-muted) outline-none hover:text-(--primary) focus-visible:shadow-(--focus-ring)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" /></svg></button>
          </div>
          <div class="flex flex-col rounded-[8px] border border-(--border)">
            @for (a of d.access; track $index) {
              <div class="flex min-h-12 flex-wrap items-center gap-3 border-b border-(--surface-4) px-[14px] max-sm:py-2">
                @if (a.isNew) {
                  <input hlmInput type="text" aria-label="Program code" [value]="a.code" (input)="patchAccess($index, { code: value($event) })" placeholder="SP01" class="h-8 w-20 flex-none rounded-[8px] border-(--border) bg-(--field-bg) px-[10px] py-0 font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 md:text-(length:--fs-13) dark:bg-(--field-bg)" />
                  <span class="min-w-0 flex-1 truncate text-(length:--fs-14) text-(--text)">{{ programName(a.code) }}</span>
                  <span class="relative flex flex-none max-sm:order-last max-sm:basis-full">
                    <input hlmInput type="text" aria-label="Access dates" [value]="a.range" (input)="patchAccess($index, { range: value($event) })" placeholder="20 Jul – 24 Jul 2026" class="h-8 w-[220px] min-w-0 flex-none max-sm:w-full rounded-[8px] border-(--border) bg-(--field-bg) py-0 pr-9 pl-[10px] font-(family-name:--qa-mono) text-(length:--fs-12) text-(--text) tabular-nums shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 md:text-(length:--fs-12) dark:bg-(--field-bg)" />
                    <qa-date-picker mode="range" [value]="a.range" (valueChange)="patchAccess($index, { range: $event })" label="Pick the access dates" class="absolute top-1/2 right-0.5 -translate-y-1/2" />
                  </span>
                } @else {
                  <span class="flex-none font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--text-2)">{{ a.code }}</span>
                  <span class="min-w-0 truncate text-(length:--fs-14) text-(--text)">{{ programName(a.code) }}</span>
                  <span class="ml-auto flex-none font-(family-name:--qa-mono) text-(length:--fs-12) text-(--text-4) tabular-nums">{{ a.range }}</span>
                }
                <button type="button" [attr.aria-label]="'Remove access for ' + (a.code || 'new program')" (click)="removeAccess($index)" class="flex size-6 flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-(--text-3) outline-none hover:text-(--danger) focus-visible:shadow-(--focus-ring)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
              </div>
            }
            <div class="px-[10px] py-2">
              <button hlmBtn qaBtn tone="link" size="sm" type="button" (click)="addAccess()">Give a program extra time</button>
            </div>
          </div>
        </div>
        }
      }

      <div qaDrawerFooter class="contents">
        @if (discard.confirming()) {
          <div role="alertdialog" aria-label="Discard changes" class="mr-auto flex min-w-0 flex-[1_1_280px] flex-col gap-1">
            <span class="text-(length:--fs-13) leading-[1.55] font-normal text-(--text-2)">Discard what you wrote?</span>
          </div>
          <button hlmBtn qaBtn tone="secondary" type="button" (click)="discard.keepWriting()">Keep writing</button>
          <button hlmBtn qaBtn tone="danger" type="button" (click)="discard.discard()">Discard and close</button>
        } @else if (confirmRemove()) {
          <div role="alertdialog" aria-label="Remove step" class="flex w-full flex-wrap items-center justify-end gap-[10px]">
            <div class="mr-auto flex min-w-0 flex-[1_1_280px] flex-col gap-1">
              <span class="text-(length:--fs-13) leading-[1.55] font-normal text-(--text-2)">Remove this step? Results in it go back to the previous step.</span>
            </div>
            <button hlmBtn qaBtn tone="secondary" type="button" (click)="confirmRemove.set(false)">Keep it</button>
            <button hlmBtn qaBtn tone="danger" type="button" (click)="doRemove()">Remove</button>
          </div>
        } @else {
          @if (isEdit() && !locked() && !live()) {
            <button hlmBtn qaBtn tone="danger-quiet" type="button" (click)="confirmRemove.set(true)" class="mr-auto">Remove step</button>
          }
          @if (loadedNote()) {
            <span class="flex items-center gap-1.5 text-(length:--fs-13) font-normal text-(--text-4)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>{{ loadedNote() }}</span>
          } @else if (canLoad() && !live()) {
            <button hlmBtn qaBtn tone="secondary" type="button" (click)="loadIntoStep.emit()" class="gap-[7px]"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M12 3v12M8 11l4 4 4-4M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" /></svg>Load results into this step</button>
          }
          <button hlmBtn qaBtn tone="secondary" type="button" (click)="discard.requestClose()">Cancel</button>
          @if (!locked()) {
            <button hlmBtn qaBtn tone="primary" type="button" (click)="save()" [loading]="saving()">{{ saving() ? 'Saving…' : isEdit() ? 'Save step' : 'Add step' }}</button>
          }
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
export class StepDrawer {
  readonly open = model(false);
  readonly request = input.required<StepRequest>();

  readonly saveStep = output<StepSaveEvent>();
  /** Live data (API): name and dates only; the parent closes the drawer once the server saved it. */
  readonly live = input(false);
  readonly saving = input(false);
  readonly feedback = input<TimelineSaveFeedback | null>(null);
  /** One step has no row of its own to mark: show the server's first field message, else its message. */
  private readonly feedbackDraft = linkedSignal({ source: this.feedback, computation: () => untracked(() => JSON.stringify(this.draft())) });
  /** Hidden as soon as the step is edited again (it described the values that were sent). */
  protected readonly feedbackText = computed(() => {
    const fb = this.feedback();
    if (!fb || this.feedbackDraft() !== JSON.stringify(this.draft())) return '';
    return fb.fields[0]?.message ?? fb.message ?? '';
  });
  readonly removeStep = output<void>();
  /** "Load results into this step" (sub-timeline steps that load results and have not run yet). */
  readonly loadIntoStep = output<void>();

  protected readonly correctionAudience = CORRECTION_AUDIENCE;
  protected readonly audienceOptions = AUDIENCES.filter((a) => a !== CORRECTION_AUDIENCE).map((a) => ({ value: a, label: a }));
  protected readonly reopenOptions = [
    { value: 'comments', label: 'Fields with comments only' },
    { value: 'all', label: 'All assessed fields' },
  ];

  private readonly existing = computed(() => {
    const r = this.request();
    return r.index == null ? null : (r.timeline.steps[r.index] ?? null);
  });
  protected readonly isEdit = computed(() => this.existing() != null);
  protected readonly locked = computed(() => {
    const p = this.existing();
    return !!p && stepState(p, this.request().timeline).kind === 'done';
  });
  /** The step is running now: saving a change asks first (pop-up). */
  private readonly activeState = computed(() => {
    const p = this.existing();
    const st = p ? stepState(p, this.request().timeline) : null;
    return st?.kind === 'active' ? st : null;
  });
  protected readonly inProgress = computed(() => !!this.activeState());
  /** Live data: an open step keeps its opening day (the server answers LOCKED otherwise). */
  protected readonly opensLocked = computed(() => this.live() && this.inProgress());
  protected readonly activeNote = computed(() => {
    const st = this.activeState();
    const who = this.existing()?.audience ?? 'Assessors';
    if (who === CORRECTION_AUDIENCE) return 'Programs are correcting their results in this step right now. Your changes apply as soon as you save.';
    const progress = st && st.of ? ` (${formatNumber(st.done)} of ${formatNumber(st.of)} results reviewed so far)` : '';
    return `${who} are working in this step right now${progress}. Your changes apply as soon as you save.`;
  });
  private readonly changed = computed(() => {
    const p = this.existing();
    const d = this.draft();
    if (!p) return false;
    const moved =
      d.opens.trim() !== p.start ||
      d.closes.trim() !== p.end ||
      (parseTime(d.opensTime) ?? d.opensTime) !== (p.startTime || DEFAULT_OPENS_TIME) ||
      (parseTime(d.closesTime) ?? d.closesTime) !== (p.endTime || DEFAULT_CLOSES_TIME);
    return d.name.trim() !== p.name || d.audience !== p.audience || moved || d.batch !== p.batch;
  });
  /** Also opens when the server asks (409 TIMELINES_IN_PROGRESS_UNCONFIRMED). */
  protected readonly confirmActive = linkedSignal({
    source: () => ({ request: this.request(), feedback: this.feedback() }),
    computation: ({ feedback }) => !!feedback?.needsConfirm,
  });

  protected readonly first = computed(() => {
    const r = this.request();
    return r.index === 0 || (r.index == null && !r.timeline.steps.length);
  });

  protected readonly draft = linkedSignal<StepDraft>(() => this.initialDraft());
  /** Esc / overlay / X / Cancel ask before dropping edits (also blocks tab close while open). */
  protected readonly discard = discardGuard(this.open, () => JSON.stringify(this.draft()) !== JSON.stringify(this.initialDraft()));

  private initialDraft(): StepDraft {
    const r = this.request();
    const p = this.existing();
    if (!p) {
      return {
        name: '',
        audience: AUDIENCES[r.timeline.steps.length] ?? 'Assessors',
        opens: '',
        closes: '',
        opensTime: DEFAULT_OPENS_TIME,
        closesTime: DEFAULT_CLOSES_TIME,
        batch: false,
        reopen: 'comments',
        access: [],
      };
    }
    return {
      name: p.name,
      audience: p.audience,
      opens: p.start,
      closes: p.end,
      opensTime: p.startTime || DEFAULT_OPENS_TIME,
      closesTime: p.endTime || DEFAULT_CLOSES_TIME,
      batch: p.batch,
      reopen: p.reopen ?? 'comments',
      access: (p.access ?? DEMO_ACCESS).map((a) => ({ ...a, isNew: false })),
    };
  }

  protected readonly stepForm = form(this.draft, (f) => {
    required(f.name, { message: 'Enter a name for the step.' });
    validate(f.closes, ({ value }) =>
      this.live() && !toApiDay(value()) ? { kind: 'date', message: 'Enter a closing date, for example 11 Jul 2026.' } : undefined,
    );
    validate(f.opens, ({ value }) =>
      (this.live() ? toApiDay(value()) : parseDate(value())) ? undefined : { kind: 'date', message: 'Enter an opening date, for example 06 Jul 2026.' },
    );
    validate(f.opensTime, ({ value }) => (parseTime(value()) ? undefined : { kind: 'time', message: 'Enter an opening time, for example 09:00.' }));
    validate(f.closesTime, ({ value }) =>
      this.live() && !parseTime(value()) ? { kind: 'time', message: 'Enter a closing time, for example 17:30.' } : undefined,
    );
  });

  constructor() {
    // Each opening starts with a clean form (no touched fields from the last step).
    effect(() => {
      this.request();
      untracked(() => this.stepForm().reset());
    });
  }

  /** Errors show once a field is left or after a save attempt (same as Assessors). */
  private readonly tried = linkedSignal({ source: this.request, computation: () => false });
  protected readonly confirmRemove = linkedSignal({ source: this.request, computation: () => false });

  protected readonly nameError = computed(() => (this.tried() || this.stepForm.name().touched() ? (this.stepForm.name().errors()[0]?.message ?? '') : ''));
  /**
   * Live data: the server's date rules against the steps around this one, checked as the admin types
   * (closing before opening, opening on or before the previous step closes, closing on or after the next one opens).
   */
  private readonly liveIssues = computed((): { start?: string; end?: string } => {
    const r = this.request();
    if (!this.live() || r.index == null) return {};
    const d = this.draft();
    const rows = r.timeline.steps.map((p, i) =>
      i === r.index
        ? { start: d.opens, end: d.closes, startTime: d.opensTime, endTime: d.closesTime }
        : { start: p.start, end: p.end, startTime: p.startTime || DEFAULT_OPENS_TIME, endTime: p.endTime || DEFAULT_CLOSES_TIME },
    );
    const issues = stepDateIssues(rows);
    const own = issues[r.index];
    const after = rows[r.index + 1];
    const next = issues[r.index + 1]?.start ? `Must close before step ${r.index + 2} opens (${after.start}, ${after.startTime}).` : undefined;
    return { start: own.start, end: own.end ?? next };
  });
  protected readonly liveDateIssue = computed(() => this.liveIssues().start ?? this.liveIssues().end ?? '');

  /** Inputs to outline: only the ones a problem points at (the day, the time, or both for an order rule). */
  protected readonly bad = computed(() => {
    const f = this.stepForm;
    const d = this.draft();
    const live = this.liveIssues();
    const shown = (x: typeof f.opens) => (this.tried() || x().touched()) && x().errors().length > 0;
    const [ps, pe] = [boundaryPart(d.opens, d.opensTime), boundaryPart(d.closes, d.closesTime)];
    return {
      opens: shown(f.opens) || (!!live.start && ps !== 'time'),
      opensTime: shown(f.opensTime) || (!!live.start && ps !== 'day'),
      closes: shown(f.closes) || (!!live.end && pe !== 'time'),
      closesTime: shown(f.closesTime) || (!!live.end && pe !== 'day'),
    };
  });

  protected readonly opensError = computed(() => {
    const f = this.stepForm;
    const fields = [f.opens, f.opensTime, f.closes, f.closesTime];
    if (this.liveDateIssue()) return this.liveDateIssue();
    if (!this.tried() && !fields.some((x) => x().touched())) return '';
    return fields.map((x) => x().errors()[0]?.message).find(Boolean) ?? '';
  });

  /** Rome zone of the step's minutes ("CET", or "CEST / CET" across a clock change). */
  protected readonly zoneText = computed(() => {
    const d = this.draft();
    const zones = [
      [d.opens, d.opensTime],
      [d.closes, d.closesTime],
    ].flatMap(([day, time]) => {
      const iso = toApiDay(day);
      const t = parseTime(time);
      return iso && t ? [zoneAt(iso, t)] : [];
    });
    return [...new Set(zones)].join(' / ') || 'CET / CEST';
  });

  protected readonly title = computed(() => this.draft().name.trim() || 'New step');

  protected readonly round = computed(() => {
    const r = this.request();
    const upto = r.index ?? r.timeline.steps.length;
    return r.timeline.steps.slice(0, upto).filter((p) => p.batch).length + 1;
  });

  private readonly canRun = computed(() => !this.request().isOfficial && this.isEdit() && this.draft().batch);
  protected readonly loadedNote = computed(() => (this.canRun() ? (this.existing()?.ran ?? '') : ''));
  protected readonly canLoad = computed(() => this.canRun() && !this.existing()?.ran);

  protected patch(p: Partial<StepDraft>): void {
    this.draft.update((d) => ({ ...d, ...p }));
  }

  protected patchAccess(i: number, p: Partial<AccessRow>): void {
    this.draft.update((d) => ({ ...d, access: d.access.map((a, j) => (j === i ? { ...a, ...p } : a)) }));
  }

  protected addAccess(): void {
    this.draft.update((d) => ({ ...d, access: [...d.access, { code: '', range: '', isNew: true }] }));
  }

  protected removeAccess(i: number): void {
    this.draft.update((d) => ({ ...d, access: d.access.filter((_, j) => j !== i) }));
  }

  /** `9` → `09:00` once the admin leaves the field. */
  protected tidyTime(key: 'opensTime' | 'closesTime'): void {
    const t = parseTime(this.draft()[key]);
    if (t && t !== this.draft()[key]) this.patch({ [key]: t });
  }

  protected programName(code: string): string {
    return PROGRAMS[(code || '').trim().toUpperCase()] ?? '';
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected save(): void {
    this.tried.set(true);
    if (this.stepForm().invalid() || this.liveDateIssue()) return;
    if (this.inProgress() && this.changed()) {
      this.confirmActive.set(true);
      return;
    }
    this.commit();
  }

  protected commit(confirmed = false): void {
    this.confirmActive.set(false);
    const d = this.draft();
    const r = this.request();
    // TODO(api): PUT / POST the step of this timeline.
    this.saveStep.emit({
      timelineId: r.timeline.id,
      isOfficial: r.isOfficial,
      index: r.index,
      step: {
        name: d.name.trim(),
        audience: d.audience,
        start: d.opens.trim(),
        end: d.closes.trim(),
        startTime: parseTime(d.opensTime) ?? d.opensTime.trim(),
        endTime: parseTime(d.closesTime) ?? d.closesTime.trim(),
        batch: d.batch,
        reopen: d.reopen,
        access: d.access.filter((a) => a.code.trim()).map((a) => ({ code: a.code.trim().toUpperCase(), range: a.range.trim() })),
      },
      confirmed,
    });
    if (!this.live()) this.open.set(false);
  }

  protected doRemove(): void {
    // TODO(api): DELETE the step; its results go back to the previous step.
    this.removeStep.emit();
    this.open.set(false);
  }
}
