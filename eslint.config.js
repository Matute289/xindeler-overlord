// @ts-check
const expoConfig = require('eslint-config-expo/flat');
const eslintConfigPrettier = require('eslint-config-prettier');

// Disable import resolver issues for now - will be addressed in follow-up
const configWithoutImportResolver = expoConfig.map((config) => {
  if (config.rules && config.rules['import/no-unresolved']) {
    return {
      ...config,
      rules: {
        ...config.rules,
        'import/no-unresolved': 'off',
        'import/namespace': 'off',
        'import/no-duplicates': 'off',
      },
    };
  }
  return config;
});

module.exports = [
  ...configWithoutImportResolver,
  eslintConfigPrettier,
  {
    ignores: ['dist/*', '.expo/*', 'ios/*', 'android/*'],
  },
];
