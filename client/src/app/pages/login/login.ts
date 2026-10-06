import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FieldTree, FormField, email, form, required, submit } from '@angular/forms/signals';
import { AuthError, AuthProvider } from '../../auth/auth-provider';
import { AuthSession } from '../../auth/auth-session';
import { safeReturnUrl } from '../../auth/auth-guards';

@Component({
  selector: 'app-login',
  imports: [FormField],
  templateUrl: './login.html',
  styles: `
    .field {
      height: 2.75rem;
      border-radius: 0.5rem;
      border: 1px solid var(--color-line);
      background: white;
      padding-inline: 0.75rem;
      font-size: 0.9375rem;
      color: var(--color-ink);
      transition: border-color 120ms, box-shadow 120ms;
    }
    .field:focus-visible {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary-ring) 55%, transparent);
    }
    .field[aria-invalid='true'] {
      border-color: var(--color-danger);
    }
  `,
})
export class LoginPage {
  private readonly session = inject(AuthSession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly isStub = inject(AuthProvider).isStub;
  protected readonly busy = this.session.signingIn;
  protected readonly failure = signal<string | null>(null);

  protected readonly model = signal({ email: '', password: '' });
  protected readonly loginForm = form(this.model, (fields) => {
    required(fields.email, { message: 'Enter your email.' });
    email(fields.email, { message: 'Enter a valid email address, like name@cgiar.org.' });
    required(fields.password, { message: 'Enter your password.' });
  });

  /** Errors show once the field was touched (blur) or a submit was attempted. */
  protected showErrors(field: FieldTree<string>): boolean {
    const state = field();
    return state.touched() && state.invalid();
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) {
      return;
    }
    this.failure.set(null);
    await submit(this.loginForm, async () => {
      try {
        await this.session.signIn(this.model());
      } catch (error) {
        this.failure.set(failureMessage(error));
        return undefined;
      }
      const target = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
      await this.router.navigateByUrl(target);
      return undefined;
    });
  }
}

function failureMessage(error: unknown): string {
  if (error instanceof AuthError && error.reason !== 'unavailable') {
    return error.message;
  }
  return 'We could not reach the sign-in service. Check your connection and try again.';
}
