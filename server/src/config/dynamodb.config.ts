import { registerAs } from '@nestjs/config';

export const dynamoDbConfig = registerAs('dynamodb', () => {
  // Local development only, and always both together (env validation). In
  // TEST/PROD they are absent and the SDK's default chain (the host's IAM role)
  // provides credentials. Read only here; never logged (FR-17).
  const accessKeyId = process.env.DYNAMODB_ACCESS_KEY_ID || undefined;
  const secretAccessKey = process.env.DYNAMODB_SECRET_ACCESS_KEY || undefined;
  return {
    region: process.env.AWS_REGION!,
    tableName: process.env.DYNAMODB_TABLE_NAME!,
    // Only set for local development (e.g. DynamoDB Local).
    endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
  };
});
