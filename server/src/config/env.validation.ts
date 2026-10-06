const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'AWS_REGION',
  'DYNAMODB_TABLE_NAME',
] as const;

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const missing = REQUIRED_ENV_VARS.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
  return config;
}
