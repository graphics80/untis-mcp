import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 90_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/types.ts'],
      thresholds: {
        lines: 88,
        functions: 88,
        branches: 68,
        statements: 88,
      },
      reporter: ['text', 'text-summary'],
    },
  },
});
