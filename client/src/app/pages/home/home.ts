import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from '../../core/auth/auth-api';
import { toApiError } from '../../core/http/api-envelope';
import { RouterLink } from '@angular/router';
import { AccessControl } from '../../core/access/access-control';
import { navItems } from '../../core/access/nav-items';
import { AuthSession } from '../../core/auth/auth-session';
import { routes } from '../../app.routes';

/**
 * Placeholder landing page until the real app shell (Juanpa's design) is wired. It shows who is
 * signed in, their roles and the menu the permissions allow, so the auth flow can be checked end to end.
 */
@Component({
  selector: 'app-home',
  imports: [RouterLink],
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
          >.
        </p>

        <h2 class="mt-6 text-sm font-semibold text-[var(--qa-ink)]">Your roles</h2>
        <ul class="mt-2 flex flex-wrap gap-2" data-testid="roles">
          @for (role of roles(); track role) {
            <li class="rounded-full bg-[var(--qa-bg)] px-3 py-1 text-xs font-semibold text-white">
              {{ role }}
            </li>
          } @empty {
            <li class="text-sm text-[var(--qa-muted-ink)]">
              Guest: you can read, but you have no QA role yet.
            </li>
          }
        </ul>

        <h2 class="mt-6 text-sm font-semibold text-[var(--qa-ink)]">Pages you can open</h2>
        <nav aria-label="Pages you can open" class="mt-2">
          <ul class="grid gap-1" data-testid="nav">
            @for (item of menu(); track item.path) {
              <li>
                <a
                  [routerLink]="item.path"
                  class="text-sm font-medium text-[var(--qa-primary)] underline-offset-4 hover:underline"
                  >{{ item.label }}</a
                >
              </li>
            }
          </ul>
        </nav>

        <div class="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="inline-flex h-9 items-center rounded-full border border-[var(--qa-bg)] px-4 text-sm font-semibold text-[var(--qa-ink)] focus-visible:ring-4 focus-visible:ring-[var(--qa-primary-soft)] focus-visible:outline-none"
            [disabled]="checking()"
            (click)="checkSession()"
          >
            Check session with the server
          </button>
          <span
            class="text-sm text-[var(--qa-muted-ink)]"
            role="status"
            data-testid="session-check"
            >{{ check() }}</span
          >
        </div>

        <button
          type="button"
          class="mt-8 inline-flex h-10 items-center rounded-full bg-[var(--qa-bg)] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:ring-4 focus-visible:ring-[var(--qa-primary-soft)] focus-visible:outline-none"
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
  private readonly access = inject(AccessControl);
  private readonly api = inject(AuthApi);

  protected readonly checking = signal(false);
  protected readonly check = signal('');

  protected readonly email = computed(() => this.session.user()?.email ?? '');
  protected readonly roles = computed(() =>
    this.access
      .assignments()
      .map((a) =>
        [a.role, a.resultTypeKey, a.programId != null ? `program ${a.programId}` : null]
          .filter(Boolean)
          .join(' · '),
      ),
  );
  protected readonly menu = computed(() => navItems(routes, (p) => this.access.canAny(p)));

  /** Calls `/auth/me`: after the token expires this shows the silent refresh working. */
  protected async checkSession(): Promise<void> {
    this.checking.set(true);
    try {
      const me = await firstValueFrom(this.api.me());
      this.check.set(`OK at ${new Date().toLocaleTimeString()} as ${me.email}`);
    } catch (error) {
      this.check.set(toApiError(error).message);
    } finally {
      this.checking.set(false);
    }
  }

  protected signOut(): void {
    void this.session.signOut();
  }
}
