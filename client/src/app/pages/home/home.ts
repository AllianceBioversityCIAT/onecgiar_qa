import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthSession } from '../../auth/auth-session';
import { LOGIN_PATH } from '../../auth/auth-guards';

/** Placeholder landing page until the real app shell exists. */
@Component({
  selector: 'app-home',
  template: `
    <main class="mx-auto grid min-h-dvh max-w-2xl content-center gap-6 px-4 py-10">
      <div class="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
        <p class="text-sm font-medium tracking-wide text-primary uppercase">Signed in</p>
        <h1 class="mt-2 text-2xl font-semibold text-ink">PRMS Quality Assurance</h1>
        <p class="mt-3 text-ink-muted">
          You are signed in as
          <strong class="font-semibold text-ink" data-testid="user-email">{{ email() }}</strong>.
          The QA workspace will appear here.
        </p>
        <button
          type="button"
          class="mt-6 inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-ring"
          (click)="signOut()"
        >
          Sign out
        </button>
      </div>
    </main>
  `,
})
export class HomePage {
  private readonly session = inject(AuthSession);
  private readonly router = inject(Router);

  protected readonly email = computed(() => this.session.user()?.email ?? '');

  protected signOut(): void {
    this.session.signOut();
    void this.router.navigateByUrl(LOGIN_PATH);
  }
}
