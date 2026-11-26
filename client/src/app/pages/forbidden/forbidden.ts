import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaButtonImports, injectQaTokens } from '../../ui';

/**
 * Shown when a signed-in user opens a page their roles do not allow (the route chunk is not loaded).
 * Same look as the app (Juanpa, 2026-11-25): grey canvas, a white card, the app font and the app's primary button.
 */
@Component({
  selector: 'app-forbidden',
  imports: [RouterLink, QaButtonImports],
  host: { class: 'qa-tokens block' },
  template: `
    <main class="grid min-h-dvh place-items-center bg-(--bg) px-4 py-10">
      <div class="flex w-full max-w-md flex-col items-center gap-3 rounded-xl border border-(--border) bg-(--surface) p-8 text-center shadow-(--shadow-card)">
        <span aria-hidden="true" class="flex size-10 items-center justify-center rounded-lg bg-(--surface-5) text-(--text-3)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        </span>
        <h1 class="m-0 text-(length:--fs-20) font-bold tracking-[-0.01em] text-balance text-(--text)">You do not have access to this page</h1>
        <p class="m-0 text-(length:--fs-14) leading-[1.55] text-pretty text-(--text-3)">
          Your QA role does not include it. If you think this is a mistake, ask the QA administrator to review your roles.
        </p>
        <a hlmBtn qaBtn tone="primary" routerLink="/" class="mt-3">Go to the start page</a>
      </div>
    </main>
  `,
})
export class ForbiddenPage {
  constructor() {
    // No QA shell here: register the tokens stylesheet behind the host class qa-tokens.
    injectQaTokens();
  }
}
