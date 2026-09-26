/**
 * Typed, validated application configuration.
 *
 * All configuration comes from environment variables and is validated once at startup
 * (docs/backend-architecture.md, "Configuration and secrets"). The process refuses to start
 * with missing or invalid values, and the error lists every problem at once. Secret values
 * are never included in error messages.
 */

import { parseDurationSeconds } from './duration.js';

export const APP_ENVIRONMENTS = [
  'development',
  'staging',
  'production',
] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export interface AuthConfig {
  readonly accessTokenSecret: string;
  readonly refreshTokenSecret: string;
  readonly accessTokenTtlSeconds: number;
  /** Session lifetime; sliding, extended on every successful refresh. */
  readonly refreshTokenTtlSeconds: number;
}

export interface AppConfig {
  readonly environment: AppEnvironment;
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly auth: AuthConfig;
  /** Browser origins allowed by CORS. Empty means CORS is disabled. */
  readonly corsOrigins: readonly string[];
  readonly swaggerEnabled: boolean;
}

/** Injection token for AppConfig. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export type RawEnvironment = Readonly<Record<string, string | undefined>>;

const MIN_SECRET_LENGTH = 32;
const PLACEHOLDER_MARKER = 'replace-me';
const ORIGIN_PATTERN = /^https?:\/\/[^\s/?#]+$/i;

function isAppEnvironment(value: string): value is AppEnvironment {
  return (APP_ENVIRONMENTS as readonly string[]).includes(value);
}

export function parseAppConfig(env: RawEnvironment): AppConfig {
  const errors: string[] = [];
  const read = (name: string): string => env[name]?.trim() ?? '';

  const environmentValue = read('APP_ENV') || 'development';
  let environment: AppEnvironment = 'development';
  if (isAppEnvironment(environmentValue)) {
    environment = environmentValue;
  } else {
    errors.push(
      `APP_ENV must be one of ${APP_ENVIRONMENTS.join(', ')} (received "${environmentValue}").`,
    );
  }
  const deployed = environment !== 'development';

  const host = read('HOST') || '0.0.0.0';

  const portValue = read('PORT') || '3000';
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    errors.push(
      `PORT must be an integer between 1 and 65535 (received "${portValue}").`,
    );
  }

  const databaseUrl = read('DATABASE_URL');
  if (databaseUrl === '') {
    errors.push('DATABASE_URL is missing.');
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL must be a postgresql:// connection string.');
  }

  const secret = (name: string): string => {
    const value = read(name);
    if (value === '') {
      errors.push(`${name} is missing.`);
    } else if (value.length < MIN_SECRET_LENGTH) {
      errors.push(
        `${name} must be at least ${MIN_SECRET_LENGTH} characters long.`,
      );
    } else if (deployed && value.includes(PLACEHOLDER_MARKER)) {
      errors.push(
        `${name} still has its placeholder value; set a random secret for ${environment}.`,
      );
    }
    return value;
  };
  const accessTokenSecret = secret('JWT_ACCESS_SECRET');
  const refreshTokenSecret = secret('JWT_REFRESH_SECRET');
  if (accessTokenSecret !== '' && accessTokenSecret === refreshTokenSecret) {
    errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.');
  }

  const duration = (name: string, fallback: string): number => {
    const value = read(name) || fallback;
    const seconds = parseDurationSeconds(value);
    if (seconds === undefined) {
      errors.push(
        `${name} must be a duration such as 15m, 12h or 30d (received "${value}").`,
      );
      return 0;
    }
    return seconds;
  };
  const accessTokenTtlSeconds = duration('ACCESS_TOKEN_EXPIRATION', '15m');
  const refreshTokenTtlSeconds = duration('REFRESH_TOKEN_EXPIRATION', '30d');
  if (
    accessTokenTtlSeconds > 0 &&
    refreshTokenTtlSeconds > 0 &&
    accessTokenTtlSeconds >= refreshTokenTtlSeconds
  ) {
    errors.push(
      'ACCESS_TOKEN_EXPIRATION must be shorter than REFRESH_TOKEN_EXPIRATION.',
    );
  }

  const corsOrigins = read('CORS_ORIGINS')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(origin => origin !== '');
  for (const origin of corsOrigins) {
    if (origin === '*') {
      errors.push('CORS_ORIGINS must list explicit origins, not "*".');
    } else if (!ORIGIN_PATTERN.test(origin)) {
      errors.push(
        `CORS_ORIGINS entry "${origin}" must be an origin like https://app.example.com.`,
      );
    }
  }

  const swaggerValue = read('SWAGGER_ENABLED').toLowerCase();
  let swaggerEnabled = environment !== 'production';
  if (swaggerValue === 'true') {
    swaggerEnabled = true;
  } else if (swaggerValue === 'false') {
    swaggerEnabled = false;
  } else if (swaggerValue !== '') {
    errors.push(
      `SWAGGER_ENABLED must be true or false (received "${swaggerValue}").`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid configuration:\n${errors.map(error => `  - ${error}`).join('\n')}`,
    );
  }

  return {
    environment,
    host,
    port,
    databaseUrl,
    auth: {
      accessTokenSecret,
      refreshTokenSecret,
      accessTokenTtlSeconds,
      refreshTokenTtlSeconds,
    },
    corsOrigins,
    swaggerEnabled,
  };
}
