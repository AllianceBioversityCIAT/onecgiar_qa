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
    },
  },
});
