import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'data/**', 'lab/renders/**'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // The root tooling files belong to no tsconfig project, so let the service
        // fall back to a default program for just those two.
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'vite.config.ts', 'vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /* CLAUDE.md: no `any` in committed code. Errors, not warnings — a warning
         in CI is a warning nobody reads. */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      /* SPEC §5 determinism: every client PRNG call must come from the seeded
         generator, because all listeners must make the same "random" choice and
         lab renders must reproduce from a seed. This rule is the guard rail;
         lab/fixtures and tooling may opt out with an explicit eslint-disable. */
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'SPEC §5: use the seeded PRNG. Math.random breaks listener sync and lab reproducibility.',
        },
      ],
    },
  },
  { files: ['**/*.test.ts'], rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },
  {
    // The root tooling files sit outside every tsconfig, so type-aware rules have
    // no real type information to work from and only produce noise. tsc does not
    // check them either; they are configuration, not application code.
    files: ['eslint.config.js', 'vite.config.ts', 'vitest.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
