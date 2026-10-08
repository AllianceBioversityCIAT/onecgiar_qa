import { BooleanInput, NumberInput } from '@angular/cdk/coercion';
import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  Directive,
  Injector,
  TemplateRef,
  afterNextRender,
  booleanAttribute,
  computed,
  contentChild,
  inject,
  input,
  model,
  numberAttribute,
  signal,
  viewChild,
} from '@angular/core';
import { BrnPopoverImports, provideBrnPopoverConfig, provideBrnPopoverDefaultOptions } from '@spartan-ng/brain/popover';
import { BrnSelect, BrnSelectImports } from '@spartan-ng/brain/select';
import { injectQaTokens } from '../tokens/qa-tokens';

export interface QaSelectOption {
  readonly value: string;
  readonly label: string;
  /** Optional second line (e.g. "1,114 results · step 5 of 5"). */
  readonly description?: string;
  /** Optional group heading shown before the first option of each group (e.g. "Sub-timelines"). */
  readonly group?: string;
  readonly disabled?: boolean;
  /** Right-aligned number in the row (mono, e.g. "214"). */
  readonly count?: string | number;
  /** Right-aligned short text in the row (e.g. "Live"). */
  readonly meta?: string;
  /** Short tag shown next to the value in the trigger when this option is selected (e.g. "Official"). */
  readonly tag?: string;
}

/**
 * - `default`: page-level picker ("All timelines", "Role: Assessor").
 * - `field`: form field inside drawers (min 280px wide, shows the value like an input).
 * - `filter`: filter chip of the Results toolbar ("QA round" + count chip), as qa-multi-select.
 */
export type QaSelectAppearance = 'default' | 'field' | 'filter';

/** Row marker: check at the end (default) or a radio at the start (single-choice filters). */
export type QaSelectIndicator = 'check' | 'radio';

export interface QaSelectOptionContext {
  readonly $implicit: QaSelectOption;
  readonly selected: boolean;
}

/**
 * Custom body for each option row (replaces the label / description; the check stays).
 * <ng-template qaSelectOption let-option let-selected="selected">…</ng-template>
 */
@Directive({ selector: 'ng-template[qaSelectOption]' })
export class QaSelectOptionDef {
  readonly template = inject<TemplateRef<QaSelectOptionContext>>(TemplateRef);

  static ngTemplateContextGuard(_dir: QaSelectOptionDef, ctx: unknown): ctx is QaSelectOptionContext {
    return true;
  }
}

/** Content pinned under the list (e.g. a "Manage timelines" link). Clicking it closes the panel. */
@Directive({ selector: '[qaSelectFooter]' })
export class QaSelectFooter {}

/**
 * Single select. Built on BrnSelect + BrnPopover: combobox/listbox roles, arrow keys, typeahead,
 * Enter/Space, Esc. With `searchable`, a search box filters the options and keeps arrow keys / Enter.
 * Set its width from outside with a class, e.g. class="min-w-[260px]".
 *
 * <qa-select [(value)]="timeline" [options]="timelines" label="Timeline" class="min-w-[260px]" />
 * <qa-select [(value)]="round" [options]="rounds" label="QA round" appearance="filter" indicator="radio" />
 */
@Component({
  selector: 'qa-select',
  imports: [BrnSelectImports, BrnPopoverImports, NgTemplateOutlet],
  providers: [
    provideBrnPopoverConfig({ align: 'start', sideOffset: 8 }),
    provideBrnPopoverDefaultOptions({ role: null }),
  ],
  host: { class: 'inline-flex max-w-full', '[attr.id]': 'null' },
  template: `
    <div
      brnSelect
      brnPopover
      [sideOffset]="sideOffset()"
      [value]="value()"
      (valueChange)="onChange($event)"
      (closed)="query.set('')"
      [disabled]="disabled()"
      class="flex w-full"
    >
      @if (appearance() === 'filter') {
        <button
          brnSelectTrigger
          [attr.aria-label]="hasValue() ? label() + ', ' + display() : label()"
          class="flex h-9 cursor-pointer items-center gap-[7px] rounded-lg border bg-(--field-bg) px-3 text-(length:--fs-14) font-medium whitespace-nowrap text-(--text-2) outline-none hover:border-(--border-strong) focus-visible:shadow-(--focus-ring) disabled:cursor-not-allowed disabled:opacity-50"
          [class]="hasValue() ? 'border-(--border-accent)' : 'border-(--border)'"
        >
          <span>{{ label() }}</span>
          @if (hasValue()) {
            <span aria-hidden="true" class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-(--tint-2) px-[5px] font-(family-name:--qa-mono) text-(length:--fs-11) font-semibold text-(--accent) tabular-nums">1</span>
          }
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      } @else {
        <button
          brnSelectTrigger
          [id]="triggerId() ?? autoTriggerId"
          [attr.aria-label]="label() + ': ' + display()"
          class="flex h-auto min-h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-(--border) bg-(--field-bg) px-3 text-left text-(length:--fs-14) text-(--text) outline-none hover:border-(--border-strong) focus-visible:shadow-(--focus-ring) disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-(--text-muted)"
          [class]="triggerClass()"
        >
          <span class="min-w-0 truncate">{{ display() }}</span>
          @if (selected()?.tag; as tag) {
            <span class="flex-none rounded-full bg-(--surface-3) px-1.5 py-px text-(length:--fs-10) font-semibold text-(--text-muted)">{{ tag }}</span>
          }
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-auto flex-none"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      }
      <ng-template brnPopoverContent>
        <div
          brnSelectContent
          class="qa-tokens box-border flex max-h-[360px] max-w-[calc(100vw-32px)] min-w-(--brn-select-width) flex-col overflow-hidden rounded-xl border border-(--border-raised) bg-(--surface-raised) shadow-(--shadow-pop) animate-in fade-in-0 zoom-in-95 duration-100"
          [class]="roomy() ? 'gap-2 p-3' : 'p-1.5'"
          [style.width]="panelWidth()"
        >
          @if (searchable()) {
            <input
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              [attr.aria-controls]="listId"
              [attr.aria-activedescendant]="activeId()"
              [placeholder]="searchPlaceholder()"
              [attr.aria-label]="searchPlaceholder()"
              [value]="query()"
              (input)="onQuery($event)"
              (keydown)="onSearchKey($event)"
              class="box-border h-8 w-full flex-none rounded-md border border-(--border) bg-(--field-bg) px-2.5 py-0 text-(length:--fs-13) text-(--text) shadow-none outline-none placeholder:text-(--text-muted) focus-visible:border-(--primary)"
            />
          }
          <div class="min-h-0 flex-1 overflow-y-auto" [style.max-height]="listMaxHeight()">
            <div brnSelectList [id]="listId" [attr.aria-label]="label()" class="flex flex-col gap-px">
              @for (row of rows(); track row.option.value) {
                @let option = row.option;
                @let on = option.value === value();
                @if (row.heading) {
                  <div role="presentation" class="flex-none px-2 pt-2 pb-1 text-(length:--fs-10) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">
                    {{ row.heading }}
                  </div>
                }
                <div
                  brnSelectItem
                  [value]="option.value"
                  [disabled]="!!option.disabled"
                  class="flex flex-none cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&[data-highlighted]:not([aria-selected=true])]:bg-(--surface-3) aria-selected:data-[highlighted]:shadow-[inset_0_0_0_1px_var(--border-accent)]"
                  [class]="itemClass(option)"
                >
                  @if (indicator() === 'radio') {
                    <span
                      aria-hidden="true"
                      class="box-border flex size-4 flex-none items-center justify-center rounded-full border-[1.5px]"
                      [class]="on ? 'border-(--primary)' : 'border-(--border-strong)'"
                    >
                      @if (on) {
                        <span class="size-2 rounded-full bg-(--primary)"></span>
                      }
                    </span>
                  }
                  @if (optionDef(); as def) {
                    <ng-container [ngTemplateOutlet]="def.template" [ngTemplateOutletContext]="{ $implicit: option, selected: on }" />
                  } @else {
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="truncate text-(length:--fs-13) font-medium text-(--text-2)">{{ option.label }}</span>
                      @if (option.description) {
                        <span class="truncate text-(length:--fs-12) text-(--text-4)">{{ option.description }}</span>
                      }
                    </span>
                  }
                  @if (option.meta) {
                    <span class="flex-none text-(length:--fs-12) font-medium whitespace-nowrap text-(--text-4)">{{ option.meta }}</span>
                  }
                  @if (option.count !== undefined && option.count !== null) {
                    <span class="flex-none font-(family-name:--qa-mono) text-(length:--fs-12) font-semibold text-(--text-4) tabular-nums">{{ option.count }}</span>
                  }
                  @if (on && indicator() === 'check') {
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="flex-none"><path d="M20 6L9 17l-5-5" /></svg>
                  }
                </div>
              } @empty {
                <p role="presentation" class="m-0 p-2 text-(length:--fs-13) text-(--text-3)">{{ emptyText() }}</p>
              }
            </div>
          </div>
          @if (footer()) {
            <div class="flex-none border-t border-(--surface-4) pt-2" (click)="closePanel()">
              <ng-content select="[qaSelectFooter]" />
            </div>
          }
        </div>
      </ng-template>
    </div>
  `,
})
export class QaSelect {
  private static nextId = 0;
  private readonly uid = QaSelect.nextId++;
  protected readonly listId = `qa-select-list-${this.uid}`;
  protected readonly autoTriggerId = `qa-select-trigger-${this.uid}`;

  readonly value = model<string | null>(null);
  readonly options = input.required<readonly QaSelectOption[]>();
  /** Accessible name of the field ("Timeline"); the trigger reads "Timeline: All timelines". */
  readonly label = input.required<string>();
  readonly placeholder = input('Select…');
  readonly disabled = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  /** Panel width (CSS). Default: at least the trigger width. Mockup timeline picker: '340px'. */
  readonly panelWidth = input<string | null>(null);
  /** Semibold trigger text, as the page-level "All timelines" picker. */
  readonly emphasis = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  readonly appearance = input<QaSelectAppearance>('default');
  readonly indicator = input<QaSelectIndicator>('check');
  /** Search box on top of the list (filters by label and description). */
  readonly searchable = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  readonly searchPlaceholder = input('Search');
  /** Shown when the search matches nothing. */
  readonly emptyText = input('Nothing matches that search.');
  /** Max height of the scrolling list (CSS), e.g. '220px'. Default: the panel's 360px. */
  readonly listMaxHeight = input<string | null>(null);
  readonly sideOffset = input<number, NumberInput>(8, { transform: numberAttribute });
  /** Red border (validation error). */
  readonly invalid = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  /** Id of the trigger button, for a `<label for>` (use `triggerId`, the host id is removed). */
  readonly triggerId = input<string | undefined>(undefined);

  protected readonly optionDef = contentChild(QaSelectOptionDef);
  protected readonly footer = contentChild(QaSelectFooter);
  private readonly select = viewChild.required(BrnSelect);
  private readonly injector = inject(Injector);

  protected readonly query = signal('');
  protected readonly activeId = signal<string | null>(null);

  protected readonly roomy = computed(() => this.searchable() || this.appearance() !== 'default' || !!this.footer());
  protected readonly selected = computed(() => this.options().find((o) => o.value === this.value()) ?? null);
  protected readonly hasValue = computed(() => !!this.value());

  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = q
      ? this.options().filter((o) => o.label.toLowerCase().includes(q) || !!o.description?.toLowerCase().includes(q))
      : this.options();
    return list.map((option, i, all) => ({
      option,
      heading: option.group && option.group !== all[i - 1]?.group ? option.group : null,
    }));
  });

  protected readonly display = computed(() => this.selected()?.label ?? this.placeholder());

  protected readonly triggerClass = computed(
    () =>
      (this.emphasis() ? 'font-semibold' : 'font-medium') +
      (this.appearance() === 'field' ? ' min-w-[280px] max-sm:min-w-0' : '') +
      (this.invalid() ? ' border-(--danger)!' : ''),
  );

  constructor() {
    injectQaTokens();
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const keys = this.select().keyManager;
      const sub = keys.change.subscribe(() => this.activeId.set(keys.activeItem?.id() ?? null));
      destroyRef.onDestroy(() => sub.unsubscribe());
    });
  }

  protected itemClass(option: QaSelectOption): string {
    const tall = option.description || this.optionDef() ? 'min-h-11' : 'min-h-[34px]';
    return this.indicator() === 'radio' ? tall : `${tall} aria-selected:bg-(--tint-2)`;
  }

  protected onChange(value: unknown): void {
    this.value.set(typeof value === 'string' ? value : null);
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    afterNextRender(() => this.select().keyManager.setFirstItemActive(), { injector: this.injector });
  }

  /** Arrow keys move through the options and Enter picks one, while typing stays in the box. */
  protected onSearchKey(event: KeyboardEvent): void {
    const select = this.select();
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      select.keyManager.onKeydown(event);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      select.selectActiveItem();
    }
  }

  protected closePanel(): void {
    this.select().close();
  }
}

export const QaSelectImports = [QaSelect, QaSelectOptionDef, QaSelectFooter] as const;
