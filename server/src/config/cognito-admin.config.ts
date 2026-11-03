import { registerAs } from '@nestjs/config';

export const cognitoAdminConfig = registerAs('cognitoAdmin', () => {
  // Local development only, and always both together (env validation). In
  // TEST/PROD they are absent and the SDK's default chain (the host's IAM role)
  // provides credentials. Read only here; never logged (FR-17).
  const accessKeyId = process.env.COGNITO_ADMIN_ACCESS_KEY_ID || undefined;
  const secretAccessKey =
    process.env.COGNITO_ADMIN_SECRET_ACCESS_KEY || undefined;
  return {
    region: process.env.COGNITO_REGION!,
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
  };
});
