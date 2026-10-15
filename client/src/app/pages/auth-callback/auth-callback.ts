import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HlmSpinner } from '@spartan/spinner';
import { AuthSession } from '../../core/auth/auth-session';
import { DeepLink, LOGIN_PATH } from '../../core/auth/deep-link';
import { toApiError } from '../../core/http/api-envelope';

/** Landing of the SSO round trip: exchanges the one-time `code`, then opens the page the user wanted. */
@Component({
  selector: 'app-auth-callback',
  imports: [HlmSpinner, RouterLink],
  template: `
    <main class="grid min-h-dvh place-items-center bg-[var(--qa-bg)] px-4 py-10">
      <div
        class="w-full max-w-sm text-center text-[var(--qa-on-dark)]"
        role="status"
        aria-live="polite"
      >
        @if (failure(); as message) {
          <h1 class="text-xl font-semibold">We could not sign you in</h1>
          <p class="mt-3 text-sm text-[var(--qa-muted-on-dark)]" data-testid="callback-error">
            {{ message }}
          </p>
          <a
            [routerLink]="loginPath"
            class="mt-6 inline-flex h-10 items-center rounded-full bg-[var(--qa-light)] px-5 text-sm font-semibold text-[var(--qa-ink)] focus-visible:ring-4 focus-visible:ring-[var(--qa-primary-soft)] focus-visible:outline-none"
            >Back to sign in</a
          >
        } @else {
          <hlm-spinner aria-label="Signing you in" />
          <p class="mt-4 text-sm text-[var(--qa-muted-on-dark)]">Signing you in…</p>
        }
      </div>
    </main>
  `,
})
export class AuthCallbackPage implements OnInit {
  private readonly session = inject(AuthSession);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly deepLink = inject(DeepLink);

  protected readonly loginPath = LOGIN_PATH;
  protected readonly failure = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const code = params.get('code');
    if (!code) {
      // The provider sends `error` when the user cancels or is refused. Its free text is never
      // shown: anyone can craft that URL, so only fixed messages reach the screen.
      this.failure.set(
        params.get('error') === 'access_denied'
          ? 'You cancelled the sign-in. You can try again when you are ready.'
          : 'The sign-in was cancelled or did not finish. Please try again.',
      );
      return;
    }
    try {
      await this.session.completeSso(code);
      await this.router.navigateByUrl(this.deepLink.consume(), { replaceUrl: true });
    } catch (error) {
      this.failure.set(toApiError(error).message);
    }
  }
}
