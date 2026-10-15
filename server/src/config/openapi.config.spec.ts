import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateEnv } from './env.validation.js';
import { openApiConfig } from './openapi.config.js';

const VALID = {
  DATABASE_URL: 'mysql://u:p@localhost:3306/db',
  AWS_REGION: 'us-east-1',
  DYNAMODB_TABLE_NAME: 'table',
  COGNITO_REGION: 'us-east-1',
  COGNITO_USER_POOL_ID: 'us-east-1_abc',
  COGNITO_CLIENT_ID: 'client',
  COGNITO_CLIENT_SECRET: 'secret',
  COGNITO_URL: 'https://example.auth.us-east-1.amazoncognito.com',
  ALLOWED_ORIGINS: 'http://localhost:4200',
};

describe('openApiConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['development', undefined, true],
    ['test', '', true],
    ['production', undefined, false],
    ['production', 'true', true],
    ['development', 'false', false],
  ])('NODE_ENV=%s, OPENAPI_ENABLED=%j → enabled %s', (env, flag, enabled) => {
    vi.stubEnv('NODE_ENV', env);
    if (flag === undefined) delete process.env.OPENAPI_ENABLED;
    else vi.stubEnv('OPENAPI_ENABLED', flag);
    expect(openApiConfig().enabled).toBe(enabled);
  });
});

describe('validateEnv: OPENAPI_ENABLED', () => {
  it.each(['true', 'false', '', undefined])('accepts %j', (value) => {
    expect(() =>
      validateEnv({ ...VALID, OPENAPI_ENABLED: value }),
    ).not.toThrow();
  });

  it.each(['yes', '1', 'TRUE'])('rejects %j', (value) => {
    expect(() => validateEnv({ ...VALID, OPENAPI_ENABLED: value })).toThrow(
      'OPENAPI_ENABLED',
    );
  });
});
