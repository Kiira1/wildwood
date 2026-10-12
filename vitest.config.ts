import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Native checkouts, local runner workspaces and agent worktrees are copies.
    // The balance simulator takes ~10s and checks the offline Balance Lab, so it
    // runs only through `npm run test:balance`.
    exclude: [
      ...configDefaults.exclude, 'mobile/.build/**', 'mobile/www/**', 'local-data/**', '.claude/**',
      ...(process.env.BALANCE_SIM === '1' ? [] : ['src/balance/simulator.test.ts']),
    ],
  },
});
