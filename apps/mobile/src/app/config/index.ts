import Config from 'react-native-config';

import { parseEnv, type AppConfig, type ConfigResult } from './env';

export type { AppConfig, AppEnvironment } from './env';

/** Parsed once at startup. App.tsx renders a configuration error screen when invalid. */
export const configResult: ConfigResult = parseEnv(Config);

/**
 * Returns the validated configuration. Only call this from code that runs after App.tsx
 * has confirmed the configuration is valid (screens, API requests).
 */
export function getConfig(): AppConfig {
  if (!configResult.ok) {
    throw new Error(
      `Invalid app configuration: ${configResult.errors.join(' ')}`,
    );
  }
  return configResult.config;
}
