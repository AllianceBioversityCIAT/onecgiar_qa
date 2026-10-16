import { EmailField, PASSWORD_MAX_LENGTH, TextField } from './auth-fields.js';

/** `POST /auth/login` (FR-4). */
export class LoginDto {
  @EmailField()
  email!: string;

  @TextField(PASSWORD_MAX_LENGTH, {
    description: 'Cognito password',
    format: 'password',
  })
  password!: string;
}
