// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*'],
  },
  {
    rules: {
      // Plain apostrophes in <Text> are fine in React Native.
      'react/no-unescaped-entities': 'off',
      'react/display-name': 'off',
      // Kicking off a fetch from an effect is intentional here.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);
