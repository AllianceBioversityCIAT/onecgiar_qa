import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import e2e from './vitest.config.e2e.js';

// One-off measurements (never part of `pnpm test` or `pnpm test:e2e`):
//   pnpm exec vitest run --config ./vitest.config.measure.ts
// Same dummy env as the e2e config, but only the `*.measure.ts` files.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/perf/**/*.measure.ts'],
    testTimeout: 120_000,
    env: e2e.test?.env ?? {},
  },
});
