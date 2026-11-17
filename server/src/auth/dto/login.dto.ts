import { EmailField, PasswordField } from './auth-fields.js';

/** `POST /auth/login` (FR-4). */
export class LoginDto {
  @EmailField()
  email!: string;

  @PasswordField('Cognito password (leading and trailing spaces are ignored)')
  password!: string;
}
