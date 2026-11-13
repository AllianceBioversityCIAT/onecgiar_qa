import { Component, input, output } from '@angular/core';
import { QaButtonImports, QaMenuImports } from '../../../ui';
import { MenuAction, TimelineVM } from './cycle.logic';

/**
 * Actions of a batch, the same on the main batch and on every complementary batch (Juanpa, 2026-11-12):
 * everything lives in the "…" menu; the card shows a button only when it unblocks something —
 * "Assign people" when the step in force has nobody for its role, "Load results into QA round N" while on hold.
 */
@Component({
  selector: 'qa-cycle-timeline-actions',
  imports: [QaButtonImports, QaMenuImports],
  host: { class: 'flex flex-none flex-wrap items-center gap-2 max-sm:w-full' },
  template: `
    @let t = timeline();
    @if (t.needsPeople && t.canAssign) {
      <button hlmBtn qaBtn tone="secondary" type="button" (click)="action.emit('people')" class="gap-[7px] max-sm:flex-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6" /></svg>Assign people<span class="sr-only"> to {{ t.name }}</span>
      </button>
    }
    @if (t.waitingLoad) {
      <button hlmBtn qaBtn tone="secondary" type="button" (click)="action.emit('add-results')" class="gap-[7px] max-sm:flex-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 11l4 4 4-4M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" /></svg>{{ t.loadLabel }}<span class="sr-only">: {{ t.name }}</span>
      </button>
    }
    <ng-content />
    <button
      type="button"
      [qaMenuTrigger]="actions"
      qaMenuAlign="end"
      [attr.aria-label]="'Actions for ' + t.name"
      class="flex size-8 flex-none cursor-pointer items-center justify-center rounded-[8px] border border-(--border) bg-(--surface) p-0 outline-none hover:border-(--border-strong) focus-visible:shadow-(--focus-ring) max-sm:size-10"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--text-3)" aria-hidden="true"><path d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" /></svg>
    </button>
    <ng-template #actions>
      <qa-menu-panel width="240px" [attr.aria-label]="t.name + ' actions'">
        <!-- Actions without an API yet are left out (greyed "Coming soon" items read as broken, review 2026-11-10). -->
        @for (item of t.menu; track item.action) {
          @if (!item.soon) {
            <button qaMenuItem [variant]="item.danger ? 'danger' : 'default'" (triggered)="action.emit(item.action)">{{ item.label }}</button>
          }
        }
      </qa-menu-panel>
    </ng-template>
  `,
})
export class TimelineActions {
  readonly timeline = input.required<TimelineVM>();
  readonly action = output<MenuAction>();
}
