import { parseAllowedOrigins, validateEnv } from './env.validation.js';

const VALID = {
  DATABASE_URL: 'mysql://u:p@localhost:3306/db',
  AWS_REGION: 'us-east-1',
  DYNAMODB_TABLE_NAME: 't',
  COGNITO_REGION: 'us-east-1',
  COGNITO_USER_POOL_ID: 'us-east-1_abc',
  COGNITO_CLIENT_ID: 'client',
  COGNITO_CLIENT_SECRET: 'secret',
  COGNITO_URL: 'https://example.auth.us-east-1.amazoncognito.com',
  ALLOWED_ORIGINS: 'https://qa.example.org',
};

describe('validateEnv', () => {
  it('accepts a complete environment', () => {
    expect(validateEnv({ ...VALID })).toMatchObject(VALID);
  });

  it.each(Object.keys(VALID))('names %s when it is missing', (key) => {
    const env: Record<string, unknown> = { ...VALID };
    delete env[key];
    expect(() => validateEnv(env)).toThrow(key);
  });

  it('treats an empty value as missing', () => {
    expect(() => validateEnv({ ...VALID, COGNITO_CLIENT_ID: '' })).toThrow(
      'COGNITO_CLIENT_ID',
    );
  });

  it('names every missing auth variable at once', () => {
    expect(() => validateEnv({})).toThrow(
      /COGNITO_REGION.*COGNITO_USER_POOL_ID.*COGNITO_CLIENT_ID.*COGNITO_CLIENT_SECRET.*COGNITO_URL.*ALLOWED_ORIGINS/,
    );
  });

  it.each(['COGNITO_URL', 'COGNITO_USER_POOL_URL'])(
    'rejects a non-https %s (secrets travel to it)',
    (key) => {
      expect(() =>
        validateEnv({ ...VALID, [key]: 'http://cognito.example.com' }),
      ).toThrow(key);
    },
  );

  it('accepts the optional COGNITO_USER_POOL_URL when absent', () => {
    expect(() => validateEnv({ ...VALID })).not.toThrow();
  });

  it.each(['DYNAMODB_ACCESS_KEY_ID', 'DYNAMODB_SECRET_ACCESS_KEY'])(
    'refuses %s alone, naming the missing partner',
    (key) => {
      const partner =
        key === 'DYNAMODB_ACCESS_KEY_ID'
          ? 'DYNAMODB_SECRET_ACCESS_KEY'
          : 'DYNAMODB_ACCESS_KEY_ID';
      expect(() => validateEnv({ ...VALID, [key]: 'x' })).toThrow(partner);
    },
  );

  it('accepts both DynamoDB keys together, or neither', () => {
    expect(() =>
      validateEnv({
        ...VALID,
        DYNAMODB_ACCESS_KEY_ID: 'id',
        DYNAMODB_SECRET_ACCESS_KEY: 'secret',
      }),
    ).not.toThrow();
    expect(() => validateEnv({ ...VALID })).not.toThrow();
  });

  it('rejects an http origin that is not localhost', () => {
    expect(() =>
      validateEnv({ ...VALID, ALLOWED_ORIGINS: 'http://evil.com' }),
    ).toThrow(/http:\/\/evil\.com/);
  });

  it('accepts http://localhost:4200 next to an https origin', () => {
    const env = validateEnv({
      ...VALID,
      ALLOWED_ORIGINS: 'https://qa.example.org, http://localhost:4200',
    });
    expect(env.ALLOWED_ORIGINS).toContain('localhost:4200');
  });
});

describe('parseAllowedOrigins', () => {
  it('splits, trims and ignores empty segments', () => {
    expect(
      parseAllowedOrigins(' https://a.org ,http://localhost:4200,, '),
    ).toEqual(['https://a.org', 'http://localhost:4200']);
  });

  it.each([
    '*',
    'http://evil.com',
    'http://localhost',
    'http://localhost.evil.com:4200',
    'http://127.0.0.1:4200',
    'https://a.org/',
    'https://a.org/path',
    'ftp://a.org',
    'not a url',
    'https://user@a.org',
  ])('rejects %s', (entry) => {
    expect(() => parseAllowedOrigins(entry)).toThrow(/ALLOWED_ORIGINS/);
  });

  it('rejects a list with no usable entry', () => {
    expect(() => parseAllowedOrigins(' , ')).toThrow(/ALLOWED_ORIGINS/);
  });
});
