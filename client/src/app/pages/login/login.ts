import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FieldTree, FormField, email, form, required, submit } from '@angular/forms/signals';
import { HlmButton } from '@spartan/button';
import { HlmFieldImports } from '@spartan/field';
import { HlmInput } from '@spartan/input';
import { HlmSpinner } from '@spartan/spinner';
import { AuthError, AuthProvider } from '../../auth/auth-provider';
import { AuthSession } from '../../auth/auth-session';
import { LOGIN_PREFILL } from '../../auth/login-prefill';
import { safeReturnUrl } from '../../auth/auth-guards';
import { BackgroundStore } from '../../theme/background-store';
import { ResultPreview } from './result-preview';

@Component({
  selector: 'app-login',
  imports: [FormField, HlmButton, HlmFieldImports, HlmInput, HlmSpinner, ResultPreview],
  templateUrl: './login.html',
  styles: `
    /* Spartan tokens re-pointed to the active palette inside the dark form panel. */
    .on-dark {
      --foreground: var(--qa-on-dark);
      --muted-foreground: var(--qa-muted-on-dark);
      --input: transparent;
      --ring: var(--qa-primary-soft);
      --destructive: var(--qa-danger);
    }
    /* Card panels: the palette colours as tinted glass over the image behind the card. */
    .crystal,
    .crystal-light {
      -webkit-backdrop-filter: blur(28px) saturate(150%);
      backdrop-filter: blur(28px) saturate(150%);
    }
    .crystal {
      background:
        radial-gradient(120% 70% at 50% 0%, oklch(1 0 0 / 0.08), transparent 60%),
        color-mix(in oklch, var(--qa-surface) 72%, transparent);
      box-shadow: inset 1px 0 0 oklch(1 0 0 / 0.1);
    }
    .crystal-light {
      background: color-mix(in oklch, var(--qa-light) 84%, transparent);
    }
    @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
      .crystal {
        background: var(--qa-surface);
      }
      .crystal-light {
        background: var(--qa-light);
      }
    }
    .filled {
      height: 2.875rem;
      border-radius: 0.75rem;
      border-color: transparent;
      background: var(--qa-field);
      color: var(--qa-on-dark);
      padding-inline: 0.875rem;
      box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.25);
    }
    .filled[data-show-error='true'] {
      box-shadow:
        inset 0 1px 2px rgb(0 0 0 / 0.25),
        0 0 0 1.5px var(--qa-danger);
    }
  `,
})
export class LoginPage {
  private readonly session = inject(AuthSession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly backgrounds = inject(BackgroundStore);
  protected readonly isStub = inject(AuthProvider).isStub;
  protected readonly busy = this.session.signingIn;
  protected readonly failure = signal<string | null>(null);

  private readonly prefill = this.isStub ? inject(LOGIN_PREFILL, { optional: true }) : null;

  protected readonly model = signal({
    email: this.prefill?.email ?? '',
    password: this.prefill?.password ?? '',
  });
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
