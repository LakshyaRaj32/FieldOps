/**
 * Parsing and validation of build-time environment configuration.
 *
 * This module is pure (no native imports) so it can be unit-tested. The raw values come
 * from react-native-config in ./index.ts.
 *
 * Environment configuration is NOT a security boundary: every value is compiled into the
 * APK and readable by anyone. Only public settings belong here, never secrets.
 */

export const APP_ENVIRONMENTS = [
  'development',
  'staging',
  'production',
] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export interface AppConfig {
  readonly environment: AppEnvironment;
  /** API origin without a trailing slash, e.g. `https://api.staging.example.com`. */
  readonly apiBaseUrl: string;
  readonly apiTimeoutMs: number;
}

export interface RawEnv {
  readonly APP_ENV?: string | undefined;
  readonly API_BASE_URL?: string | undefined;
  readonly API_TIMEOUT_MS?: string | undefined;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: AppConfig }
  | { readonly ok: false; readonly errors: readonly string[] };

export const DEFAULT_API_TIMEOUT_MS = 15_000;
const MIN_API_TIMEOUT_MS = 1_000;
const MAX_API_TIMEOUT_MS = 120_000;

/**
 * Accepts http(s) origins with an optional port and path. Written as a regex on purpose:
 * React Native's built-in URL implementation does not support reading `protocol`/`hostname`.
 */
const HTTP_URL_PATTERN = /^(https?):\/\/[^\s/?#:]+(:\d{1,5})?(\/[^\s?#]*)?$/i;

function isAppEnvironment(value: string): value is AppEnvironment {
  return (APP_ENVIRONMENTS as readonly string[]).includes(value);
}

export function parseEnv(raw: RawEnv): ConfigResult {
  const errors: string[] = [];

  const environmentValue = raw.APP_ENV?.trim() ?? '';
  let environment: AppEnvironment | undefined;
  if (environmentValue === '') {
    errors.push('APP_ENV is missing.');
  } else if (isAppEnvironment(environmentValue)) {
    environment = environmentValue;
  } else {
    errors.push(
      `APP_ENV must be one of ${APP_ENVIRONMENTS.join(
        ', ',
      )} (received "${environmentValue}").`,
    );
  }

  const urlValue = raw.API_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
  const urlMatch = HTTP_URL_PATTERN.exec(urlValue);
  if (urlValue === '') {
    errors.push('API_BASE_URL is missing.');
  } else if (urlMatch === null) {
    errors.push(
      `API_BASE_URL must be an http(s) URL (received "${urlValue}").`,
    );
  } else if (
    environment !== undefined &&
    environment !== 'development' &&
    urlMatch[1]?.toLowerCase() !== 'https'
  ) {
    errors.push(
      `API_BASE_URL must use https in the ${environment} environment.`,
    );
  }

  let apiTimeoutMs = DEFAULT_API_TIMEOUT_MS;
  const timeoutValue = raw.API_TIMEOUT_MS?.trim() ?? '';
  if (timeoutValue !== '') {
    const parsed = Number(timeoutValue);
    if (
      Number.isInteger(parsed) &&
      parsed >= MIN_API_TIMEOUT_MS &&
      parsed <= MAX_API_TIMEOUT_MS
    ) {
      apiTimeoutMs = parsed;
    } else {
      errors.push(
        `API_TIMEOUT_MS must be an integer between ${MIN_API_TIMEOUT_MS} and ${MAX_API_TIMEOUT_MS} (received "${timeoutValue}").`,
      );
    }
  }

  if (errors.length > 0 || environment === undefined) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    config: { environment, apiBaseUrl: urlValue, apiTimeoutMs },
  };
}
