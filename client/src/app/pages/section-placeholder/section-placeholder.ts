import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

/**
 * Stand-in for the workspace pages designed by Juanpa (`jp-design/*`). Each route already carries its
 * real permission, so guards and menu can be verified before the designed page is merged.
 */
@Component({
  selector: 'app-section-placeholder',
  imports: [RouterLink],
  template: `
    <main class="grid min-h-dvh place-items-center bg-[var(--qa-bg)] px-4 py-10">
      <div class="w-full max-w-md rounded-[1.75rem] bg-[var(--qa-light)] p-8">
        <h1 class="text-2xl font-semibold text-[var(--qa-ink)]" data-testid="section-title">
          {{ title }}
        </h1>
        <p class="mt-3 text-[var(--qa-muted-ink)]">
          This page is protected and opens for your role. Its design is coming.
        </p>
        <a
          routerLink="/"
          class="mt-6 inline-flex text-sm font-semibold text-[var(--qa-primary)] underline-offset-4 hover:underline"
          >Back to start</a
        >
      </div>
    </main>
  `,
})
export class SectionPlaceholderPage {
  protected readonly title = String(
    inject(ActivatedRoute).snapshot.data['nav']?.label ?? 'Section',
  );
}
