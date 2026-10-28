import { Component, Directive, input, numberAttribute } from '@angular/core';

/**
 * Fixed rule of the platform (Yeck 28-oct-2026), styles in `src/styles.css`:
 * 1. A view that waits for data shows a skeleton with the shape of what is coming, never a "Loading…" line.
 *    Lists show `QA_SKELETON_ROWS` placeholder rows.
 * 2. When the data lands, the real items come in one after another: `qaReveal` with the item's index.
 * 3. A button that runs an action spins and is disabled while it runs: `qaBtn` + `[loading]`.
 */
export const QA_SKELETON_ROWS = 10;

/** `[0, 1, … n-1]` to `@for` over placeholder rows. */
export function skeletonRows(n = QA_SKELETON_ROWS): readonly number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** One shimmering placeholder block. Size and shape go in `class` (`h-3.5 w-40`, `rounded-full`). */
@Component({
  selector: 'qa-skeleton',
  host: { class: 'qa-sk', 'aria-hidden': 'true' },
  template: '',
})
export class QaSkeleton {}

/**
 * Wraps a skeleton: announces the load once to screen readers and hides the placeholders from them.
 *
 * <qa-loading label="Loading the fields" class="block"> …qa-skeleton blocks… </qa-loading>
 */
@Component({
  selector: 'qa-loading',
  host: { role: 'status', 'aria-busy': 'true' },
  template: `<span class="sr-only">{{ label() }}…</span>
    <div aria-hidden="true" class="contents"><ng-content /></div>`,
})
export class QaLoading {
  readonly label = input('Loading');
}

/**
 * Comes in after the item before it (fade + short rise). Put it on the root element of each item of a list,
 * with its position: `<li [qaReveal]="$index">`. Kept items do not replay; new ones (filters, a section opened) do.
 */
@Directive({
  selector: '[qaReveal]',
  host: { class: 'qa-reveal', '[style.--qa-i]': 'qaReveal()' },
})
export class QaReveal {
  readonly qaReveal = input(0, { transform: numberAttribute });
}

export const QaLoadingImports = [QaSkeleton, QaLoading, QaReveal] as const;
