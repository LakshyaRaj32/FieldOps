const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * Metro configuration for the npm-workspaces monorepo.
 * https://reactnative.dev/docs/metro
 *
 * - Dependencies are hoisted to <repo>/node_modules, so Metro must watch and resolve from there.
 * - Workspace packages (@fieldops/types, ...) live in <repo>/packages and are symlinked into
 *   node_modules; watching the folder lets Metro pick up edits without a restart.
 * - Only these folders are watched (not the whole repo), so apps/api and docs never affect Metro.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [
    path.resolve(workspaceRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'packages'),
  ],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
