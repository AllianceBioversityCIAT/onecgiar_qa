import { Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCircle } from '@ng-icons/lucide';
import { PASSWORD_RULES } from './password-policy';

/**
 * The password requirements, ticked off live as the user types. Wrap it in
 * `<hlm-field-description id="…">` inside the field: spartan then lists it in the input's
 * `aria-describedby`, so screen readers read the rules with the field.
 */
@Component({
  selector: 'app-password-requirements',
  imports: [NgIcon],
  providers: [provideIcons({ lucideCheck, lucideCircle })],
  host: { class: 'block' },
  template: `
    <p class="mb-1 text-xs font-medium text-[var(--qa-muted-on-dark)]">Your password needs:</p>
    <ul class="grid gap-1 text-xs">
      @for (rule of rules(); track rule.id) {
        <li
          class="flex items-center gap-2"
          [class]="rule.met ? 'text-[var(--qa-on-dark)]' : 'text-[var(--qa-muted-on-dark)]'"
          [attr.data-rule]="rule.id"
          [attr.data-met]="rule.met"
        >
          <ng-icon
            aria-hidden="true"
            size="0.875rem"
            [name]="rule.met ? 'lucideCheck' : 'lucideCircle'"
          />
          <span>{{ rule.label }}</span>
          <span class="sr-only">{{ rule.met ? '(done)' : '(missing)' }}</span>
        </li>
      }
    </ul>
  `,
})
export class PasswordRequirements {
  /** The password being typed. */
  readonly value = input.required<string>();

  protected readonly rules = computed(() =>
    PASSWORD_RULES.map((rule) => ({
      id: rule.id,
      label: rule.label,
      met: rule.test(this.value()),
    })),
  );
}
