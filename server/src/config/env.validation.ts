const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'AWS_REGION',
  'DYNAMODB_TABLE_NAME',
  'COGNITO_REGION',
  'COGNITO_USER_POOL_ID',
  'COGNITO_CLIENT_ID',
  'COGNITO_CLIENT_SECRET',
  'COGNITO_URL',
  'ALLOWED_ORIGINS',
] as const;

/**
 * Parses the comma-separated `ALLOWED_ORIGINS` list. Every entry must be an
 * exact `https://` origin (no path, no trailing slash, no credentials), except
 * `http://localhost:<port>` for local development. Throws naming the entry.
 */
export function parseAllowedOrigins(raw: string): string[] {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new Error('ALLOWED_ORIGINS must contain at least one origin');
  }

  for (const entry of entries) {
    if (!isAllowedOriginEntry(entry)) {
      throw new Error(
        `Invalid ALLOWED_ORIGINS entry "${entry}": expected an exact https:// origin (or http://localhost:<port>), without path or trailing slash`,
      );
    }
  }
  return entries;
}

function isAllowedOriginEntry(entry: string): boolean {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    return false;
  }
  // `origin` drops path, query, credentials and a trailing slash; requiring it
  // to equal the entry guarantees the entry is a bare origin and that the
  // exact-match comparison used by CORS can work.
  if (url.origin !== entry) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && url.hostname === 'localhost' && !!url.port;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const missing = REQUIRED_ENV_VARS.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
  parseAllowedOrigins(config.ALLOWED_ORIGINS as string);
  const openApi = config.OPENAPI_ENABLED;
  if (
    openApi !== undefined &&
    openApi !== '' &&
    openApi !== 'true' &&
    openApi !== 'false'
  ) {
    throw new Error('Invalid OPENAPI_ENABLED: expected "true" or "false"');
  }
  // Passwords, SECRET_HASH and the client secret travel to these (FR-18).
  for (const key of ['COGNITO_URL', 'COGNITO_USER_POOL_URL'] as const) {
    const value = config[key];
    if (value !== undefined && value !== '' && !isHttpsUrl(value as string)) {
      throw new Error(`Invalid ${key}: expected an https:// URL`);
    }
  }
  return config;
}
