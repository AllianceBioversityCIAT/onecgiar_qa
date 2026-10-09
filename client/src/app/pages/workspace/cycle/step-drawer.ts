import { Component, computed, input, linkedSignal, model, output } from '@angular/core';
import { FormField, form, required, validate } from '@angular/forms/signals';
import { HlmButton } from '@spartan/button';
import { HlmInput } from '@spartan/input';
import { QaDatePicker, QaDrawerImports, QaSegmented, QaSelect, QaSwitch, QaTooltipImports } from '../../../ui';
import { AUDIENCES, CORRECTION_AUDIENCE, CycleStep, DEMO_ACCESS, PROGRAMS, ReopenMode, Timeline } from './cycle.mock';
import { parseDate, stepState } from './cycle.logic';

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
  step: Pick<CycleStep, 'name' | 'audience' | 'start' | 'end' | 'batch' | 'reopen' | 'access'>;
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
  batch: boolean;
  reopen: ReopenMode;
  access: AccessRow[];
}

/** "Edit step" / "New step" drawer (every step card and every "Add step" button). */
@Component({
  selector: 'qa-cycle-step-drawer',
  imports: [FormField, HlmButton, HlmInput, QaDatePicker, QaDrawerImports, QaSegmented, QaSelect, QaSwitch, QaTooltipImports],
  template: `
    <qa-drawer [(open)]="open" [title]="title()" [subtitle]="request().timeline.name" width="720px">
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
            [attr.data-invalid]="!!nameError()"
            class="h-9 w-full rounded-[8px] border-(--border) bg-(--field-bg) px-3 py-0 text-(length:--fs-14) text-(--text) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[invalid=true]:border-(--danger) md:text-(length:--fs-14) dark:bg-(--field-bg)"
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
          } @else if (locked()) {
            <!-- Read-only because the step is already completed. -->
            <div aria-labelledby="cycle-step-who" class="flex h-9 min-w-[280px] items-center rounded-[8px] border border-(--border) bg-(--surface-3) px-3 text-(length:--fs-14) text-(--text)">{{ d.audience }}</div>
          } @else {
            <qa-select [value]="d.audience || null" (valueChange)="patch({ audience: $event ?? '' })" [options]="audienceOptions" label="Who can work in this step" placeholder="Select who can work" class="w-[280px]" />
          }
        </div>

        <div class="flex flex-col items-start gap-[6px]">
          <div class="flex flex-wrap gap-3">
            <label class="flex flex-col gap-[6px]">
              <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Opens</span>
              <span class="relative flex">
                <input
                  hlmInput
                  type="text"
                  [formField]="stepForm.opens"
                  placeholder="06 Jul 2026"
                  [attr.aria-invalid]="opensError() ? true : null"
                  [attr.aria-describedby]="opensError() ? 'cycle-step-opens-err' : null"
                  [attr.data-invalid]="!!opensError()"
                  class="h-9 w-[180px] rounded-[8px] border-(--border) bg-(--field-bg) py-0 pr-10 pl-3 font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text) tabular-nums shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 data-[invalid=true]:border-(--danger) md:text-(length:--fs-13) dark:bg-(--field-bg)"
                />
                <qa-date-picker [value]="stepForm.opens().value()" (valueChange)="stepForm.opens().value.set($event)" label="Pick the opening date" class="absolute top-1/2 right-1 -translate-y-1/2" />
              </span>
            </label>
            <label class="flex flex-col gap-[6px]">
              <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Closes</span>
              <span class="relative flex">
                <input hlmInput type="text" [formField]="stepForm.closes" placeholder="11 Jul 2026" class="h-9 w-[180px] rounded-[8px] border-(--border) bg-(--field-bg) py-0 pr-10 pl-3 font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text) tabular-nums shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 md:text-(length:--fs-13) dark:bg-(--field-bg)" />
                <qa-date-picker [value]="stepForm.closes().value()" (valueChange)="stepForm.closes().value.set($event)" label="Pick the closing date" class="absolute top-1/2 right-1 -translate-y-1/2" />
              </span>
            </label>
          </div>
          @if (opensError()) {
            <span id="cycle-step-opens-err" class="text-(length:--fs-13) text-(--danger)">{{ opensError() }}</span>
          }
        </div>

        <div class="flex flex-col items-stretch gap-[6px]">
          <div class="flex min-h-[52px] items-center gap-4">
            <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span id="cycle-step-load" class="text-(length:--fs-14) font-medium text-(--text-2)">Load results when this step opens</span>
              <span class="text-(length:--fs-13) font-normal text-pretty text-(--text-4)">Brings in results submitted since the last load, plus anything the programs corrected.</span>
            </div>
            <qa-switch [checked]="d.batch" (checkedChange)="patch({ batch: $event })" aria-labelledby="cycle-step-load" />
          </div>
          @if (d.batch) {
            <div class="-mt-[6px] flex items-center gap-1.5 text-(length:--fs-12) font-medium text-(--accent)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" /></svg>
              <span>This step starts QA round {{ round() }}</span>
            </div>
          }
        </div>

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
              <button type="button" (click)="addAccess()" class="min-h-8 cursor-pointer rounded-[8px] border-0 bg-transparent px-[10px] text-(length:--fs-13) font-medium text-(--accent) outline-none hover:bg-(--tint) focus-visible:shadow-(--focus-ring)">Give a program extra time</button>
            </div>
          </div>
        </div>
      }

      <div qaDrawerFooter class="contents">
        @if (confirmRemove()) {
          <div role="alertdialog" aria-label="Remove step" class="flex w-full flex-wrap items-center justify-end gap-[10px]">
            <div class="mr-auto flex min-w-0 flex-[1_1_280px] flex-col gap-1">
              <span class="text-(length:--fs-13) leading-[1.55] font-normal text-(--text-2)">Remove this step? Results in it go back to the previous step.</span>
            </div>
            <button hlmBtn variant="ghost" type="button" (click)="confirmRemove.set(false)" class="h-9 rounded-[8px] border border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium text-(--text-2) hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:border-(--border) focus-visible:ring-0 focus-visible:shadow-(--focus-ring) dark:hover:bg-(--surface-2)">Keep it</button>
            <button hlmBtn type="button" (click)="doRemove()" class="h-9 rounded-[8px] bg-(--danger) px-[14px] text-(length:--fs-14) font-semibold whitespace-nowrap text-(--surface) hover:bg-(--danger) focus-visible:border-transparent focus-visible:ring-0 focus-visible:shadow-(--focus-ring)">Remove</button>
          </div>
        } @else {
          @if (isEdit()) {
            <button hlmBtn variant="ghost" type="button" (click)="confirmRemove.set(true)" class="mr-auto h-9 rounded-[8px] border border-(--border) bg-(--surface) px-[14px] text-(length:--fs-14) font-medium whitespace-nowrap text-(--danger) hover:border-(--danger) hover:bg-(--danger-bg) hover:text-(--danger) focus-visible:border-(--border) focus-visible:ring-0 focus-visible:shadow-(--focus-ring) dark:hover:bg-(--danger-bg)">Remove step</button>
          }
          @if (loadedNote()) {
            <span class="flex items-center gap-1.5 text-(length:--fs-13) font-normal text-(--text-4)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>{{ loadedNote() }}</span>
          } @else if (canLoad()) {
            <button hlmBtn variant="ghost" type="button" (click)="loadIntoStep.emit()" class="h-9 gap-[7px] rounded-[8px] border border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium whitespace-nowrap text-(--text-2) hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:border-(--border) focus-visible:ring-0 focus-visible:shadow-(--focus-ring) dark:hover:bg-(--surface-2)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M12 3v12M8 11l4 4 4-4M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" /></svg>Load results into this step</button>
          }
          <button hlmBtn variant="ghost" type="button" (click)="open.set(false)" class="h-9 rounded-[8px] border border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium text-(--text-2) hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:border-(--border) focus-visible:ring-0 focus-visible:shadow-(--focus-ring) dark:hover:bg-(--surface-2)">Cancel</button>
          <button hlmBtn type="button" (click)="save()" class="h-9 rounded-[8px] bg-(--primary) px-[14px] text-(length:--fs-14) font-semibold text-(--surface) hover:bg-(--accent) focus-visible:border-transparent focus-visible:ring-0 focus-visible:shadow-(--focus-ring)">{{ isEdit() ? 'Save step' : 'Add step' }}</button>
        }
      </div>
    </qa-drawer>
  `,
})
export class StepDrawer {
  readonly open = model(false);
  readonly request = input.required<StepRequest>();

  readonly saveStep = output<StepSaveEvent>();
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
  protected readonly first = computed(() => {
    const r = this.request();
    return r.index === 0 || (r.index == null && !r.timeline.steps.length);
  });

  protected readonly draft = linkedSignal<StepDraft>(() => {
    const r = this.request();
    const p = this.existing();
    if (!p) {
      return {
        name: '',
        audience: AUDIENCES[r.timeline.steps.length] ?? 'Assessors',
        opens: '',
        closes: '',
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
      batch: p.batch,
      reopen: p.reopen ?? 'comments',
      access: (p.access ?? DEMO_ACCESS).map((a) => ({ ...a, isNew: false })),
    };
  });

  protected readonly stepForm = form(this.draft, (f) => {
    required(f.name, { message: 'Enter a name for the step.' });
    validate(f.opens, ({ value }) =>
      parseDate(value()) ? undefined : { kind: 'date', message: 'Enter an opening date, for example 06 Jul 2026.' },
    );
  });

  /** Errors show after a save attempt, as in the mockup. */
  private readonly tried = linkedSignal({ source: this.request, computation: () => false });
  protected readonly confirmRemove = linkedSignal({ source: this.request, computation: () => false });

  protected readonly nameError = computed(() => (this.tried() ? (this.stepForm.name().errors()[0]?.message ?? '') : ''));
  protected readonly opensError = computed(() => (this.tried() ? (this.stepForm.opens().errors()[0]?.message ?? '') : ''));

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

  protected programName(code: string): string {
    return PROGRAMS[(code || '').trim().toUpperCase()] ?? '';
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected save(): void {
    this.tried.set(true);
    if (this.stepForm().invalid()) return;
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
        batch: d.batch,
        reopen: d.reopen,
        access: d.access.filter((a) => a.code.trim()).map((a) => ({ code: a.code.trim().toUpperCase(), range: a.range.trim() })),
      },
    });
    this.open.set(false);
  }

  protected doRemove(): void {
    // TODO(api): DELETE the step; its results go back to the previous step.
    this.removeStep.emit();
    this.open.set(false);
  }
}
