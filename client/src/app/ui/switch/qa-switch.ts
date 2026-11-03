import { BooleanInput } from '@angular/cdk/coercion';
import { Component, booleanAttribute, input, model } from '@angular/core';
import { BrnSwitchImports } from '@spartan-ng/brain/switch';

/**
 * On/off switch from the mockup (32×18 track, 14px thumb). Built on BrnSwitch (role="switch").
 * Always give it a name: `aria-label` or `aria-labelledby`.
 *
 * <qa-switch [(checked)]="loadsResults" aria-label="Step 1 loads results" />
 */
@Component({
  selector: 'qa-switch',
  imports: [BrnSwitchImports],
  host: {
    class: 'inline-flex flex-none',
    '[attr.aria-label]': 'null',
    '[attr.aria-labelledby]': 'null',
    '[attr.aria-describedby]': 'null',
    '[attr.id]': 'null',
  },
  template: `
    <brn-switch
      [checked]="checked()"
      (checkedChange)="checked.set($event)"
      [disabled]="disabled()"
      [id]="inputId()"
      [aria-label]="ariaLabel()"
      [aria-labelledby]="ariaLabelledby()"
      [aria-describedby]="ariaDescribedby()"
      class="relative block h-[18px] w-8 flex-none cursor-pointer rounded-full border-0 p-0 transition-[background] duration-[140ms] outline-none focus-visible:shadow-(--focus-ring) data-[state=checked]:bg-(--primary) data-[state=unchecked]:bg-(--surface-6) disabled:cursor-not-allowed disabled:opacity-40"
    >
      <brn-switch-thumb
        class="pointer-events-none absolute top-[2px] left-[2px] block size-3.5 rounded-full bg-(--surface) transition-[left] duration-[140ms] data-[state=checked]:left-4"
      />
    </brn-switch>
  `,
})
export class QaSwitch {
  readonly checked = model(false);
  readonly disabled = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  readonly ariaLabel = input<string | null>(null, { alias: 'aria-label' });
  readonly ariaLabelledby = input<string | null>(null, { alias: 'aria-labelledby' });
  readonly ariaDescribedby = input<string | null>(null, { alias: 'aria-describedby' });
  /** id of the inner switch button (for a <label for>). */
  readonly inputId = input<string | null>(null, { alias: 'id' });
}
