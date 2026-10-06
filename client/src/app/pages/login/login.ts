import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FieldTree, FormField, email, form, required, submit } from '@angular/forms/signals';
import { AuthError, AuthProvider } from '../../auth/auth-provider';
import { AuthSession } from '../../auth/auth-session';
import { safeReturnUrl } from '../../auth/auth-guards';
import { QaShowcase } from './qa-showcase';

@Component({
  selector: 'app-login',
  imports: [FormField, QaShowcase],
  templateUrl: './login.html',
  styles: `
    .brand-spotlight {
      background: radial-gradient(
        26rem circle at var(--spot-x, 70%) var(--spot-y, 30%),
        rgb(94 234 212 / 0.13),
        transparent 70%
      );
    }
    @media (prefers-reduced-motion: no-preference) {
      .brand-shimmer {
        background: linear-gradient(100deg, #5eead4 35%, #ecfeff 50%, #5eead4 65%) 0 0 / 250% 100%;
        background-clip: text;
        color: transparent;
        animation: brand-shimmer 5s ease-in-out infinite;
      }
    }
    @keyframes brand-shimmer {
      from {
        background-position: 100% 0;
      }
      to {
        background-position: 0% 0;
      }
    }
    .field-wrap {
      position: relative;
      display: grid;
    }
    .field-icon {
      position: absolute;
      inset-block: 0;
      left: 0.875rem;
      width: 1.125rem;
      height: 100%;
      color: var(--color-ink-muted);
      pointer-events: none;
      transition: color 150ms;
    }
    .field {
      width: 100%;
      height: 3rem;
      border-radius: 0.75rem;
      border: 1px solid var(--color-line);
      background: white;
      padding-inline: 2.625rem 0.875rem;
      font-size: 0.9375rem;
      color: var(--color-ink);
      box-shadow: 0 1px 2px rgb(19 32 30 / 0.04);
      transition:
        border-color 150ms,
        box-shadow 150ms;
    }
    .field:hover {
      border-color: color-mix(in srgb, var(--color-primary) 35%, var(--color-line));
    }
    .field:focus-visible {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary-ring) 45%, transparent);
    }
    .field-wrap:focus-within .field-icon {
      color: var(--color-primary);
    }
    .field[aria-invalid='true'] {
      border-color: var(--color-danger);
    }
    .field[aria-invalid='true']:focus-visible {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-danger) 18%, transparent);
    }
    .field-wrap:has(.field[aria-invalid='true']) .field-icon {
      color: var(--color-danger);
    }
    .field-error {
      display: flex;
      gap: 0.375rem;
      align-items: baseline;
      font-size: 0.875rem;
      color: var(--color-danger);
    }
    .field-error::before {
      content: '';
      flex: none;
      width: 0.375rem;
      height: 0.375rem;
      border-radius: 9999px;
      background: currentColor;
      transform: translateY(-0.125rem);
    }

    @media (prefers-reduced-motion: no-preference) {
      .login-enter {
        animation: login-rise 420ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
      }
      .field-error {
        animation: login-rise 180ms ease-out both;
      }
      .login-shake {
        animation: login-shake 320ms ease-in-out;
      }
    }
    @keyframes login-rise {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
    }
    @keyframes login-shake {
      25% {
        transform: translateX(-3px);
      }
      75% {
        transform: translateX(3px);
      }
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

  /** Moves the soft light of the brand panel under the pointer. */
  protected followPointer(event: PointerEvent): void {
    const panel = event.currentTarget as HTMLElement;
    const box = panel.getBoundingClientRect();
    panel.style.setProperty('--spot-x', `${event.clientX - box.left}px`);
    panel.style.setProperty('--spot-y', `${event.clientY - box.top}px`);
  }

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
