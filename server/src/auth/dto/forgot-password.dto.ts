import { ApiProperty } from '@nestjs/swagger';
import {
  EmailField,
  PasswordField,
  RESET_CODE_MAX_LENGTH,
  TextField,
  Trim,
} from './auth-fields.js';

/** `POST /auth/forgot-password`: ask Cognito to email a verification code. */
export class ForgotPasswordDto {
  @EmailField()
  email!: string;
}

/** `POST /auth/reset-password`: set a new password with the emailed code. */
export class ResetPasswordDto {
  @EmailField()
  email!: string;

  @Trim()
  @TextField(RESET_CODE_MAX_LENGTH, {
    description: 'The verification code from the password-reset email',
    example: '123456',
  })
  code!: string;

  @PasswordField(
    'New password (Cognito password policy applies; leading and trailing spaces are ignored)',
  )
  newPassword!: string;
}

/** The answer of `POST /auth/forgot-password`: the same whatever the email. */
export class ForgotPasswordResponse {
  @ApiProperty({
    type: Boolean,
    description:
      'Always true: the request was taken. It never tells whether the email has an account',
    example: true,
  })
  accepted!: true;
}
