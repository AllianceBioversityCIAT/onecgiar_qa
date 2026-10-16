import { CODE_MAX_LENGTH, TextField, URI_MAX_LENGTH } from './auth-fields.js';

/**
 * `POST /auth/callback` (FR-7). `redirectUri` is checked against
 * `ALLOWED_ORIGINS` by the controller, which holds the configuration.
 */
export class CallbackDto {
  @TextField(CODE_MAX_LENGTH, {
    description:
      'Authorization code from the Hosted UI redirect (`?code=`); single use, short-lived',
  })
  code!: string;

  @TextField(URI_MAX_LENGTH, {
    description:
      'The same redirect URI used for the provider URL; must start with an allowed origin',
    example: 'http://localhost:4200/auth/callback',
  })
  redirectUri!: string;
}
