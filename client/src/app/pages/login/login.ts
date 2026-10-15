import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  FieldTree,
  FormField,
  email,
  form,
  minLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { HlmButton } from '@spartan/button';
import { HlmFieldImports } from '@spartan/field';
import { HlmInput } from '@spartan/input';
import { HlmSpinner } from '@spartan/spinner';
import { AuthSession } from '../../core/auth/auth-session';
import { AUTH_ERROR, isChallenge } from '../../core/auth/auth.models';
import { DeepLink } from '../../core/auth/deep-link';
import { ApiError, toApiError } from '../../core/http/api-envelope';
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
    @media (prefers-reduced-motion: no-preference) {
      .drift {
        transition: translate 900ms cubic-bezier(0.22, 1, 0.36, 1);
      }
    }
  `,
})
export class LoginPage {
  private readonly session = inject(AuthSession);
  private readonly router = inject(Router);
  private readonly deepLink = inject(DeepLink);

  protected readonly busy = this.session.signingIn;
  protected readonly failure = signal<string | null>(null);
  /** Seconds left before another attempt is allowed (server 429 `retryAfter`). */
  protected readonly cooldown = signal(0);
  protected readonly locked = computed(() => this.busy() || this.cooldown() > 0);
  /** First login of a custom user: the server asks for a new password before giving a session. */
  protected readonly settingPassword = computed(() => this.session.pendingChallenge() !== null);

  /** Pointer offset (-0.5..0.5) for the slow parallax of the matte background shapes. */
  protected readonly pointer = signal({ x: 0, y: 0 });

  protected readonly model = signal({ email: '', password: '' });
  protected readonly loginForm = form(this.model, (fields) => {
    required(fields.email, { message: 'Enter your email.' });
    email(fields.email, { message: 'Enter a valid email address, like name@cgiar.org.' });
    required(fields.password, { message: 'Enter your password.' });
  });

  protected readonly passwordModel = signal({ newPassword: '', confirm: '' });
  protected readonly passwordForm = form(this.passwordModel, (fields) => {
    required(fields.newPassword, { message: 'Enter a new password.' });
    minLength(fields.newPassword, 8, { message: 'Use at least 8 characters.' });
    required(fields.confirm, { message: 'Repeat the new password.' });
    validate(fields.confirm, ({ value, valueOf }) =>
      value() && value() !== valueOf(fields.newPassword)
        ? { kind: 'mismatch', message: 'The passwords do not match.' }
        : null,
    );
  });

  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopCooldown());
  }

  protected trackPointer(event: PointerEvent): void {
    this.pointer.set({
      x: event.clientX / window.innerWidth - 0.5,
      y: event.clientY / window.innerHeight - 0.5,
    });
  }

  protected shift(depth: number): string {
    const { x, y } = this.pointer();
    return `${(x * depth).toFixed(1)}px ${(y * depth).toFixed(1)}px`;
  }

  /** Errors show once the field was touched (blur) or a submit was attempted. */
  protected showErrors(field: FieldTree<string>): boolean {
    const state = field();
    return state.touched() && state.invalid();
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.locked()) return;
    this.failure.set(null);
    await submit(this.loginForm, async () => {
      try {
        const result = await this.session.signIn(this.model());
        if (!isChallenge(result)) await this.router.navigateByUrl(this.deepLink.consume());
      } catch (error) {
        this.fail(error);
      }
      return undefined;
    });
  }

  protected async onSetPassword(event: Event): Promise<void> {
    event.preventDefault();
    if (this.locked()) return;
    this.failure.set(null);
    await submit(this.passwordForm, async () => {
      try {
        await this.session.completeNewPassword(this.passwordModel().newPassword);
        await this.router.navigateByUrl(this.deepLink.consume());
      } catch (error) {
        this.fail(error);
      }
      return undefined;
    });
  }

  protected backToSignIn(): void {
    this.session.cancelChallenge();
    this.passwordModel.set({ newPassword: '', confirm: '' });
    this.failure.set(null);
  }

  protected async onSso(): Promise<void> {
    if (this.locked()) return;
    this.failure.set(null);
    try {
      await this.session.startSso();
    } catch (error) {
      this.fail(error);
    }
  }

  /** Server messages come from a closed catalog written for users: shown as is. */
  private fail(error: unknown): void {
    const apiError: ApiError = toApiError(error);
    if (apiError.code === AUTH_ERROR.TOO_MANY_REQUESTS)
      this.startCooldown(apiError.retryAfter ?? 60);
    this.failure.set(apiError.fieldMessage('newPassword') ?? apiError.message);
  }

  private startCooldown(seconds: number): void {
    this.stopCooldown();
    this.cooldown.set(Math.max(1, Math.ceil(seconds)));
    this.cooldownTimer = setInterval(() => {
      this.cooldown.update((left) => left - 1);
      if (this.cooldown() <= 0) this.stopCooldown();
    }, 1000);
  }

  private stopCooldown(): void {
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    this.cooldownTimer = null;
    this.cooldown.set(0);
  }
}
