import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Shown when a signed-in user opens a page their roles do not allow (the route chunk is not loaded). */
@Component({
  selector: 'app-forbidden',
  imports: [RouterLink],
  template: `
    <main class="grid min-h-dvh place-items-center bg-[var(--qa-bg)] px-4 py-10">
      <div class="w-full max-w-md rounded-[1.75rem] bg-[var(--qa-light)] p-8 text-center">
        <h1 class="text-2xl font-semibold text-[var(--qa-ink)]">
          You do not have access to this page
        </h1>
        <p class="mt-3 text-[var(--qa-muted-ink)]">
          Your QA role does not include it. If you think this is a mistake, ask the QA administrator
          to review your roles.
        </p>
        <a
          routerLink="/"
          class="mt-6 inline-flex h-10 items-center rounded-full bg-[var(--qa-bg)] px-5 text-sm font-semibold text-white focus-visible:ring-4 focus-visible:ring-[var(--qa-primary-soft)] focus-visible:outline-none"
          >Go to the start page</a
        >
      </div>
    </main>
  `,
})
export class ForbiddenPage {}
