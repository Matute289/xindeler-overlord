// @ts-check
const expoConfig = require('eslint-config-expo/flat');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  ...expoConfig,
  eslintConfigPrettier,
  {
    ignores: ['dist/*', '.expo/*', 'ios/*', 'android/*'],
  },
  {
    // Workaround for eslint-import-resolver-typescript@3.10.1 compatibility with TypeScript 6.0.3
    // The resolver fails to initialize with "typescript with invalid interface loaded as resolver" error
    // when processing path aliases (@/* imports). This scoped override disables the two problematic rules
    // only for app/ files, allowing the new tab screens to lint cleanly.
    //
    // Affected rules: 'import/no-unresolved', 'import/namespace'
    // (Note: 'import/no-duplicates' was not disabled as it's set to 'warn' severity, not 'error',
    //  so it does not cause lint to fail.)
    //
    // Compensating check: TypeScript's tsc --noEmit catches unresolved path aliases and most import errors.
    // Revisit when eslint-import-resolver-typescript ships a fix for TypeScript 6.x.
    files: ['app/**/*.tsx', 'app/**/*.ts'],
    rules: {
      'import/no-unresolved': 'off',
      'import/namespace': 'off',
    },
  },
];
