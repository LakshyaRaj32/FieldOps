import { parseAppConfig, type RawEnvironment } from './app-config.js';

const ACCESS_SECRET = 'a'.repeat(40);
const REFRESH_SECRET = 'b'.repeat(40);

const VALID: RawEnvironment = {
  APP_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgresql://fieldops:fieldops@localhost:5432/fieldops_dev',
  JWT_ACCESS_SECRET: ACCESS_SECRET,
  JWT_REFRESH_SECRET: REFRESH_SECRET,
  ACCESS_TOKEN_EXPIRATION: '15m',
  REFRESH_TOKEN_EXPIRATION: '30d',
};

function errorOf(env: RawEnvironment): string {
  try {
    parseAppConfig(env);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('Expected parseAppConfig to throw');
}

describe('parseAppConfig', () => {
  it('parses a valid development configuration with defaults', () => {
    const config = parseAppConfig(VALID);

    expect(config).toMatchObject({
      environment: 'development',
      host: '0.0.0.0',
      port: 3000,
      corsOrigins: [],
      swaggerEnabled: true,
      auth: { accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 2_592_000 },
    });
  });

  it('defaults evidence storage to ./storage and leaves push disabled', () => {
    const config = parseAppConfig(VALID);
    expect(config.storageDir).toBe('./storage');
    expect(config.fcmServiceAccountFile).toBeUndefined();
  });

  it('reads the FCM service-account path and refuses a non-JSON file', () => {
    expect(
      parseAppConfig({ ...VALID, FCM_SERVICE_ACCOUNT_FILE: './fcm.json' })
        .fcmServiceAccountFile,
    ).toBe('./fcm.json');
    expect(
      errorOf({ ...VALID, FCM_SERVICE_ACCOUNT_FILE: './fcm.pem' }),
    ).toContain('FCM_SERVICE_ACCOUNT_FILE');
  });

  it('uses the PORT supplied by the platform', () => {
    expect(parseAppConfig({ ...VALID, PORT: '10000' }).port).toBe(10_000);
  });

  it('disables Swagger in production unless explicitly enabled', () => {
    expect(
      parseAppConfig({ ...VALID, APP_ENV: 'production' }).swaggerEnabled,
    ).toBe(false);
    expect(
      parseAppConfig({
        ...VALID,
        APP_ENV: 'production',
        SWAGGER_ENABLED: 'true',
      }).swaggerEnabled,
    ).toBe(true);
  });

  it('parses CORS origins and strips trailing slashes', () => {
    const config = parseAppConfig({
      ...VALID,
      CORS_ORIGINS: 'https://admin.example.com/, http://localhost:5173',
    });
    expect(config.corsOrigins).toEqual([
      'https://admin.example.com',
      'http://localhost:5173',
    ]);
  });

  it('reports every problem at once', () => {
    const message = errorOf({ APP_ENV: 'qa', PORT: 'abc' });

    expect(message).toContain('APP_ENV must be one of');
    expect(message).toContain('PORT must be an integer');
    expect(message).toContain('DATABASE_URL is missing');
    expect(message).toContain('JWT_ACCESS_SECRET is missing');
    expect(message).toContain('JWT_REFRESH_SECRET is missing');
  });

  it('rejects short secrets without printing them', () => {
    const message = errorOf({ ...VALID, JWT_ACCESS_SECRET: 'short-secret' });

    expect(message).toContain(
      'JWT_ACCESS_SECRET must be at least 32 characters',
    );
    expect(message).not.toContain('short-secret');
  });

  it('rejects identical access and refresh secrets', () => {
    expect(errorOf({ ...VALID, JWT_REFRESH_SECRET: ACCESS_SECRET })).toContain(
      'must be different',
    );
  });

  it('rejects placeholder secrets outside development', () => {
    const placeholder = 'replace-me-with-a-random-access-token-secret';
    expect(() =>
      parseAppConfig({ ...VALID, JWT_ACCESS_SECRET: placeholder }),
    ).not.toThrow();
    expect(
      errorOf({ ...VALID, APP_ENV: 'staging', JWT_ACCESS_SECRET: placeholder }),
    ).toContain('placeholder');
  });

  it('rejects an access token lifetime that is not shorter than the refresh lifetime', () => {
    expect(errorOf({ ...VALID, ACCESS_TOKEN_EXPIRATION: '30d' })).toContain(
      'must be shorter',
    );
  });

  it('rejects invalid durations and wildcard CORS', () => {
    const message = errorOf({
      ...VALID,
      REFRESH_TOKEN_EXPIRATION: 'forever',
      CORS_ORIGINS: '*',
    });
    expect(message).toContain('REFRESH_TOKEN_EXPIRATION must be a duration');
    expect(message).toContain('not "*"');
  });

  it('runs without Redis, with rate limiting on and no trusted proxy by default', () => {
    const config = parseAppConfig(VALID);

    expect(config.redis).toEqual({ url: undefined, keyPrefix: 'fieldops:' });
    expect(config.rateLimit.enabled).toBe(true);
    expect(config.rateLimit.policies.auth).toMatchObject({
      algorithm: 'sliding-window',
      limit: 20,
      windowMs: 300_000,
    });
    expect(config.trustProxyHops).toBe(0);
  });

  it('reads Redis, rate-limit overrides and the proxy count', () => {
    const config = parseAppConfig({
      ...VALID,
      REDIS_URL: 'rediss://default:secret@cache.example.com:6380',
      REDIS_KEY_PREFIX: 'staging:',
      RATE_LIMIT_ENABLED: 'false',
      RATE_LIMIT_AUTH: '5/1m',
      TRUST_PROXY: '1',
    });

    expect(config.redis).toEqual({
      url: 'rediss://default:secret@cache.example.com:6380',
      keyPrefix: 'staging:',
    });
    expect(config.rateLimit.enabled).toBe(false);
    expect(config.rateLimit.policies.auth).toMatchObject({
      algorithm: 'sliding-window',
      limit: 5,
      windowMs: 60_000,
    });
    expect(config.rateLimit.policies.default.limit).toBe(120);
    expect(config.trustProxyHops).toBe(1);
  });

  it('rejects invalid Redis, rate-limit and proxy settings without echoing secrets', () => {
    const message = errorOf({
      ...VALID,
      REDIS_URL: 'http://user:hunter2@cache',
      RATE_LIMIT_ENABLED: 'yes',
      RATE_LIMIT_UPLOAD: '0/1m',
      RATE_LIMIT_REFRESH: 'lots',
      TRUST_PROXY: 'true',
    });

    expect(message).toContain('REDIS_URL must be a redis:// or rediss:// URL.');
    expect(message).not.toContain('hunter2');
    expect(message).toContain('RATE_LIMIT_ENABLED must be true or false');
    expect(message).toContain(
      'RATE_LIMIT_UPLOAD must be <requests>/<duration>',
    );
    expect(message).toContain(
      'RATE_LIMIT_REFRESH must be <requests>/<duration>',
    );
    expect(message).toContain('TRUST_PROXY must be the number of proxies');
  });

  it('runs workers with a 5 s first retry by default, and reads the overrides', () => {
    expect(parseAppConfig(VALID).queue).toEqual({
      workersEnabled: true,
      retryDelayMs: 5_000,
    });
    expect(
      parseAppConfig({
        ...VALID,
        WORKERS_ENABLED: 'false',
        QUEUE_RETRY_DELAY: '30s',
      }).queue,
    ).toEqual({ workersEnabled: false, retryDelayMs: 30_000 });
    expect(errorOf({ ...VALID, WORKERS_ENABLED: 'no' })).toContain(
      'WORKERS_ENABLED must be true or false',
    );
  });
});
