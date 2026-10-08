import { Component, ElementRef, afterRenderEffect, input, output, viewChild } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { QaMenuImports } from '../../../ui';
import { MenuAction, TimelineVM } from './cycle.logic';
import { TimelineSteps } from './timeline-steps';

/** A timeline in the "Timelines" list: header with badges, actions menu, close confirmation and steps. */
@Component({
  selector: 'qa-cycle-timeline-card',
  imports: [HlmButton, QaMenuImports, TimelineSteps],
  host: { class: 'block' },
  template: `
    @let t = timeline();
    <section class="rounded-[12px] border border-(--border) bg-(--surface)" [attr.aria-labelledby]="titleId()">
      <div class="flex min-h-16 flex-wrap items-center gap-3 border-b border-(--surface-4) px-5 py-4">
        <div class="flex min-w-0 flex-[1_1_14rem] flex-col gap-[3px]">
          <div class="flex flex-wrap items-center gap-2">
            <h3 [id]="titleId()" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">{{ t.name }}</h3>
            <span class="rounded-full bg-(--surface-3) px-2 py-[2px] text-(length:--fs-11) font-semibold whitespace-nowrap text-(--text-muted)">{{ t.kind }}</span>
            @if (t.isTest) {
              <span class="rounded-full bg-(--st-editing-bg) px-2 py-[2px] text-(length:--fs-11) font-semibold whitespace-nowrap text-(--st-editing-fg)">Test</span>
            }
            <span class="rounded-full px-2 py-[2px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="t.statusClass">{{ t.status }}</span>
          </div>
          <div class="text-(length:--fs-13) leading-[1.5] font-normal text-(--text-3)"><span class="font-(family-name:--qa-mono) font-medium text-(--text-2) whitespace-nowrap tabular-nums">{{ t.range }}</span> · <span class="font-(family-name:--qa-mono) font-medium text-(--text-2) tabular-nums">{{ t.results }}</span> results · {{ t.progText }} · {{ t.typeText }}</div>
        </div>
        @if (t.canEdit) {
          <div class="flex flex-none items-center gap-2 max-sm:w-full">
            <button hlmBtn variant="ghost" type="button" (click)="addStep.emit()" class="h-9 max-sm:h-10 max-sm:flex-1 gap-[7px] rounded-[8px] border border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium text-(--text-2) hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:border-(--border) focus-visible:ring-0 focus-visible:shadow-(--focus-ring) dark:hover:bg-(--surface-2)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Add step
            </button>
            <button
              type="button"
              [qaMenuTrigger]="actions"
              qaMenuAlign="end"
              [attr.aria-label]="'Actions for ' + t.name"
              class="flex size-8 flex-none cursor-pointer items-center max-sm:size-10 justify-center rounded-[8px] border border-(--border) bg-(--surface) p-0 outline-none hover:border-(--border-strong) focus-visible:shadow-(--focus-ring)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--text-3)" aria-hidden="true"><path d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" /></svg>
            </button>
            <ng-template #actions>
              <qa-menu-panel width="220px" [attr.aria-label]="t.name + ' actions'">
                @for (item of t.menu; track item.action) {
                  <button qaMenuItem [variant]="item.danger ? 'danger' : 'default'" (triggered)="menuAction.emit(item.action)">{{ item.label }}</button>
                }
              </qa-menu-panel>
            </ng-template>
          </div>
        }
      </div>
      @if (confirmClose()) {
        <div role="alertdialog" [attr.aria-label]="'Close ' + t.name" class="flex flex-wrap items-center gap-[10px] border-b border-(--surface-4) bg-(--surface-2) px-5 py-3">
          <span class="mr-auto text-(length:--fs-13) text-(--text-2)">Close this timeline? Open steps end today and no new results come in.</span>
          <button #keepBtn hlmBtn variant="ghost" type="button" (click)="keepOpen.emit()" class="h-8 rounded-[8px] border border-(--border) bg-(--field-bg) px-3 max-sm:h-10 text-(length:--fs-13) font-medium text-(--text-2) hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:border-(--border) focus-visible:ring-0 focus-visible:shadow-(--focus-ring) dark:hover:bg-(--surface-2)">Keep open</button>
          <button hlmBtn type="button" (click)="closeTimeline.emit()" class="h-8 rounded-[8px] bg-(--danger) px-3 max-sm:h-10 text-(length:--fs-13) font-semibold text-(--surface) hover:bg-(--danger) focus-visible:border-transparent focus-visible:ring-0 focus-visible:shadow-(--focus-ring)">Close timeline</button>
        </div>
      }
      <qa-cycle-timeline-steps [timeline]="t" (openStep)="openStep.emit($event)" (viewProgress)="viewProgress.emit($event)" />
    </section>
  `,
})
export class TimelineCard {
  readonly timeline = input.required<TimelineVM>();
  readonly confirmClose = input(false);

  readonly addStep = output<void>();
  readonly menuAction = output<MenuAction>();
  readonly keepOpen = output<void>();
  readonly closeTimeline = output<void>();
  readonly openStep = output<number>();
  readonly viewProgress = output<number>();

  private readonly keepBtn = viewChild<ElementRef<HTMLButtonElement>>('keepBtn');

  protected titleId(): string {
    return `cycle-tl-${this.timeline().id}-title`;
  }

  constructor() {
    // Move focus into the confirmation when it appears (the menu returns focus to its trigger first).
    afterRenderEffect(() => {
      const btn = this.keepBtn();
      if (btn) setTimeout(() => btn.nativeElement.focus());
    });
  }
}
