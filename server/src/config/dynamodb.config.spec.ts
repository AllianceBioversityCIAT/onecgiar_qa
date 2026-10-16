import { afterEach, describe, expect, it, vi } from 'vitest';
import { dynamoDbConfig } from './dynamodb.config.js';

describe('dynamoDbConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes explicit credentials only when both keys are set', () => {
    vi.stubEnv('DYNAMODB_ACCESS_KEY_ID', 'id-1');
    vi.stubEnv('DYNAMODB_SECRET_ACCESS_KEY', 'secret-1');
    expect(dynamoDbConfig().credentials).toEqual({
      accessKeyId: 'id-1',
      secretAccessKey: 'secret-1',
    });
  });

  it.each([
    ['neither key', undefined, undefined],
    ['empty keys', '', ''],
  ])(
    'leaves credentials to the default chain (IAM role) with %s',
    (_l, id, secret) => {
      if (id === undefined) delete process.env.DYNAMODB_ACCESS_KEY_ID;
      else vi.stubEnv('DYNAMODB_ACCESS_KEY_ID', id);
      if (secret === undefined) delete process.env.DYNAMODB_SECRET_ACCESS_KEY;
      else vi.stubEnv('DYNAMODB_SECRET_ACCESS_KEY', secret);
      expect(dynamoDbConfig().credentials).toBeUndefined();
    },
  );
});
