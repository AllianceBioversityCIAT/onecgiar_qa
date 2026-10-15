import { TextField, URI_MAX_LENGTH } from './auth-fields.js';

/**
 * `GET /auth/provider-url?redirectUri=` (FR-6). Required: a request without
 * one does not start with an allowed origin either. Checked against
 * `ALLOWED_ORIGINS` by the controller.
 */
export class ProviderUrlQuery {
  @TextField(URI_MAX_LENGTH)
  redirectUri!: string;
}
