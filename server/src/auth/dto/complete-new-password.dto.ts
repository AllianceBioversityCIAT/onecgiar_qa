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

  @TextField(PASSWORD_MAX_LENGTH)
  newPassword!: string;

  /** The challenge session the microservice returned from the login. */
  @TextField(SESSION_MAX_LENGTH)
  session!: string;
}
