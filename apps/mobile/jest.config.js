/** @type {import('jest').Config} */
module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // @fieldops/shared ships compiled JavaScript for Node; the app (Metro) and its tests use
  // the TypeScript source.
  moduleNameMapper: {
    '^@fieldops/shared$': '<rootDir>/../../packages/shared/src/job-state-machine.ts',
  },
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/android/'],
  // Packages resolved through their "react-native" export condition ship ES modules and must
  // be transformed by Babel (the preset only allow-lists React Native packages).
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@reduxjs/toolkit|immer|redux|reselect|react-redux)/)',
  ],
};
