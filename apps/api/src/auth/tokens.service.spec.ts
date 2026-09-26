import { JwtService } from '@nestjs/jwt';

import type { AppConfig } from '../config/app-config.js';
import { Role } from '../users/role.js';
import { TokensService } from './tokens.service.js';
import {
  ACCESS_TOKEN_AUDIENCE,
  REFRESH_TOKEN_AUDIENCE,
  TOKEN_ISSUER,
} from './types/jwt-payload.js';

const config = {
  auth: {
    accessTokenSecret: 'access-secret-for-unit-tests-0123456789',
    refreshTokenSecret: 'refresh-secret-for-unit-tests-012345678',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 2_592_000,
  },
} as AppConfig;

const claims = { userId: 'user-1', sessionId: 'session-1' };

describe('TokensService', () => {
  const jwt = new JwtService();
  const tokens = new TokensService(jwt, config);

  describe('access tokens', () => {
    it('carry only sub, sid and role, and expire after the configured lifetime', () => {
      const now = new Date('2026-01-01T00:00:00.000Z');
      const issued = tokens.issueAccessToken(
        { ...claims, role: Role.WORKER },
        now,
      );

      const payload = jwt.verify<Record<string, unknown>>(issued.token, {
        secret: config.auth.accessTokenSecret,
        audience: ACCESS_TOKEN_AUDIENCE,
        issuer: TOKEN_ISSUER,
        ignoreExpiration: true,
      });
      expect(payload).toEqual({
        sub: 'user-1',
        sid: 'session-1',
        role: 'WORKER',
        iat: 1_767_225_600,
        exp: 1_767_225_600 + 900,
        aud: ACCESS_TOKEN_AUDIENCE,
        iss: TOKEN_ISSUER,
      });
      expect(issued.expiresAt.toISOString()).toBe('2026-01-01T00:15:00.000Z');
    });
  });

  describe('refresh tokens', () => {
    const expiresAt = new Date(Date.now() + 60_000);

    it('verify when genuine and return their claims', () => {
      const issued = tokens.issueRefreshToken(claims, expiresAt);

      expect(tokens.verifyRefreshToken(issued.token)).toEqual({
        sub: 'user-1',
        sid: 'session-1',
        jti: expect.any(String),
      });
    });

    it('are unique per issue, even for the same session', () => {
      const first = tokens.issueRefreshToken(claims, expiresAt);
      const second = tokens.issueRefreshToken(claims, expiresAt);

      expect(first.token).not.toBe(second.token);
      expect(first.hash).not.toBe(second.hash);
    });

    it('are stored as a SHA-256 hash, never as the token', () => {
      const issued = tokens.issueRefreshToken(claims, expiresAt);

      expect(issued.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(TokensService.refreshTokenMatches(issued.token, issued.hash)).toBe(
        true,
      );
      expect(
        TokensService.refreshTokenMatches(`${issued.token}x`, issued.hash),
      ).toBe(false);
    });

    it('reject an access token presented as a refresh token', () => {
      const access = tokens.issueAccessToken({ ...claims, role: Role.ADMIN });
      expect(tokens.verifyRefreshToken(access.token)).toBeUndefined();
    });

    it('reject tokens signed with another secret', () => {
      const forged = jwt.sign(
        { sub: 'user-1', sid: 'session-1', jti: 'x' },
        {
          secret: 'attacker-secret-attacker-secret-attacker',
          audience: REFRESH_TOKEN_AUDIENCE,
          issuer: TOKEN_ISSUER,
          expiresIn: 60,
        },
      );
      expect(tokens.verifyRefreshToken(forged)).toBeUndefined();
    });

    it('reject expired tokens', () => {
      const expired = tokens.issueRefreshToken(
        claims,
        new Date(Date.now() - 1_000),
        new Date(Date.now() - 60_000),
      );
      expect(tokens.verifyRefreshToken(expired.token)).toBeUndefined();
    });

    it('reject tokens signed with a different algorithm', () => {
      const hs512 = jwt.sign(
        { sub: 'user-1', sid: 'session-1', jti: 'x' },
        {
          secret: config.auth.refreshTokenSecret,
          algorithm: 'HS512',
          audience: REFRESH_TOKEN_AUDIENCE,
          issuer: TOKEN_ISSUER,
          expiresIn: 60,
        },
      );
      expect(tokens.verifyRefreshToken(hs512)).toBeUndefined();
    });

    it('reject garbage', () => {
      expect(tokens.verifyRefreshToken('not.a.jwt')).toBeUndefined();
    });
  });
});
