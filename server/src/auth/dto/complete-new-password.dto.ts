import {
  EmailField,
  PASSWORD_MAX_LENGTH,
  SESSION_MAX_LENGTH,
  TextField,
} from './auth-fields.js';

/** `POST /auth/complete-new-password` (FR-5). */
export class CompleteNewPasswordDto {
  @EmailField()
  email!: string;

  @TextField(PASSWORD_MAX_LENGTH, {
    description: 'New password (Cognito password policy applies)',
    format: 'password',
  })
  newPassword!: string;

  /** The challenge session Cognito returned from the login. */
  @TextField(SESSION_MAX_LENGTH, {
    description:
      'The `session` returned by the NEW_PASSWORD_REQUIRED login answer',
  })
  session!: string;
}
