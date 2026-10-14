import { defineConfig } from 'vite';

/**
 * Builds `lab/bundle-entry.ts` into one self-contained IIFE that Playwright injects
 * into `about:blank`. Separate from the client build because this bundle exists only
 * to be measured, and must never end up in anything a listener loads.
 */
export default defineConfig({
  build: {
    outDir: 'lab/bundle',
    emptyOutDir: true,
    lib: {
      entry: 'lab/bundle-entry.ts',
      name: 'BrickCityLab',
      formats: ['iife'],
      fileName: () => 'lab-bundle.js',
    },
    // Readable stack traces matter more than size for a measurement harness.
    minify: false,
  },
});
