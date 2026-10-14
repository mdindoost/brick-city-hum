import { defineConfig } from 'vitest/config';

/**
 * Separate from vite.config.ts deliberately: that one sets `root: 'client'` to build
 * the browser bundle, which would make Vitest look for tests only under client/.
 * Tests live beside the code they test, on both sides of the app.
 *
 * The cost of the split: Vitest reads this file INSTEAD of vite.config.ts, it does
 * not merge them. Nothing is lost today because the Vite config has no plugins or
 * aliases — but when the client gets either, they must be duplicated here (or both
 * configs should share a common fragment), or client tests will silently resolve
 * modules differently from the build.
 */
export default defineConfig({
  test: {
    include: ['{server,client,lab,shared}/**/*.test.ts'],
    environment: 'node',
    // SPEC §5: nothing audible or visible may use Math.random, so tests are
    // reproducible too — anything needing randomness takes an explicit seed.
  },
});
