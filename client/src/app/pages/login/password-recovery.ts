import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  FieldTree,
  FormField,
  form,
  maxLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { HlmButton } from '@spartan/button';
import { HlmFieldImports } from '@spartan/field';
import { HlmInput } from '@spartan/input';
import { HlmSpinner } from '@spartan/spinner';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from '../../core/auth/auth-api';
import { AUTH_ERROR } from '../../core/auth/auth.models';
import { emailText, requiredText } from '../../core/forms/text-validators';
import { ApiError, toApiError } from '../../core/http/api-envelope';
import { LOGIN_FIELD_STYLES } from './login-field.styles';
import { PASSWORD_RULES_MESSAGE, meetsPasswordPolicy } from './password-policy';
import { PasswordRequirements } from './password-requirements';
import { PasswordToggle } from './password-toggle';

type Step = 'request' | 'reset';
type Action = 'send' | 'resend' | 'reset';

/** Neutral on purpose: the server answers the same whether or not the account exists. */
export const CODE_SENT_NOTICE =
  'If this email has a QA account with a password, we sent a verification code to it. ' +
  'If you have never signed in, we sent you a new temporary password instead — use it to sign in.';
export const CODE_RESENT_NOTICE =
  'We sent the email again. If this email has a QA account with a password, use the newest code.';

/**
 * Self-service password recovery for custom (non-CGIAR) accounts, inside the login page:
 * step "request" asks for a code by email, step "reset" sets the new password with it.
 */
@Component({
  selector: 'app-password-recovery',
  imports: [
    FormField,
    HlmButton,
    HlmFieldImports,
    HlmInput,
    HlmSpinner,
    PasswordRequirements,
    PasswordToggle,
  ],
  templateUrl: './password-recovery.html',
  styles: LOGIN_FIELD_STYLES,
})
export class PasswordRecovery {
  private readonly api = inject(AuthApi);
  private readonly injector = inject(Injector);

  /** What the user had typed in the sign-in form. */
  readonly email = input('');
  /** The password was changed: back to sign in with this email. */
  readonly done = output<string>();
  /** The user left the recovery: back to sign in with this email. */
  readonly back = output<string>();

  protected readonly step = signal<Step>('request');
  protected readonly running = signal<Action | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly requestModel = linkedSignal(() => ({ email: this.email().trim() }));
  protected readonly requestForm = form(this.requestModel, (fields) => {
    requiredText(fields.email, { message: 'Enter your email.' });
    emailText(fields.email, { message: 'Enter a valid email address, like name@example.org.' });
  });
  private readonly sentTo = computed(() => this.requestModel().email.trim());

  protected readonly resetModel = signal({ code: '', newPassword: '', confirm: '' });
  protected readonly resetForm = form(this.resetModel, (fields) => {
    requiredText(fields.code, { message: 'Enter the verification code.' });
    maxLength(fields.code, 20, { message: 'The code has at most 20 characters.' });
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

  constructor() {
    this.focusHeading();
  }

  /** Errors show once the field was touched (blur) or a submit was attempted. */
  protected showErrors(field: FieldTree<string>): boolean {
    const state = field();
    return state.touched() && state.invalid();
  }

  protected async onSend(event: Event): Promise<void> {
    event.preventDefault();
    if (this.running()) return;
    this.failure.set(null);
    await submit(this.requestForm, async () => {
      const error = await this.requestCode('send');
      if (!error) {
        this.notice.set(CODE_SENT_NOTICE);
        this.step.set('reset');
        this.focusHeading();
        return undefined;
      }
      const emailMessage =
        error.code === AUTH_ERROR.VALIDATION_FAILED ? error.fieldMessage('email') : null;
      if (emailMessage) {
        return [{ kind: 'server', message: emailMessage, fieldTree: this.requestForm.email }];
      }
      this.failure.set(error.message);
      return undefined;
    });
  }

  protected async onResend(): Promise<void> {
    if (this.running()) return;
    this.failure.set(null);
    this.notice.set(null);
    const error = await this.requestCode('resend');
    if (error) this.failure.set(error.message);
    else this.notice.set(CODE_RESENT_NOTICE);
  }

  protected async onReset(event: Event): Promise<void> {
    event.preventDefault();
    if (this.running()) return;
    this.failure.set(null);
    await submit(this.resetForm, async () => {
      const { code, newPassword } = this.resetModel();
      this.running.set('reset');
      try {
        await firstValueFrom(
          this.api.resetPassword(this.sentTo(), code.trim(), newPassword.trim()),
        );
        this.done.emit(this.sentTo());
        return undefined;
      } catch (caught) {
        return this.resetErrors(toApiError(caught));
      } finally {
        this.running.set(null);
      }
    });
  }

  protected goBack(): void {
    this.back.emit(this.sentTo());
  }

  /** Field errors go next to their field; anything else goes to the banner. */
  private resetErrors(error: ApiError) {
    const { code, newPassword } = this.resetForm;
    if (error.code === AUTH_ERROR.RESET_CODE_INVALID) {
      return [{ kind: 'server', message: error.message, fieldTree: code }];
    }
    if (error.code === AUTH_ERROR.PASSWORD_POLICY) {
      const message = error.fieldMessage('newPassword') ?? error.message;
      return [{ kind: 'server', message, fieldTree: newPassword }];
    }
    if (error.code === AUTH_ERROR.VALIDATION_FAILED) {
      const fieldErrors = [
        { message: error.fieldMessage('code'), fieldTree: code },
        { message: error.fieldMessage('newPassword'), fieldTree: newPassword },
      ].flatMap(({ message, fieldTree }) =>
        message ? [{ kind: 'server', message, fieldTree }] : [],
      );
      if (fieldErrors.length) return fieldErrors;
    }
    this.failure.set(error.message);
    return undefined;
  }

  /** Asks the server to email a code. Resolves with the error, or null when it was accepted. */
  private async requestCode(action: 'send' | 'resend'): Promise<ApiError | null> {
    this.running.set(action);
    try {
      await firstValueFrom(this.api.forgotPassword(this.sentTo()));
      return null;
    } catch (caught) {
      return toApiError(caught);
    } finally {
      this.running.set(null);
    }
  }

  private focusHeading(): void {
    afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
  }
}
