// @react-native/eslint-config 0.87 bundles eslint-plugin-ft-flow 2.x, which crashes on
// ESLint 9 (it calls the removed context.getAllComments). FieldOps has no Flow code, so the
// Flow block is dropped; every other React Native rule is kept.
const reactNativeConfig = require('@react-native/eslint-config/flat').filter(
  block => !(block.plugins && 'ft-flow' in block.plugins),
);

/**
 * ESLint flat config.
 *
 * Besides the React Native defaults, these rules enforce the architecture's boundaries:
 * infrastructure libraries are only imported by the service that wraps them, so the rest
 * of the app depends on FieldOps abstractions rather than on the libraries directly.
 */
const boundary = (name, allowedIn) => ({
  name,
  message: `Import ${name} only inside ${allowedIn}. Use that module's API instead.`,
});

module.exports = [
  {
    ignores: ['android/**', 'coverage/**', 'node_modules/**'],
  },
  ...reactNativeConfig,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Use the RTK Query API layer in src/services/api instead.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            boundary('react-native-config', 'src/app/config'),
            boundary('@react-native-community/netinfo', 'src/services/network'),
            boundary('react-native-mmkv', 'src/services/storage'),
            boundary('react-native-keychain', 'src/services/storage'),
            boundary('react-native-nitro-sqlite', 'src/services/db'),
            boundary('socket.io-client', 'src/services/realtime'),
            boundary('react-native-image-picker', 'src/services/media'),
            boundary('@react-native-firebase/app', 'src/services/push'),
            boundary('@react-native-firebase/messaging', 'src/services/push'),
          ],
        },
      ],
    },
  },
  // Each boundary's owner may import its library.
  {
    files: ['src/app/config/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: [
      'src/services/network/**',
      'src/services/storage/**',
      'src/services/db/**',
      'src/services/realtime/**',
      'src/services/media/**',
      'src/services/push/**',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['jest.setup.js'],
    languageOptions: { globals: { jest: 'readonly' } },
  },
  // The logger is the only place allowed to write to the console.
  {
    files: ['src/utils/logger.ts'],
    rules: { 'no-console': 'off' },
  },
];
