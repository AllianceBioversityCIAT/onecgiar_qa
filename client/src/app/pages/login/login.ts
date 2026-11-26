import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { FieldTree, FormField, form, required, submit, validate } from '@angular/forms/signals';
import { HlmButton } from '@spartan/button';
import { HlmFieldImports } from '@spartan/field';
import { HlmInput } from '@spartan/input';
import { HlmSpinner } from '@spartan/spinner';
import { AuthSession } from '../../core/auth/auth-session';
import { emailText, requiredText } from '../../core/forms/text-validators';
import { AUTH_ERROR, isChallenge } from '../../core/auth/auth.models';
import { DeepLink } from '../../core/auth/deep-link';
import { ApiError, toApiError } from '../../core/http/api-envelope';
import { LOGIN_FIELD_STYLES } from './login-field.styles';
import { PasswordRecovery } from './password-recovery';
import { PASSWORD_RULES_MESSAGE, meetsPasswordPolicy } from './password-policy';
import { PasswordRequirements } from './password-requirements';
import { PasswordToggle } from './password-toggle';
import { ResultPreview } from './result-preview';

export const PASSWORD_CHANGED_NOTICE = 'Your password was changed. Sign in with your new password.';

@Component({
  selector: 'app-login',
  imports: [
    FormField,
    HlmButton,
    HlmFieldImports,
    HlmInput,
    HlmSpinner,
    PasswordRecovery,
    PasswordRequirements,
    PasswordToggle,
    ResultPreview,
  ],
  templateUrl: './login.html',
  styles: [
    LOGIN_FIELD_STYLES,
    `
      /* Spartan tokens re-pointed to the active palette inside the dark form panel. */
      .on-dark {
        --foreground: var(--qa-on-dark);
        --muted-foreground: var(--qa-muted-on-dark);
        --input: transparent;
        --ring: var(--qa-primary-soft);
        --destructive: var(--qa-danger);
      }
      @media (prefers-reduced-motion: no-preference) {
        .reveal {
          animation: reveal 280ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes reveal {
          from {
            opacity: 0;
            translate: 0 -0.5rem;
          }
        }
        .drift {
          transition: translate 900ms cubic-bezier(0.22, 1, 0.36, 1);
        }
      }
    `,
  ],
})
export class LoginPage {
  private readonly session = inject(AuthSession);
  private readonly router = inject(Router);
  private readonly deepLink = inject(DeepLink);
  private readonly injector = inject(Injector);

  protected readonly busy = this.session.signingIn;
  protected readonly failure = signal<string | null>(null);
  /** Seconds left before another attempt is allowed (server 429 `retryAfter`). */
  protected readonly cooldown = signal(0);
  /** Between a successful sign-in and the end of the navigation the form stays locked. */
  private readonly navigating = signal(false);
  /**
   * False until Angular runs in the browser. The login page is prerendered: a click before
   * hydration would submit the form natively (GET) and put the password in the URL. With the
   * submit button disabled, neither a click nor Enter can submit it.
   */
  protected readonly interactive = signal(false);
  protected readonly locked = computed(
    () => !this.interactive() || this.busy() || this.navigating() || this.cooldown() > 0,
  );
  /** The startup refresh could not reach the service (not "no session"). */
  protected readonly serviceProblem = this.session.startupError;
  /** The server closed the session for a reason the user must read (inactive, no roles…). */
  protected readonly sessionEndReason = this.session.sessionEndReason;
  /** First login of a custom user: the server asks for a new password before giving a session. */
  protected readonly settingPassword = computed(() => this.session.pendingChallenge() !== null);

  /**
   * SSO is the main way in; email + password (custom users) stays folded behind a button
   * until the user asks for it.
   */
  protected readonly passwordSignIn = signal(false);
  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');
  private readonly passwordInput = viewChild<ElementRef<HTMLInputElement>>('passwordInput');
  private readonly forgotButton = viewChild<ElementRef<HTMLButtonElement>>('forgotButton');

  /** Custom users who forgot their password: the recovery view replaces the sign-in form. */
  protected readonly recovering = signal(false);
  /** Polite confirmation shown above the sign-in form (e.g. after a password reset). */
  protected readonly notice = signal<string | null>(null);

  /** Pointer offset (-0.5..0.5) for the slow parallax of the matte background shapes. */
  protected readonly pointer = signal({ x: 0, y: 0 });

  protected readonly model = signal({ email: '', password: '' });
  protected readonly loginForm = form(this.model, (fields) => {
    requiredText(fields.email, { message: 'Enter your email.' });
    emailText(fields.email, { message: 'Enter a valid email address, like name@cgiar.org.' });
    required(fields.password, { message: 'Enter your password.' });
  });

  protected readonly passwordModel = signal({ newPassword: '', confirm: '' });
  protected readonly passwordForm = form(this.passwordModel, (fields) => {
    required(fields.newPassword, { message: 'Enter a new password.' });
    validate(fields.newPassword, ({ value }) =>
      value() && !meetsPasswordPolicy(value().trim())
        ? { kind: 'policy', message: PASSWORD_RULES_MESSAGE }
        : null,
    );
    required(fields.confirm, { message: 'Repeat the new password.' });
    validate(fields.confirm, ({ value, valueOf }) =>
      value() && value().trim() !== valueOf(fields.newPassword).trim()
        ? { kind: 'mismatch', message: 'The passwords do not match.' }
        : null,
    );
  });

  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    afterNextRender(() => this.interactive.set(true));
    inject(DestroyRef).onDestroy(() => this.stopCooldown());
  }

  protected showPasswordSignIn(): void {
    this.passwordSignIn.set(true);
    afterNextRender(() => this.emailInput()?.nativeElement.focus(), { injector: this.injector });
  }

  protected startRecovery(): void {
    this.failure.set(null);
    this.notice.set(null);
    this.recovering.set(true);
  }

  /** The password was reset: back to the sign-in form with the email filled in. */
  protected onRecoveryDone(email: string): void {
    this.leaveRecovery(email);
    this.notice.set(PASSWORD_CHANGED_NOTICE);
    afterNextRender(() => this.passwordInput()?.nativeElement.focus(), { injector: this.injector });
  }

  protected onRecoveryBack(email: string): void {
    this.leaveRecovery(email);
    afterNextRender(() => this.forgotButton()?.nativeElement.focus(), { injector: this.injector });
  }

  private leaveRecovery(email: string): void {
    this.recovering.set(false);
    this.passwordSignIn.set(true);
    this.loginForm().reset({ email: email || this.model().email, password: '' });
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
    this.notice.set(null);
    await submit(this.loginForm, async () => {
      try {
        // Pasted credentials often carry a space; Cognito never accepts one at either end.
        const { email, password } = this.model();
        const result = await this.session.signIn({
          email: email.trim(),
          password: password.trim(),
        });
        if (!isChallenge(result)) await this.go();
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
        await this.session.completeNewPassword(this.passwordModel().newPassword.trim());
        await this.go();
      } catch (error) {
        this.fail(error);
      }
      return undefined;
    });
  }

  private async go(): Promise<void> {
    this.navigating.set(true);
    try {
      await this.router.navigateByUrl(this.deepLink.consume());
    } finally {
      this.navigating.set(false);
    }
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
