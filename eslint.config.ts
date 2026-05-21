import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-plugin-prettier/recommended';
import {defineConfig} from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // Ignore files
  {ignores: ['node_modules', 'dist', '.coverage', '**/*.config.{mjs,cjs,ts,js}']},

  // ESLint
  js.configs.recommended,

  // TypeScript
  tseslint.configs.recommendedTypeChecked,

  // Prettier
  prettier,

  // Global settings
  {languageOptions: {globals: globals.es2021, parserOptions: {projectService: true}}},

  // Rules
  {
    rules: {
      // Indicates if 'any' can be used somewhere
      '@typescript-eslint/no-explicit-any': 'error',
      // Warns when an argument of type 'any' is passed to a function that expects a specific type.
      '@typescript-eslint/no-unsafe-argument': 'error',
      // Requires Promises to be properly handled (with await or .catch).
      '@typescript-eslint/no-floating-promises': 'error',
      // Allows duplicate type constituents in unions or intersections.
      '@typescript-eslint/no-duplicate-type-constituents': 'off',
      // Allows redundant type constituents in unions or intersections.
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      // Allows access to members of objects of type 'any'.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      // Allows the use of the generic 'Function' type.
      '@typescript-eslint/no-unsafe-function-type': 'off',
      // Allows the use of the non-null assertion operator (!).
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Allows the assignment of values of type 'any' to variables.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // Allows the use of variables before they are defined in the code.
      '@typescript-eslint/no-use-before-define': 'off',
      // Allows the use of the empty object type ({}).
      '@typescript-eslint/no-empty-object-type': 'off',
      // Allows the use of the Array() constructor instead of [] literals.
      '@typescript-eslint/no-array-constructor': 'off',
      // Allows the use of Promises in places where boolean values are expected (ex: if).
      '@typescript-eslint/no-misused-promises': 'off',
      // Allows warning comments such as TODO or FIXME.
      '@typescript-eslint/no-warning-comments': 'off',
      // Allows empty functions.
      '@typescript-eslint/no-empty-function': 'off',
      // Allows returning values of type 'any' in functions.
      '@typescript-eslint/no-unsafe-return': 'off',
      // Allows the use of 'require' for importing modules.
      '@typescript-eslint/no-var-requires': 'off',
      // Allows function calls of type 'any'.
      '@typescript-eslint/no-unsafe-call': 'off',
      // Allows the use of 'namespace' from TypeScript.
      '@typescript-eslint/no-namespace': 'off',
      // Does not require explicit return types in exported functions.
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Requires all functions to have an explicit return type.
      '@typescript-eslint/explicit-function-return-type': 'error',
      // Does not require specific consistency between the use of 'interface' or 'type'.
      '@typescript-eslint/consistent-type-definitions': 'off',
      // Allows 'async' functions that do not have the 'await' keyword.
      '@typescript-eslint/require-await': 'off',
      // Does not prohibit the use of specific types (such as Object or String).
      '@typescript-eslint/ban-types': 'off',
      // Does not require the use of camelCase for identifiers.
      '@typescript-eslint/camelcase': 'off',
      // Requires consistent use of 'import type' for type imports.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {prefer: 'type-imports', fixStyle: 'inline-type-imports'},
      ],
      // It prohibits unused variables, allowing them only if the name begins with '_'.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'},
      ],
      // Integrates Prettier with ESLint to report formatting errors.
      'prettier/prettier': [
        'error',
        {bracketSpacing: false, singleQuote: true, trailingComma: 'es5', arrowParens: 'avoid', printWidth: 120},
      ],
      // Disables several rules from the 'eslint-plugin-n' (Node.js) plugin that are not necessary in this context.
      'n/no-extraneous-import': 'off',
      // Disables the rule that prohibits importing modules that are not declared as dependencies.
      'n/no-missing-import': 'off',
      // Disables the rule that prohibits empty functions.
      'n/no-empty-function': 'off',
      // Disables the rule that prohibits using ES syntax that is not supported in the target environment.
      'n/no-unsupported-features/es-syntax': 'off',
      // Disables the rule that prohibits importing modules that are not declared as dependencies.
      'n/no-missing-require': 'off',
      // Disables the rule that prohibits using shebang.
      'n/shebang': 'off',
      // It prohibits the use of '.only' in tests (it.only or describe.only) to avoid ignoring other tests.
      'no-restricted-properties': [
        'error',
        {object: 'describe', property: 'only'},
        {object: 'it', property: 'only'},
        {object: 'test', property: 'only'},
      ],
      // It prohibits the use of unnecessary ternary operators.
      'no-unneeded-ternary': 'error',
      // It prohibits trailing spaces at the end of lines.
      'no-trailing-spaces': 'error',
      // It allows class members with the same name (delegated to TypeScript).
      'no-dupe-class-members': 'off',
      // It prohibits the use of 'var', requiring 'let' or 'const'.
      'no-var': 'error',
      // It allows sparse arrays (ex: [1, , 2]).
      'no-sparse-arrays': 'off',
      // It treats variables declared with 'var' as if they had block scope.
      'block-scoped-var': 'error',
      // It requires the use of 'const' for variables that are never reassigned.
      'prefer-const': 'error',
      // It requires a blank line at the end of each file.
      'eol-last': 'error',
      // It recommends the use of arrow functions as callbacks.
      'prefer-arrow-callback': ['error', {allowNamedFunctions: true}],
      // It disables the check for atomic updates (avoids false positives in complex operations).
      'require-atomic-updates': 'off',
      // It requires the use of braces {} in all control structures (if, for, while, etc.).
      curly: ['error', 'all'],
      // It requires the use of strict equality (=== and !==).
      eqeqeq: 'error',
      // It requires the use of single quotes, allowing double quotes only to avoid escapes.
      quotes: ['error', 'single', {avoidEscape: true}],
    },
  },

  // Vitest
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    plugins: {vitest},
    rules: {
      ...vitest.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
    languageOptions: {
      globals: globals.es2021,
    },
  },
]);
