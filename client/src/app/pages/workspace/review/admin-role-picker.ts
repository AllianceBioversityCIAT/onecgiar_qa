// @akili-spec admin/acts-as-reviewer
import { Component, computed, input, output } from '@angular/core';
import { ACTING_ROLE_LABELS, ActingRole } from '../../../core/api/acting-role';
import { QaSegmented, QaSegmentedOption } from '../../../ui';

let nextId = 0;

/** The "Read only" choice: no role, no header. */
export const READ_ONLY = 'read_only';

/**
 * The QA Admin picks the reviewer role it acts as on this result (admin/acts-as-reviewer). Shown only when the
 * server offers roles (`actingRoles`, ADMIN only). "Read only" sends no role. While a role is on, a line says so: what
 * the Admin writes is shown to reviewers as written by an Admin, and the step dates do not stop it.
 */
@Component({
  selector: 'qa-admin-role-picker',
  imports: [QaSegmented],
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[8px] border border-(--border) bg-(--surface) px-[14px] py-2.5"
      data-testid="admin-role-picker"
    >
      <span [id]="labelId" class="text-(length:--fs-13) font-semibold text-(--text)">Act as</span>
      <qa-segmented
        size="compact"
        [options]="options()"
        [value]="value()"
        [disabled]="busy()"
        [attr.aria-busy]="busy()"
        [aria-labelledby]="labelId"
        (valueChange)="pick($event)"
      />
      @if (active(); as role) {
        <span class="min-w-0 flex-[1_1_220px] text-(length:--fs-12) leading-[1.45] text-pretty text-(--text-3)" role="status" data-testid="admin-acting-note">
          You are acting as <strong class="font-semibold text-(--text)">{{ role }}</strong>. Reviewers see your work as written by an Admin; step dates do not apply.
        </span>
      }
    </div>
  `,
})
export class AdminRolePicker {
  /** The roles the server offers on this result. */
  readonly roles = input.required<readonly ActingRole[]>();
  /** The role the view was built for; `null` = reading only. */
  readonly role = input<ActingRole | null>(null);
  readonly busy = input(false);
  readonly roleChange = output<ActingRole | null>();

  protected readonly labelId = `qa-admin-role-${++nextId}`;

  protected readonly options = computed<readonly QaSegmentedOption[]>(() => [
    { value: READ_ONLY, label: 'Read only' },
    ...this.roles().map((r) => ({ value: r, label: ACTING_ROLE_LABELS[r] })),
  ]);

  protected readonly value = computed(() => this.role() ?? READ_ONLY);

  protected readonly active = computed(() => {
    const role = this.role();
    return role ? ACTING_ROLE_LABELS[role] : null;
  });

  protected pick(value: string | null): void {
    const role = value === null || value === READ_ONLY ? null : this.roles().find((r) => r === value) ?? null;
    if (role !== this.role()) this.roleChange.emit(role);
  }
}

