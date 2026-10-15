import { CODE_MAX_LENGTH, TextField, URI_MAX_LENGTH } from './auth-fields.js';

/**
 * `POST /auth/callback` (FR-7). `redirectUri` is checked against
 * `ALLOWED_ORIGINS` by the controller, which holds the configuration.
 */
export class CallbackDto {
  @TextField(CODE_MAX_LENGTH)
  code!: string;

  @TextField(URI_MAX_LENGTH)
  redirectUri!: string;
}
