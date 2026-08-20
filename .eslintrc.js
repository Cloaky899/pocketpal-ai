module.exports = {
  root: true,
  extends: ['@react-native', 'plugin:prettier/recommended'],
  ignorePatterns: [
    'coverage/',
    'node_modules/',
    'android/',
    'ios/',
    'build/',
    'dist/',
    'src/visualization/inAppRendererHtml.ts',
    'inapp-renderer/vendor/',
  ],
  rules: {
    'prettier/prettier': 'error',
  },
  overrides: [
    {
      files: ['inapp-renderer/runtime.js'],
      env: {browser: true},
    },
  ],
};
