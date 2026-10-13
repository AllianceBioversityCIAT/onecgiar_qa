import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Dummy values so AppModule passes env validation. The MySQL pool and the
    // DynamoDB client connect lazily, so no real database is needed.
    env: {
      DATABASE_URL: 'mysql://test:test@localhost:3306/test',
      AWS_REGION: 'us-east-1',
      DYNAMODB_TABLE_NAME: 'test',
      COGNITO_REGION: 'us-east-1',
      COGNITO_USER_POOL_ID: 'us-east-1_test',
      COGNITO_CLIENT_ID: 'test-client',
      MS_AUTH_URL: 'https://auth.test.example.org',
      MS_AUTH_USER: 'test',
      MS_AUTH_PASSWORD: 'test',
      ALLOWED_ORIGINS: 'https://qa.example.org',
    },
  },
});
