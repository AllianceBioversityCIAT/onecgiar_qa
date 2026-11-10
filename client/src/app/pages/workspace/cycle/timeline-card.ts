import { Component, ElementRef, afterRenderEffect, computed, input, model, output, viewChild } from '@angular/core';
import { QaButtonImports, QaMenuImports } from '../../../ui';
import { MenuAction, TimelineNow, TimelineVM, timelineNow } from './cycle.logic';
import { TimelineSteps } from './timeline-steps';

/** Pill colours of the one-line summary, the same as the step card's state badges. */
const NOW_TONE: Record<TimelineNow['tone'], string> = {
  active: 'bg-(--tint-2) text-(--accent)',
  waiting: 'bg-(--st-editing-bg) text-(--st-editing-fg)',
  future: 'bg-(--surface-3) text-(--text-3)',
  done: 'bg-(--surface-4) text-(--text-4)',
};

/**
 * A timeline in the "Timelines" list: header with badges, actions menu, close confirmation and steps.
 * `collapsible`: the title opens and closes the steps; closed, the card keeps one line with the step that matters now.
 */
@Component({
  selector: 'qa-cycle-timeline-card',
  imports: [QaButtonImports, QaMenuImports, TimelineSteps],
  host: { class: 'block' },
  template: `
    @let t = timeline();
    <section class="rounded-[12px] border border-(--border) bg-(--surface)" [attr.aria-labelledby]="titleId()">
      <div class="flex min-h-16 flex-wrap items-center gap-3 border-b border-(--surface-4) px-5 py-4">
        <div class="flex min-w-0 flex-[1_1_14rem] flex-col gap-[3px]">
          <div class="flex flex-wrap items-center gap-2">
            @if (collapsible()) {
              <h3 [id]="titleId()" class="m-0 min-w-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">
                <button
                  type="button"
                  (click)="expanded.set(!expanded())"
                  [attr.aria-expanded]="expanded()"
                  [attr.aria-controls]="stepsId()"
                  class="-mx-1.5 -my-1 flex cursor-pointer items-center gap-1.5 rounded-[6px] border-0 bg-transparent px-1.5 py-1 text-left font-[inherit] text-inherit outline-none hover:bg-(--surface-2) focus-visible:shadow-(--focus-ring)"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--text-3)"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                    class="flex-none transition-transform duration-200 motion-reduce:transition-none"
                    [class.-rotate-90]="!expanded()"
                  ><path d="m6 9 6 6 6-6" /></svg>
                  <span class="min-w-0 break-words">{{ t.name }}</span>
                </button>
              </h3>
            } @else {
              <h3 [id]="titleId()" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">{{ t.name }}</h3>
            }
            <span class="rounded-full bg-(--surface-3) px-2 py-[2px] text-(length:--fs-11) font-semibold whitespace-nowrap text-(--text-muted)">{{ t.kindLabel }}</span>
            @if (t.isTest) {
              <span class="rounded-full bg-(--st-editing-bg) px-2 py-[2px] text-(length:--fs-11) font-semibold whitespace-nowrap text-(--st-editing-fg)">Test</span>
            }
            <span class="rounded-full px-2 py-[2px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="t.statusClass">{{ t.status }}</span>
          </div>
          <div class="text-(length:--fs-13) leading-[1.5] font-normal text-(--text-3)"><span class="font-(family-name:--qa-mono) font-medium text-(--text-2) tabular-nums"><span class="whitespace-nowrap">{{ t.rangeParts[0] }}</span>&ngsp;<span class="whitespace-nowrap">{{ t.rangeParts[1] }}</span></span> · <span class="whitespace-nowrap"><span class="font-(family-name:--qa-mono) font-medium text-(--text-2) tabular-nums">{{ t.results }}</span> results</span> · {{ t.progText }} · {{ t.typeText }}</div>
          @if (collapsible() && !expanded()) {
            @let now = summary();
            <p class="m-0 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-(length:--fs-13) leading-[1.5] text-(--text-2)" data-testid="timeline-now">
              <!-- On hold, the header badge already says "Waiting for results": the line names the step only. -->
              @if (now.tone !== 'waiting') {
                <span class="rounded-full px-2 py-[2px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="nowTone()">{{ now.state }}</span>&ngsp;
              }
              <span class="min-w-0 font-medium">{{ now.step }}</span>
              @if (t.needsPeople) {
                &ngsp;<span class="rounded-full bg-(--st-editing-bg) px-2 py-[2px] text-(length:--fs-11) font-semibold whitespace-nowrap text-(--st-editing-fg)">No one assigned</span>
              }
              @if (now.when) {
                &ngsp;<span class="font-(family-name:--qa-mono) text-(length:--fs-12) whitespace-nowrap text-(--text-3) tabular-nums">{{ now.when }}</span>
              }
            </p>
          }
        </div>
        @if (t.canEdit) {
          <div class="flex flex-none items-center gap-2 max-sm:w-full">
            @if (t.waitingLoad) {
              <!-- On hold with nothing loaded: the way out sits on the card, not only in the "…" menu. -->
              <button hlmBtn qaBtn tone="secondary" type="button" (click)="menuAction.emit('add-results')" class="gap-[7px] max-sm:flex-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 11l4 4 4-4M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" /></svg>Load results
              </button>
            }
            @if (canAddStep()) {
            <button hlmBtn qaBtn tone="secondary" type="button" (click)="addStep.emit()" class="gap-[7px] max-sm:flex-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Add step
            </button>
            }
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
                <!-- Actions without an API yet are left out (greyed "Coming soon" items read as broken, review 2026-11-10). -->
                @for (item of t.menu; track item.action) {
                  @if (!item.soon) {
                    <button qaMenuItem [variant]="item.danger ? 'danger' : 'default'" (triggered)="menuAction.emit(item.action)">{{ item.label }}</button>
                  }
                }
              </qa-menu-panel>
            </ng-template>
          </div>
        }
      </div>
      @if (confirmClose()) {
        <div role="alertdialog" [attr.aria-label]="'Close ' + t.name" class="flex flex-wrap items-center gap-[10px] border-b border-(--surface-4) bg-(--surface-2) px-5 py-3">
          <span class="mr-auto text-(length:--fs-13) text-(--text-2)">Close this timeline? Open steps end today and no new results come in.</span>
          <button #keepBtn hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="keepOpen.emit()">Keep open</button>
          <button hlmBtn qaBtn tone="danger" size="sm" type="button" (click)="closeTimeline.emit()">Close timeline</button>
        </div>
      }
      @if (!collapsible() || expanded()) {
        <div [id]="stepsId()">
          <qa-cycle-timeline-steps [timeline]="t" (openStep)="openStep.emit($event)" (viewProgress)="viewProgress.emit($event)" (assignPeople)="menuAction.emit('people')" />
        </div>
      }
    </section>
  `,
})
export class TimelineCard {
  readonly timeline = input.required<TimelineVM>();
  readonly confirmClose = input(false);
  /** Off on live data: a timeline keeps its steps once created (spec S-4). */
  readonly canAddStep = input(true);
  /** The title opens and closes the steps (complementary batches); the main batch stays open. */
  readonly collapsible = input(false);
  /** Open or closed, owned by the view so it can remember the admin's choice. */
  readonly expanded = model(true);

  readonly addStep = output<void>();
  readonly menuAction = output<MenuAction>();
  readonly keepOpen = output<void>();
  readonly closeTimeline = output<void>();
  readonly openStep = output<number>();
  readonly viewProgress = output<number>();

  private readonly keepBtn = viewChild<ElementRef<HTMLButtonElement>>('keepBtn');

  protected readonly summary = computed(() => timelineNow(this.timeline()));
  protected readonly nowTone = computed(() => NOW_TONE[this.summary().tone]);

  protected titleId(): string {
    return `cycle-tl-${this.timeline().id}-title`;
  }

  protected stepsId(): string {
    return `cycle-tl-${this.timeline().id}-steps`;
  }

  constructor() {
    // Move focus into the confirmation when it appears (the menu returns focus to its trigger first).
    afterRenderEffect(() => {
      const btn = this.keepBtn();
      if (btn) setTimeout(() => btn.nativeElement.focus());
    });
  }
}
