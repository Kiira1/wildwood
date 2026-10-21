import { configDefaults, defineConfig } from 'vitest/config';

// Opt-in runners: offline tools that use vitest as a harness, not tests. Each
// runs only through its own command, never in the default suite.
const runners = [
  // npm run test:balance (~10s, checks the offline Balance Lab).
  { file: 'src/balance/simulator.test.ts', enabled: process.env.BALANCE_SIM === '1' },
  // npm run sim:autofarm.
  { file: 'src/game/runtime/auto-farm/autofarm-sim/autofarm-sim.test.ts', enabled: process.env.AUTOFARM_SIM === '1' },
  // FORECAST_CALIBRATION=survey|trace|compare|fit|growth npx vitest run <file>.
  { file: 'src/game/runtime/auto-farm/autofarm-sim/forecast-calibration.test.ts', enabled: Boolean(process.env.FORECAST_CALIBRATION) },
];

export default defineConfig({
  test: {
    // Native checkouts, local runner workspaces and agent worktrees are copies.
    exclude: [
      ...configDefaults.exclude, 'mobile/.build/**', 'mobile/www/**', 'local-data/**', '.claude/**',
      ...runners.filter(runner => !runner.enabled).map(runner => runner.file),
    ],
  },
});
