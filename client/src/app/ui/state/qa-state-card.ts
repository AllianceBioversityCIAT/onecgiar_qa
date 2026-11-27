import { booleanAttribute, Component, input } from '@angular/core';

/**
 * Empty, error and "nothing here" states of a page: one white card with a title, one line that says what happened,
 * and the way forward (buttons as content). Every screen uses it, so these states look the same everywhere
 * (Juanpa, 2026-11-25: Cycle, Results, Assessors, Fields and Review each showed them differently).
 *
 * <qa-state-card alert heading="We couldn't load the results" [message]="error()">
 *   <button hlmBtn qaBtn tone="secondary" size="sm" (click)="load()">Try again</button>
 * </qa-state-card>
 */
@Component({
  selector: 'qa-state-card',
  host: {
    class: 'flex flex-col items-start gap-1 rounded-xl border border-(--border) bg-(--surface) px-5 py-6 shadow-(--shadow-card)',
    '[attr.role]': 'alert() ? "alert" : null',
  },
  template: `
    <h2 class="m-0 text-(length:--fs-16) font-bold text-(--text)">{{ heading() }}</h2>
    @if (message()) {
      <p class="m-0 text-(length:--fs-14) leading-[1.55] text-pretty text-(--text-3)">{{ message() }}</p>
    }
    <div class="mt-3 flex flex-wrap items-center gap-3 empty:hidden"><ng-content /></div>
  `,
})
export class QaStateCard {
  readonly heading = input.required<string>();
  readonly message = input<string | null>(null);
  /** Announces the card (role="alert") for load errors. */
  readonly alert = input(false, { transform: booleanAttribute });
}
