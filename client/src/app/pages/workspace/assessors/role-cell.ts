import { Component, computed, input, output } from '@angular/core';
import {
  BrnPopover,
  BrnPopoverImports,
  provideBrnPopoverConfig,
  provideBrnPopoverDefaultOptions,
} from '@spartan-ng/brain/popover';
import { ROLE_OPTIONS, TeamMember, TeamRole } from './assessors.mock';

/** Role cell of the team table: shows the role (+ Lead chip) and opens a radio list to change it. */
@Component({
  selector: 'qa-assessor-role-cell',
  imports: [BrnPopoverImports],
  providers: [
    provideBrnPopoverConfig({ align: 'start', sideOffset: 4 }),
    provideBrnPopoverDefaultOptions({ role: null }),
  ],
  host: { class: 'block' },
  template: `
    <div brnPopover #pop="brnPopover" class="flex">
      <button
        brnPopoverTrigger
        type="button"
        [attr.aria-label]="'Change role of ' + member().nick + ': ' + member().role"
        class="box-border flex min-h-8 w-full min-w-0 cursor-pointer flex-col items-start justify-center gap-1 @max-[950px]:flex-row @max-[950px]:items-center @max-[950px]:gap-1.5 @max-[640px]:min-h-10 rounded-lg border border-transparent bg-transparent px-2 py-1 text-left hover:border-(--border) hover:bg-(--surface) focus-visible:shadow-(--focus-ring) focus-visible:outline-none aria-expanded:border-(--border-accent) aria-expanded:bg-(--surface)"
      >
        <span class="max-w-full min-w-0 truncate text-(length:--fs-13) font-medium text-(--text-2)">{{ member().role }}</span>
        @if (member().lead) {
          <span title="Can edit and delete other assessors' comments." class="flex-none rounded-full bg-(--tint-2) px-1.5 py-px text-(length:--fs-10) font-semibold text-(--accent)">Lead</span>
        }
      </button>
      <ng-template brnPopoverContent>
        <div
          role="listbox"
          [attr.aria-label]="'Role of ' + member().nick"
          class="qa-tokens box-border flex w-[240px] max-w-[calc(100vw-32px)] flex-col gap-px rounded-xl border border-(--border-raised) bg-(--surface-raised) p-3 shadow-(--shadow-pop) animate-in fade-in-0 zoom-in-95 duration-100"
        >
          @for (o of options; track o.role) {
            @let on = o.role === member().role;
            <button
              type="button"
              role="option"
              [attr.aria-selected]="on"
              (click)="pick(o.role, pop)"
              class="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border-0 px-2 py-1.5 text-left outline-none hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring)"
              [class]="on ? 'bg-(--tint)' : 'bg-transparent'"
            >
              <span
                aria-hidden="true"
                class="mt-px box-border flex size-4 flex-none items-center justify-center rounded-full border-[1.5px]"
                [class]="on ? 'border-(--primary)' : 'border-(--border-strong)'"
              >
                @if (on) {
                  <span class="size-2 rounded-full bg-(--primary)"></span>
                }
              </span>
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-(length:--fs-13) font-medium text-(--text-2)">{{ o.role }}</span>
                <span class="text-(length:--fs-12) font-normal text-pretty text-(--text-4)">{{ o.description }}</span>
              </span>
            </button>
          }
        </div>
      </ng-template>
    </div>
  `,
})
export class AssessorRoleCell {
  readonly member = input.required<TeamMember>();
  readonly roleChange = output<TeamRole>();

  protected readonly options = ROLE_OPTIONS;
  protected readonly current = computed(() => this.member().role);

  protected pick(role: TeamRole, pop: BrnPopover): void {
    if (role !== this.current()) this.roleChange.emit(role);
    pop.close();
  }
}
