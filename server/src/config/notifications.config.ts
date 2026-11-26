import { registerAs } from '@nestjs/config';
import { parseAllowedOrigins } from './env.validation.js';

/** The unit's Notification Microservice (HTTP entry point, `POST {url}/send`). */
export const DEFAULT_NOTIFICATION_API_URL =
  'https://reports.prms.cgiar.org/api/email';

/**
 * Transactional email through the One CGIAR Notification Microservice. The
 * service authenticates with the CLARISA API key, which stays in
 * `catalogsConfig` (its only reader); this namespace holds the rest:
 *
 * - `apiUrl`: base URL of the service (`NOTIFICATION_API_URL`, `https://`),
 *   without `/send`. Defaults to the production instance.
 * - `enabled`: `NOTIFICATION_EMAIL_ENABLED=false` turns sending off (local work).
 * - `appUrl`: the QA web app linked from the emails (`APP_URL`), else the
 *   first `https://` entry of `ALLOWED_ORIGINS`, else none (no link).
 */
export const notificationsConfig = registerAs('notifications', () => ({
  apiUrl: (
    process.env.NOTIFICATION_API_URL || DEFAULT_NOTIFICATION_API_URL
  ).replace(/\/+$/, ''),
  enabled: process.env.NOTIFICATION_EMAIL_ENABLED !== 'false',
  appUrl: appUrl(process.env.APP_URL, process.env.ALLOWED_ORIGINS),
}));

function appUrl(
  explicit: string | undefined,
  origins: string | undefined,
): string | null {
  if (explicit) return explicit.replace(/\/+$/, '');
  if (!origins) return null;
  try {
    return (
      parseAllowedOrigins(origins).find((o) => o.startsWith('https://')) ?? null
    );
  } catch {
    return null;
  }
}
