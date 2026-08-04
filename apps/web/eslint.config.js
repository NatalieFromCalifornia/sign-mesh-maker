import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/*
 * Deliberately narrow. Behaviour is covered by the test suites, so this is here
 * for what tests cannot see: hook dependency mistakes, unused code left behind
 * by a refactor, and `any` slipping past the type checker.
 */
export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      /*
       * Off deliberately. Every hit in this codebase is an async data load or a
       * prop sync — opening a project, listing projects, following a numeric
       * value from outside — which the rule cannot tell apart from the
       * cascading-render mistake it exists to catch. A rule that is wrong every
       * time it fires trains people to ignore the ones that matter.
       *
       * rules-of-hooks and exhaustive-deps stay on; those earn their keep.
       */
      'react-hooks/set-state-in-effect': 'off',
      // Underscore marks a binding kept for its position or shape.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests reach into shapes on purpose; three's ImageData stand-ins and
    // Firestore error fakes are not worth modelling exactly.
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
