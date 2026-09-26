import { DEFAULT_API_TIMEOUT_MS, parseEnv } from './env';

describe('parseEnv', () => {
  it('accepts a valid development configuration', () => {
    expect(
      parseEnv({
        APP_ENV: 'development',
        API_BASE_URL: 'http://localhost:3000',
        API_TIMEOUT_MS: '10000',
      }),
    ).toEqual({
      ok: true,
      config: {
        environment: 'development',
        apiBaseUrl: 'http://localhost:3000',
        apiTimeoutMs: 10000,
      },
    });
  });

  it('removes trailing slashes and surrounding whitespace from the API URL', () => {
    const result = parseEnv({
      APP_ENV: 'staging',
      API_BASE_URL: '  https://api.staging.example.com/// ',
    });
    expect(result.ok && result.config.apiBaseUrl).toBe(
      'https://api.staging.example.com',
    );
  });

  it('uses the default timeout when none is configured', () => {
    const result = parseEnv({
      APP_ENV: 'production',
      API_BASE_URL: 'https://api.example.com',
    });
    expect(result.ok && result.config.apiTimeoutMs).toBe(
      DEFAULT_API_TIMEOUT_MS,
    );
  });

  it('requires https outside development', () => {
    for (const environment of ['staging', 'production']) {
      const result = parseEnv({
        APP_ENV: environment,
        API_BASE_URL: 'http://api.example.com',
      });
      expect(result).toEqual({
        ok: false,
        errors: [
          `API_BASE_URL must use https in the ${environment} environment.`,
        ],
      });
    }
  });

  it('allows plain http in development (local API through adb reverse)', () => {
    expect(
      parseEnv({
        APP_ENV: 'development',
        API_BASE_URL: 'http://192.168.1.20:3000',
      }).ok,
    ).toBe(true);
  });

  it('reports every problem at once instead of stopping at the first', () => {
    const result = parseEnv({ API_TIMEOUT_MS: '50' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toHaveLength(3);
  });

  it.each([
    [
      'unknown environment',
      { APP_ENV: 'qa', API_BASE_URL: 'https://a.example.com' },
    ],
    ['missing URL', { APP_ENV: 'development' }],
    [
      'non-http URL',
      { APP_ENV: 'development', API_BASE_URL: 'ftp://example.com' },
    ],
    [
      'URL with spaces',
      { APP_ENV: 'development', API_BASE_URL: 'http://local host' },
    ],
    [
      'non-integer timeout',
      {
        APP_ENV: 'development',
        API_BASE_URL: 'http://localhost',
        API_TIMEOUT_MS: '1.5',
      },
    ],
    [
      'timeout above the limit',
      {
        APP_ENV: 'development',
        API_BASE_URL: 'http://localhost',
        API_TIMEOUT_MS: '999999',
      },
    ],
  ])('rejects %s', (_description, raw) => {
    expect(parseEnv(raw).ok).toBe(false);
  });
});
