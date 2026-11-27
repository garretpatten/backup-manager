import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['node_modules/**', 'dist/**'],
      // Ratchet: hold the baseline and raise it as coverage grows. Keep the
      // floor below the measured values (84.95% lines, 69.93% branches at
      // the time of writing) so ordinary churn cannot fail CI.
      thresholds: {
        lines: 84,
        branches: 69,
      },
    },
  },
});
