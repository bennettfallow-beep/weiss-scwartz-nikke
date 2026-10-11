import { defineConfig } from 'vitest/config';

// Two projects: fast unit/rule tests run on every `npm test`; the seeded
// fuzz harness (M2+) runs separately because it plays thousands of games.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/fuzz/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'fuzz',
          include: ['tests/fuzz/**/*.test.ts'],
          environment: 'node',
          testTimeout: 600_000,
        },
      },
    ],
  },
});
