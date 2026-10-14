import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    // SPEC §6.9: client sample budget is < 15 MB, lazy-loaded per palette.
    // Warn early rather than discover it on a phone.
    chunkSizeWarningLimit: 600,
  },
  server: { port: 5173 },
  test: {
    // Tests live beside the code they test, on both sides of the app.
    include: ['{server,client,lab}/**/*.test.ts'],
    // SPEC §5: nothing audible or visible may use Math.random, so tests must be
    // reproducible too. Any test needing randomness takes an explicit seed.
    environment: 'node',
  },
});
