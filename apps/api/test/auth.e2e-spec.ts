import { JwtService } from '@nestjs/jwt';
import type { AuthResult, AuthTokens } from '@fieldops/types';

import {
  ACCESS_TOKEN_AUDIENCE,
  TOKEN_ISSUER,
} from '../src/auth/types/jwt-payload.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './helpers/test-app.js';

const PASSWORD = 'correct horse battery staple';

const registration = (overrides: Record<string, unknown> = {}) => ({
  email: 'asha.verma@example.com',
  password: PASSWORD,
  firstName: 'Asha',
  lastName: 'Verma',
  ...overrides,
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Authentication (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  async function register(
    overrides: Record<string, unknown> = {},
  ): Promise<AuthResult> {
    const response = await t
      .http()
      .post('/api/v1/auth/register')
      .send(registration(overrides));
    expect(response.status).toBe(201);
    return (response.body as { data: AuthResult }).data;
  }

  async function login(email = 'asha.verma@example.com'): Promise<AuthResult> {
    const response = await t
      .http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(response.status).toBe(200);
    return (response.body as { data: AuthResult }).data;
  }

  async function refresh(refreshToken: string) {
    return t.http().post('/api/v1/auth/refresh').send({ refreshToken });
  }

  describe('POST /api/v1/auth/register', () => {
    it('creates a WORKER account and returns the user with a token pair', async () => {
      const response = await t
        .http()
        .post('/api/v1/auth/register')
        .send(registration());

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        success: true,
        data: {
          user: {
            id: expect.any(String),
            email: 'asha.verma@example.com',
            firstName: 'Asha',
            lastName: 'Verma',
            role: 'WORKER',
            isActive: true,
          },
          tokens: {
            tokenType: 'Bearer',
            accessToken: expect.any(String),
            refreshToken: expect.any(String),
          },
        },
      });
      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|argon2/);
    });

    it('stores an Argon2id hash, never the password', async () => {
      const { user } = await register();

      const row = await t.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.passwordHash).toMatch(/^\$argon2id\$/);
      expect(row.passwordHash).not.toContain(PASSWORD);
    });

    it('rejects a duplicate email, case-insensitively (409)', async () => {
      await register();

      const response = await t
        .http()
        .post('/api/v1/auth/register')
        .send(registration({ email: '  ASHA.Verma@Example.com ' }));

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account with this email already exists.',
          requestId: expect.any(String),
        },
      });
      expect(await t.prisma.user.count()).toBe(1);
    });

    it('reports every invalid field and never echoes the password', async () => {
      const response = await t.http().post('/api/v1/auth/register').send({
        email: 'not-an-email',
        password: 'short',
        firstName: '  ',
        lastName: 'V',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      const fields = (response.body.error.details as { field: string }[]).map(
        d => d.field,
      );
      expect(fields).toEqual(
        expect.arrayContaining(['email', 'password', 'firstName']),
      );
      expect(JSON.stringify(response.body)).not.toContain('"short"');
    });

    it('rejects attempts to choose a role (unknown fields are refused)', async () => {
      const response = await t
        .http()
        .post('/api/v1/auth/register')
        .send(registration({ role: 'ADMIN' }));

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(await t.prisma.user.count()).toBe(0);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await register();
    });

    it('issues an access token and a refresh token for a new session', async () => {
      const { user, tokens } = await login('Asha.Verma@example.com');

      const claims = new JwtService().decode<Record<string, unknown>>(
        tokens.accessToken,
      );
      expect(claims).toMatchObject({
        sub: user.id,
        role: 'WORKER',
        sid: expect.any(String),
      });
      // No personal data in the token.
      expect(JSON.stringify(claims)).not.toContain('asha');
      expect(new Date(tokens.accessTokenExpiresAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
      expect(new Date(tokens.refreshTokenExpiresAt).getTime()).toBeGreaterThan(
        new Date(tokens.accessTokenExpiresAt).getTime(),
      );
      // Registration created one session, login a second one (another device).
      expect(await t.prisma.session.count({ where: { userId: user.id } })).toBe(
        2,
      );
    });

    it('stores only a hash of the refresh token', async () => {
      const { tokens } = await login();
      const sessions = await t.prisma.session.findMany();

      for (const session of sessions) {
        expect(session.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect(session.refreshTokenHash).not.toBe(tokens.refreshToken);
      }
    });

    it.each([
      ['a wrong password', 'asha.verma@example.com', 'wrong password!!'],
      ['an unknown email', 'nobody@example.com', PASSWORD],
    ])(
      'fails with the same error for %s (401 INVALID_CREDENTIALS)',
      async (_case, email, password) => {
        const response = await t
          .http()
          .post('/api/v1/auth/login')
          .send({ email, password });

        expect(response.status).toBe(401);
        expect(response.body.error).toMatchObject({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
        });
      },
    );

    it('refuses a disabled account once the password is correct (403)', async () => {
      await t.prisma.user.updateMany({ data: { isActive: false } });

      const response = await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'asha.verma@example.com', password: PASSWORD });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('GET /api/v1/auth/me (protected endpoint)', () => {
    it('returns the current user for a valid access token', async () => {
      const { user, tokens } = await register();

      const response = await t
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(tokens.accessToken));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, data: user });
    });

    it('rejects a request without a token (401 UNAUTHENTICATED)', async () => {
      const response = await t.http().get('/api/v1/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a malformed token (401 ACCESS_TOKEN_INVALID)', async () => {
      const response = await t
        .http()
        .get('/api/v1/auth/me')
        .set(bearer('garbage'));

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('ACCESS_TOKEN_INVALID');
    });

    it('rejects an expired access token (401 ACCESS_TOKEN_EXPIRED)', async () => {
      const { user, tokens } = await register();
      const { sid } = new JwtService().decode<{ sid: string }>(
        tokens.accessToken,
      );
      const expired = new JwtService().sign(
        {
          sub: user.id,
          sid,
          role: user.role,
          exp: Math.floor(Date.now() / 1000) - 60,
        },
        {
          secret: t.config.auth.accessTokenSecret,
          issuer: TOKEN_ISSUER,
          audience: ACCESS_TOKEN_AUDIENCE,
        },
      );

      const response = await t
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(expired));

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('ACCESS_TOKEN_EXPIRED');
    });

    it('rejects a refresh token used as an access token', async () => {
      const { tokens } = await register();

      const response = await t
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(tokens.refreshToken));

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('ACCESS_TOKEN_INVALID');
    });

    it('rejects the token of a disabled account immediately', async () => {
      const { tokens } = await register();
      await t.prisma.user.updateMany({ data: { isActive: false } });

      const response = await t
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(tokens.accessToken));

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('issues a new access token that authenticates requests', async () => {
      const { tokens } = await register();

      const response = await refresh(tokens.refreshToken);

      expect(response.status).toBe(200);
      const next = (response.body as { data: AuthTokens }).data;
      expect(next.tokenType).toBe('Bearer');
      // Within the same second the claims (and so the token) can be identical; what matters
      // is that the new token is valid at least as long as the old one and authenticates.
      expect(
        new Date(next.accessTokenExpiresAt).getTime(),
      ).toBeGreaterThanOrEqual(new Date(tokens.accessTokenExpiresAt).getTime());
      const me = await t
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(next.accessToken));
      expect(me.status).toBe(200);
    });

    it('rotates the refresh token: the new one works, and the session row is updated', async () => {
      const { tokens } = await register();
      const before = await t.prisma.session.findFirstOrThrow();

      const first = (await refresh(tokens.refreshToken)).body
        .data as AuthTokens;
      expect(first.refreshToken).not.toBe(tokens.refreshToken);

      const after = await t.prisma.session.findFirstOrThrow();
      expect(after.id).toBe(before.id);
      expect(after.refreshTokenHash).not.toBe(before.refreshTokenHash);
      expect(after.lastUsedAt.getTime()).toBeGreaterThanOrEqual(
        before.lastUsedAt.getTime(),
      );

      const second = await refresh(first.refreshToken);
      expect(second.status).toBe(200);
    });

    it('detects reuse of a rotated token and revokes the whole session', async () => {
      const { tokens } = await register();
      const rotated = (await refresh(tokens.refreshToken)).body
        .data as AuthTokens;

      // An attacker replays the old token.
      const replay = await refresh(tokens.refreshToken);
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

      const session = await t.prisma.session.findFirstOrThrow();
      expect(session.revokedAt).not.toBeNull();
      expect(session.revokedReason).toBe('REFRESH_TOKEN_REUSE');

      // Every token of the session is now dead, including the legitimate latest pair.
      const legitimate = await refresh(rotated.refreshToken);
      expect(legitimate.body.error.code).toBe('SESSION_REVOKED');
      const me = await t
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(rotated.accessToken));
      expect(me.status).toBe(401);
      expect(me.body.error.code).toBe('SESSION_REVOKED');
    });

    it('lets only one of two concurrent refreshes with the same token succeed', async () => {
      const { tokens } = await register();

      const results = await Promise.all([
        refresh(tokens.refreshToken),
        refresh(tokens.refreshToken),
      ]);

      const statuses = results.map(r => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([200, 401]);
      expect(results.find(r => r.status === 401)?.body.error.code).toBe(
        'REFRESH_TOKEN_REUSED',
      );
    });

    it('rejects a forged or malformed refresh token', async () => {
      const { tokens } = await register();

      const tampered = await refresh(`${tokens.refreshToken.slice(0, -2)}xx`);
      expect(tampered.status).toBe(401);
      expect(tampered.body.error.code).toBe('REFRESH_TOKEN_INVALID');

      const accessAsRefresh = await refresh(tokens.accessToken);
      expect(accessAsRefresh.body.error.code).toBe('REFRESH_TOKEN_INVALID');

      const malformed = await refresh('not-a-jwt');
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a refresh token whose session has expired', async () => {
      const { tokens } = await register();
      await t.prisma.session.updateMany({
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const response = await refresh(tokens.refreshToken);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('SESSION_EXPIRED');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes the current session: its tokens stop working', async () => {
      const { tokens } = await register();

      const response = await t
        .http()
        .post('/api/v1/auth/logout')
        .set(bearer(tokens.accessToken));
      expect(response.status).toBe(204);
      expect(response.text).toBe('');

      const session = await t.prisma.session.findFirstOrThrow();
      expect(session.revokedReason).toBe('LOGOUT');

      const me = await t
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(tokens.accessToken));
      expect(me.body.error.code).toBe('SESSION_REVOKED');
      const refreshed = await refresh(tokens.refreshToken);
      expect(refreshed.status).toBe(401);
      expect(refreshed.body.error.code).toBe('SESSION_REVOKED');
    });

    it('signs out only this device; other sessions keep working', async () => {
      const phone = await register();
      const tablet = await login();

      await t
        .http()
        .post('/api/v1/auth/logout')
        .set(bearer(phone.tokens.accessToken));

      const me = await t
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(tablet.tokens.accessToken));
      expect(me.status).toBe(200);
      expect((await refresh(tablet.tokens.refreshToken)).status).toBe(200);
    });

    it('requires authentication', async () => {
      const response = await t.http().post('/api/v1/auth/logout');
      expect(response.status).toBe(401);
    });
  });

  describe('role-based authorization (GET /api/v1/users, ADMIN only)', () => {
    it('forbids a WORKER (403) and rejects anonymous callers (401)', async () => {
      const { tokens } = await register();

      const worker = await t
        .http()
        .get('/api/v1/users')
        .set(bearer(tokens.accessToken));
      expect(worker.status).toBe(403);
      expect(worker.body.error.code).toBe('FORBIDDEN');

      const anonymous = await t.http().get('/api/v1/users');
      expect(anonymous.status).toBe(401);
    });

    it('allows an ADMIN, using the current role from the database', async () => {
      const { user, tokens } = await register();
      await t.prisma.user.update({
        where: { id: user.id },
        data: { role: 'ADMIN' },
      });

      // Same access token (it still says WORKER): the role is read from the database.
      const response = await t
        .http()
        .get('/api/v1/users')
        .set(bearer(tokens.accessToken));

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([
        expect.objectContaining({ id: user.id, role: 'ADMIN' }),
      ]);
    });

    it('validates query parameters', async () => {
      const { user, tokens } = await register();
      await t.prisma.user.update({
        where: { id: user.id },
        data: { role: 'ADMIN' },
      });

      const response = await t
        .http()
        .get('/api/v1/users?limit=1000')
        .set(bearer(tokens.accessToken));

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
