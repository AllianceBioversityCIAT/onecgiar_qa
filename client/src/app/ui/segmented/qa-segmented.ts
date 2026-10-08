import { BooleanInput } from '@angular/cdk/coercion';
import { Component, booleanAttribute, computed, input, model } from '@angular/core';
import { BrnRadioGroupImports } from '@spartan-ng/brain/radio-group';

export interface QaSegmentedOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export type QaSegmentedSize = 'default' | 'compact';

let nextId = 0;

/**
 * Single-select segmented control (role="radiogroup" with native radios: arrow keys move the choice).
 * `size="compact"` is the 30px version used in the Fields matrix and the Cycle step editor.
 *
 * <qa-segmented [(value)]="visibility" [options]="visibilityOptions" size="compact" aria-label="In QA: Contributing centers" />
 */
@Component({
  selector: 'qa-segmented',
  imports: [BrnRadioGroupImports],
  host: {
    class: 'inline-flex max-w-full',
    '[attr.aria-label]': 'null',
    '[attr.aria-labelledby]': 'null',
  },
  template: `
    <div
      brnRadioGroup
      [name]="name"
      [value]="value()"
      (valueChange)="onChange($event)"
      [disabled]="disabled()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-labelledby]="ariaLabelledby()"
      class="box-border flex max-w-full items-center overflow-x-auto bg-(--seg-track) p-[3px]"
      [class]="trackClass()"
    >
      @for (option of options(); track option.value) {
        <brn-radio
          [id]="name + '-' + $index"
          [value]="option.value"
          [disabled]="!!option.disabled"
          class="relative flex flex-none rounded-[6px] has-[input:focus-visible]:shadow-(--focus-ring)"
        >
          <label
            [for]="name + '-' + $index"
            class="flex cursor-pointer items-center rounded-[6px] whitespace-nowrap select-none"
            [class]="itemClass(option.value === value(), !!option.disabled)"
          >
            {{ option.label }}
          </label>
        </brn-radio>
      }
    </div>
  `,
})
export class QaSegmented {
  readonly value = model<string | null>(null);
  readonly options = input.required<readonly QaSegmentedOption[]>();
  readonly size = input<QaSegmentedSize>('default');
  readonly disabled = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  readonly ariaLabel = input<string | null>(null, { alias: 'aria-label' });
  readonly ariaLabelledby = input<string | null>(null, { alias: 'aria-labelledby' });

  protected readonly name = `qa-segmented-${++nextId}`;

  protected readonly trackClass = computed(() =>
    this.size() === 'compact' ? 'h-[30px] gap-0.5 rounded-lg' : 'h-8 gap-[2px] rounded-[8px]',
  );

  protected itemClass(active: boolean, disabled: boolean): string {
    const size =
      this.size() === 'compact' ? 'h-6 px-2.5 text-(length:--fs-12)' : 'h-[26px] px-[14px] text-(length:--fs-13)';
    const state = active
      ? 'bg-(--seg-active) font-semibold text-(--text) shadow-(--shadow-seg)'
      : 'bg-transparent font-medium text-(--text-4) hover:text-(--text)';
    return `${size} ${state}${disabled ? ' cursor-not-allowed opacity-50' : ''}`;
  }

  protected onChange(value: unknown): void {
    this.value.set(typeof value === 'string' ? value : null);
  }
}
