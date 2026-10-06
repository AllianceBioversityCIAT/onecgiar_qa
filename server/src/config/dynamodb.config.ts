import { registerAs } from '@nestjs/config';

export const dynamoDbConfig = registerAs('dynamodb', () => ({
  region: process.env.AWS_REGION!,
  tableName: process.env.DYNAMODB_TABLE_NAME!,
  // Only set for local development (e.g. DynamoDB Local).
  endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
}));
