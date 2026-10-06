import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/** Empty page behind a navigation item until the real page is built. */
@Component({
  selector: 'app-placeholder-page',
  template: `
    <header>
      <p class="text-xs font-semibold tracking-[0.12em] text-[var(--glass-muted)] uppercase">
        {{ group }}
      </p>
      <h1 class="mt-1.5 text-3xl font-semibold tracking-tight text-[var(--glass-ink)]">
        {{ heading }}
      </h1>
    </header>
    <div
      class="mt-8 grid min-h-72 place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.04] p-6 text-center shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
    >
      <p class="text-sm text-[var(--glass-muted)]">This page is not built yet.</p>
    </div>
  `,
})
export class PlaceholderPage {
  private readonly data = inject(ActivatedRoute).snapshot.data;
  protected readonly group: string = this.data['group'];
  protected readonly heading: string = this.data['heading'];
}
