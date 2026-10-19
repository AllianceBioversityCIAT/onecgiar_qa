import { afterEach, describe, expect, it, vi } from 'vitest';
import { cognitoAdminConfig } from './cognito-admin.config.js';

describe('cognitoAdminConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('takes the pool from COGNITO_REGION and COGNITO_USER_POOL_ID', () => {
    vi.stubEnv('COGNITO_REGION', 'eu-west-1');
    vi.stubEnv('COGNITO_USER_POOL_ID', 'eu-west-1_abc');
    expect(cognitoAdminConfig()).toMatchObject({
      region: 'eu-west-1',
      userPoolId: 'eu-west-1_abc',
    });
  });

  it('passes explicit credentials only when both keys are set', () => {
    vi.stubEnv('COGNITO_ADMIN_ACCESS_KEY_ID', 'id-1');
    vi.stubEnv('COGNITO_ADMIN_SECRET_ACCESS_KEY', 'secret-1');
    expect(cognitoAdminConfig().credentials).toEqual({
      accessKeyId: 'id-1',
      secretAccessKey: 'secret-1',
    });
  });

  it.each([
    ['neither key', undefined, undefined],
    ['empty keys', '', ''],
    ['only the id', 'id-1', undefined],
  ])(
    'leaves credentials to the default chain (IAM role) with %s',
    (_l, id, secret) => {
      if (id === undefined) delete process.env.COGNITO_ADMIN_ACCESS_KEY_ID;
      else vi.stubEnv('COGNITO_ADMIN_ACCESS_KEY_ID', id);
      if (secret === undefined)
        delete process.env.COGNITO_ADMIN_SECRET_ACCESS_KEY;
      else vi.stubEnv('COGNITO_ADMIN_SECRET_ACCESS_KEY', secret);
      expect(cognitoAdminConfig().credentials).toBeUndefined();
    },
  );
});
