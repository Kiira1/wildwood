import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Native checkouts and local runner workspaces are generated copies.
    exclude: [...configDefaults.exclude, 'mobile/.build/**', 'mobile/www/**', 'local-data/**'],
  },
});
