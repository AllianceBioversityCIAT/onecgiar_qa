import { Component, booleanAttribute, input } from '@angular/core';
import { QaLoadingImports } from '../../ui';
import { SpResultsSkeleton } from './sp-results-skeleton';

/** The SP page while the session or `/sp/me` load: header bar (optional), title and the results list. */
@Component({
  selector: 'qa-sp-frame-skeleton',
  imports: [QaLoadingImports, SpResultsSkeleton],
  host: { class: 'block' },
  template: `
    @if (withHeader()) {
      <qa-loading label="Opening Quality Assurance" class="block border-b border-(--border) bg-(--surface)">
        <div class="mx-auto flex max-w-[1280px] items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
          <div class="flex flex-col gap-1.5">
            <qa-skeleton class="h-2.5 w-28" />
            <qa-skeleton class="h-4 w-56" />
          </div>
          <qa-skeleton class="ml-auto h-3.5 w-32" />
        </div>
      </qa-loading>
    }
    <main class="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 pt-6 pb-10 sm:px-6 lg:px-8">
      <qa-loading label="Loading" class="flex flex-col gap-2">
        <qa-skeleton class="h-7 w-40" />
        <qa-skeleton class="h-3.5 w-80 max-w-full" />
      </qa-loading>
      <qa-sp-results-skeleton />
    </main>
  `,
})
export class SpFrameSkeleton {
  readonly withHeader = input(false, { transform: booleanAttribute });
}
