// ESLint 9 flat config for Zelo V2 monorepo.
// Covers the NestJS API (apps/api) and the Next.js web app (apps/web).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // ─── Ignore patterns ───
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
    ],
  },

  // ─── Base: JS recommended for all .js/.mjs files ───
  js.configs.recommended,

  // ─── TypeScript: recommended (non-type-checked) for all .ts/.tsx ───
  // Using the non-type-checked set so lint doesn't require per-package
  // tsconfig project resolution and stays fast across the monorepo.
  ...tseslint.configs.recommended,

  // ─── Global language options for TS/JSX files ───
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  // ─── API: NestJS backend (Node, CommonJS, decorators) ───
  {
    files: ['apps/api/src/**/*.ts'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // NestJS DI: allow unused constructor-arg names via leading underscore
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // NestJS relies on empty lifecycle hooks occasionally
      '@typescript-eslint/no-empty-function': 'off',
    },
  },

  // ─── Web: Next.js frontend (browser, React 19) ───
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },

  // ─── Shared packages (crypto, contracts, db, config) ───
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },

  // ─── Test files ───
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // ─── Config files at root (.mjs, .cjs, turbo, postcss) ───
  {
    files: ['*.mjs', '*.cjs', '*.config.{ts,js,mjs,cjs}'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
);
