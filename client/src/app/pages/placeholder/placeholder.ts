import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/** Empty page behind a navigation item until the real page is built. */
@Component({
  selector: 'app-placeholder-page',
  template: `
    <header>
      <p class="text-xs font-semibold tracking-[0.12em] text-[var(--qa-muted-ink)] uppercase">
        {{ group }}
      </p>
      <h1 class="mt-1.5 text-3xl font-semibold tracking-tight text-[var(--qa-ink)]">
        {{ heading }}
      </h1>
    </header>
    <div
      class="mt-8 grid min-h-72 place-items-center rounded-2xl border border-dashed border-[color-mix(in_oklch,var(--qa-ink)_15%,transparent)] bg-[var(--qa-blob)]/40 p-6 text-center"
    >
      <p class="text-sm text-[var(--qa-muted-ink)]">This page is not built yet.</p>
    </div>
  `,
})
export class PlaceholderPage {
  private readonly data = inject(ActivatedRoute).snapshot.data;
  protected readonly group: string = this.data['group'];
  protected readonly heading: string = this.data['heading'];
}
