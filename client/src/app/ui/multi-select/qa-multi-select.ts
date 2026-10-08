import { BooleanInput, NumberInput } from '@angular/cdk/coercion';
import { Component, booleanAttribute, computed, input, model, numberAttribute, signal } from '@angular/core';
import { HlmInput } from '@spartan/input';
import { BrnPopoverImports, provideBrnPopoverConfig, provideBrnPopoverDefaultOptions } from '@spartan-ng/brain/popover';
import { injectQaTokens } from '../tokens/qa-tokens';

export interface QaMultiSelectOption {
  readonly value: string;
  readonly label: string;
  /** Right-aligned number in the row (mono, e.g. "214"). */
  readonly count?: string | number;
}

/**
 * - `filter`: filter chip of the Results toolbar (label + count chip).
 * - `field`: form field inside drawers; the trigger shows the selection ("All programs", "SP02, SP05", "3 selected").
 */
export type QaMultiSelectAppearance = 'filter' | 'field';

/**
 * Multi-choice picker: a trigger and a popover with an optional search box and a checkbox list.
 * Built on BrnPopover (outside click / Esc close, focus moves to the search box, focus returns to the trigger).
 *
 * <qa-multi-select [(value)]="programs" [options]="programOptions" label="Science program" searchPlaceholder="Search programs" />
 * <qa-multi-select appearance="field" [(value)]="programs" [options]="programOptions" label="Science programs" placeholder="All programs" />
 */
@Component({
  selector: 'qa-multi-select',
  imports: [BrnPopoverImports, HlmInput],
  providers: [
    provideBrnPopoverConfig({ align: 'start', sideOffset: 8 }),
    provideBrnPopoverDefaultOptions({ role: null }),
  ],
  host: { '[class]': "appearance() === 'field' ? 'flex max-w-full' : 'inline-flex flex-none'", '[attr.id]': 'null' },
  template: `
    <div brnPopover [sideOffset]="sideOffset()" (closed)="query.set('')" class="flex max-w-full" [class.w-full]="appearance() === 'field'">
      @if (appearance() === 'field') {
        <button
          brnPopoverTrigger
          type="button"
          [attr.id]="triggerId()"
          [attr.aria-label]="label() + ': ' + summary()"
          [attr.aria-invalid]="invalid() || null"
          [disabled]="disabled()"
          class="flex h-9 w-full max-w-full min-w-[280px] cursor-pointer items-center gap-2 rounded-lg border bg-(--field-bg) px-3 text-left text-(length:--fs-14) font-medium outline-none hover:border-(--border-strong) focus-visible:shadow-(--focus-ring) disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-w-0"
          [class]="(invalid() ? 'border-(--danger) ' : 'border-(--border) ') + (!count() && mutedPlaceholder() ? 'text-(--text-muted)' : 'text-(--text)')"
        >
          <span class="min-w-0 flex-1 truncate">{{ summary() }}</span>
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      } @else {
        <button
          brnPopoverTrigger
          type="button"
          [attr.id]="triggerId()"
          [attr.aria-label]="triggerLabel()"
          [disabled]="disabled()"
          class="flex h-9 cursor-pointer items-center gap-[7px] rounded-lg border bg-(--field-bg) px-3 text-(length:--fs-14) font-medium whitespace-nowrap text-(--text-2) outline-none hover:border-(--border-strong) focus-visible:shadow-(--focus-ring) disabled:cursor-not-allowed disabled:opacity-50"
          [class]="count() ? 'border-(--border-accent)' : 'border-(--border)'"
        >
          <span>{{ label() }}</span>
          @if (count()) {
            <span aria-hidden="true" class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-(--tint-2) px-[5px] font-(family-name:--qa-mono) text-(length:--fs-11) font-semibold text-(--accent) tabular-nums">{{ count() }}</span>
          }
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      }
      <ng-template brnPopoverContent>
        <div
          role="dialog"
          [attr.aria-label]="label()"
          class="qa-tokens box-border flex max-w-[calc(100vw-32px)] flex-col gap-2 rounded-xl border border-(--border-raised) bg-(--surface-raised) p-3 shadow-(--shadow-pop) animate-in fade-in-0 zoom-in-95 duration-100"
          [style.width]="panelWidth()"
        >
          @if (searchable()) {
            <input
              hlmInput
              type="text"
              [placeholder]="searchPlaceholder()"
              [attr.aria-label]="searchPlaceholder()"
              [value]="query()"
              (input)="onQuery($event)"
              class="h-8 w-full rounded-md border-(--border) bg-(--field-bg) px-2.5 py-0 text-(length:--fs-13) text-(--text) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 md:text-(length:--fs-13) dark:bg-(--field-bg)"
            />
          }
          <div role="group" [attr.aria-label]="label()" class="flex flex-col gap-px overflow-y-auto" [style.max-height]="listMaxHeight()">
            @for (option of filtered(); track option.value) {
              @let on = isSelected(option.value);
              <button
                type="button"
                role="checkbox"
                [attr.aria-checked]="on"
                (click)="toggle(option.value)"
                class="flex min-h-[34px] flex-none cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 text-left text-(length:--fs-13) text-(--text-2) outline-none hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring)"
              >
                <span
                  aria-hidden="true"
                  class="box-border flex size-4 flex-none items-center justify-center rounded border-[1.5px]"
                  [class]="on ? 'border-(--primary) bg-(--primary)' : 'border-(--border-strong)'"
                >
                  @if (on) {
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  }
                </span>
                <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
                @if (option.count !== undefined && option.count !== null) {
                  <span class="flex-none font-(family-name:--qa-mono) text-(length:--fs-12) font-semibold text-(--text-4) tabular-nums">{{ option.count }}</span>
                }
              </button>
            } @empty {
              <p class="m-0 px-2 py-2 text-(length:--fs-13) text-(--text-4)">{{ emptyText() }}</p>
            }
          </div>
        </div>
      </ng-template>
    </div>
  `,
})
export class QaMultiSelect {
  readonly value = model<readonly string[]>([]);
  readonly options = input.required<readonly QaMultiSelectOption[]>();
  readonly label = input.required<string>();
  readonly appearance = input<QaMultiSelectAppearance>('filter');
  readonly searchable = input<boolean, BooleanInput>(true, { transform: booleanAttribute });
  readonly searchPlaceholder = input('Search');
  /** Shown when the search matches nothing. */
  readonly emptyText = input('No matches');
  readonly panelWidth = input('280px');
  /** Max height of the checkbox list (CSS). */
  readonly listMaxHeight = input('220px');
  readonly sideOffset = input<number, NumberInput>(8, { transform: numberAttribute });
  readonly disabled = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  /** Field appearance: trigger text when nothing is selected ("All programs"). */
  readonly placeholder = input('All');
  /** Field appearance: grey trigger text while nothing is selected (required pickers). */
  readonly mutedPlaceholder = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  /** Field appearance: up to this many values are listed ("SP02, SP05"); more read "N selected". */
  readonly summaryMax = input<number, NumberInput>(2, { transform: numberAttribute });
  /** Red border + aria-invalid (validation error). */
  readonly invalid = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  /** Id of the trigger button, for a `<label for>` (the host id is removed). */
  readonly triggerId = input<string | null>(null);

  protected readonly query = signal('');
  protected readonly count = computed(() => this.value().length);
  protected readonly triggerLabel = computed(() =>
    this.count() ? `${this.label()}, ${this.count()} selected` : this.label(),
  );
  protected readonly summary = computed(() => {
    const sel = this.value();
    if (!sel.length) return this.placeholder();
    return sel.length <= this.summaryMax() ? sel.join(', ') : `${sel.length} selected`;
  });
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.options().filter((o) => o.label.toLowerCase().includes(q)) : this.options();
  });

  constructor() {
    injectQaTokens();
  }

  protected isSelected(value: string): boolean {
    return this.value().includes(value);
  }

  protected toggle(value: string): void {
    this.value.update((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
}
