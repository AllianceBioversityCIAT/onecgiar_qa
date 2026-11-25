import {
  EmailField,
  PasswordField,
  SESSION_MAX_LENGTH,
  TextField,
} from './auth-fields.js';

/** `POST /auth/complete-new-password` (FR-5). */
export class CompleteNewPasswordDto {
  @EmailField()
  email!: string;

  @PasswordField(
    'New password (Cognito password policy applies; leading and trailing spaces are ignored)',
  )
  newPassword!: string;

  /** The challenge session Cognito returned from the login. */
  @TextField(SESSION_MAX_LENGTH, {
    description:
      'The `session` returned by the NEW_PASSWORD_REQUIRED login answer',
  })
  session!: string;
}
