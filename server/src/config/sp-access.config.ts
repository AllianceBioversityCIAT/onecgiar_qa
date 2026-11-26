import { registerAs } from '@nestjs/config';

/**
 * The Science Program view (P2-3911, `docs/sp-view/reporting-integration.md`
 * § 5). Both optional:
 * - `SP_ACCESS_API_KEY` (secret, read only here, never logged): the key the
 *   Reporting back sends as `x-api-key` to `POST /sp-access/codes`. Unset or
 *   empty, SP access is off and that route answers 503 `SP_ACCESS_DISABLED`.
 * - `SP_REPORTING_RESULT_URL`: an `https://` template with `{resultCode}` for
 *   the "Open in Reporting" link (validated in `validateEnv`). Unset, no link.
 */
export const spAccessConfig = registerAs('spAccess', () => ({
  apiKey: process.env.SP_ACCESS_API_KEY || undefined,
  reportingResultUrl: process.env.SP_REPORTING_RESULT_URL || undefined,
}));
