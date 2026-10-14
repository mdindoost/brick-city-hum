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
});
