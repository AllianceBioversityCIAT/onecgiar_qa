import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthSession } from '../../auth/auth-session';
import { LOGIN_PATH } from '../../auth/auth-guards';

/** Placeholder landing page until the real app shell exists. */
@Component({
  selector: 'app-home',
  template: `
    <main class="grid min-h-dvh place-items-center bg-[var(--qa-bg)] px-4 py-10">
      <div
        class="w-full max-w-2xl rounded-[1.75rem] bg-[var(--qa-light)] p-6 shadow-[0_40px_90px_-35px_rgb(0_0_0/0.65)] sm:p-10"
      >
        <p class="text-sm font-medium tracking-wide text-[var(--qa-primary)] uppercase">
          Signed in
        </p>
        <h1 class="mt-2 text-2xl font-semibold text-[var(--qa-ink)]">PRMS Quality Assurance</h1>
        <p class="mt-3 text-[var(--qa-muted-ink)]">
          You are signed in as
          <strong class="font-semibold text-[var(--qa-ink)]" data-testid="user-email">{{
            email()
          }}</strong
          >. The QA workspace will appear here.
        </p>
        <button
          type="button"
          class="mt-6 inline-flex h-10 items-center rounded-full bg-[var(--qa-bg)] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:ring-4 focus-visible:ring-[var(--qa-primary-soft)] focus-visible:outline-none"
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
