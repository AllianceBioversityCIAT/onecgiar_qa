import { BooleanInput } from '@angular/cdk/coercion';
import { Component, booleanAttribute, computed, input, model } from '@angular/core';
import { BrnRadioGroupImports } from '@spartan-ng/brain/radio-group';

export interface QaSegmentedOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export type QaSegmentedSize = 'default' | 'compact';

/**
 * `inline` (default): intrinsic width, one row.
 * `fill`: takes the full available width with equal segments; when the container is narrower than
 * 23rem the options lay out as a 2-column grid instead of scrolling sideways.
 */
export type QaSegmentedLayout = 'inline' | 'fill';

let nextId = 0;

/**
 * Single-select segmented control (role="radiogroup" with native radios: arrow keys move the choice).
 * `size="compact"` is the 30px version used in the Fields matrix and the Cycle step editor.
 * `layout="fill"` stretches it to the available width and wraps to a 2×2 grid when narrow (never a
 * horizontal scroll); its segments are 34px tall so the touch target reaches 40px.
 *
 * <qa-segmented [(value)]="visibility" [options]="visibilityOptions" size="compact" aria-label="In QA: Contributing centers" />
 */
@Component({
  selector: 'qa-segmented',
  imports: [BrnRadioGroupImports],
  host: {
    class: 'inline-flex max-w-full',
    '[class.w-full]': 'fill()',
    '[attr.aria-label]': 'null',
    '[attr.aria-labelledby]': 'null',
  },
  template: `
    <div class="flex min-w-0 max-w-full" [class]="wrapClass()">
      <div
        brnRadioGroup
        [name]="name"
        [value]="value()"
        (valueChange)="onChange($event)"
        [disabled]="disabled()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-labelledby]="ariaLabelledby()"
        class="box-border max-w-full bg-(--seg-track) p-[3px]"
        [class]="trackClass()"
      >
        @for (option of options(); track option.value) {
          <brn-radio
            [id]="name + '-' + $index"
            [value]="option.value"
            [disabled]="!!option.disabled"
            class="relative flex rounded-[6px] has-[input:focus-visible]:shadow-(--focus-ring)"
            [class]="fill() ? 'min-w-0 flex-1' : 'flex-none'"
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
    </div>
  `,
})
export class QaSegmented {
  readonly value = model<string | null>(null);
  readonly options = input.required<readonly QaSegmentedOption[]>();
  readonly size = input<QaSegmentedSize>('default');
  readonly layout = input<QaSegmentedLayout>('inline');
  readonly disabled = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  readonly ariaLabel = input<string | null>(null, { alias: 'aria-label' });
  readonly ariaLabelledby = input<string | null>(null, { alias: 'aria-labelledby' });

  protected readonly name = `qa-segmented-${++nextId}`;

  protected readonly fill = computed(() => this.layout() === 'fill');

  protected readonly wrapClass = computed(() => (this.fill() ? '@container w-full' : ''));

  protected readonly trackClass = computed(() => {
    const compact = this.size() === 'compact';
    const shape = compact ? 'gap-0.5 rounded-lg' : 'gap-[2px] rounded-[8px]';
    if (this.fill()) return `${shape} grid w-full grid-cols-2 @min-[23rem]:flex @min-[23rem]:items-center`;
    return `${shape} flex items-center overflow-x-auto ${compact ? 'h-[30px]' : 'h-8'}`;
  });

  protected itemClass(active: boolean, disabled: boolean): string {
    const compact = this.size() === 'compact';
    const height = this.fill() ? 'h-[34px] w-full justify-center' : compact ? 'h-6' : 'h-[26px]';
    const size = `${height} ${compact ? 'px-2.5 text-(length:--fs-12)' : 'px-[14px] text-(length:--fs-13)'}`;
    const state = active
      ? 'bg-(--seg-active) font-semibold text-(--text) shadow-(--shadow-seg)'
      : 'bg-transparent font-medium text-(--text-4) hover:text-(--text)';
    return `${size} ${state}${disabled ? ' cursor-not-allowed opacity-50' : ''}`;
  }

  protected onChange(value: unknown): void {
    this.value.set(typeof value === 'string' ? value : null);
  }
}
