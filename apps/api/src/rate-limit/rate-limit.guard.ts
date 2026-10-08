import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import { AppException } from '../common/errors/app-exception.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import type { RateLimitDecision } from './algorithms.js';
import {
  NO_RATE_LIMIT,
  RATE_LIMIT_POLICY_KEY,
} from './rate-limit.decorator.js';
import type {
  RateLimitPolicy,
  RateLimitPolicyName,
} from './rate-limit.policies.js';
import { RateLimiterService } from './rate-limiter.service.js';

/** IETF draft "RateLimit header fields for HTTP" names, also exposed through CORS. */
export const RATE_LIMIT_HEADERS = [
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
  'RateLimit-Policy',
  'Retry-After',
] as const;

const seconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

/**
 * Global guard, after authentication (so a signed-in user is counted as themselves on every
 * device and network) and before the role check (so refused requests count too).
 *
 * Every response of a limited route carries the RateLimit-* headers; a refusal is a 429
 * TOO_MANY_REQUESTS with Retry-After. The mobile app already retries 429 with backoff.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.limiter.enabled || context.getType() !== 'http') {
      return true;
    }
    const name =
      this.reflector.getAllAndOverride<
        RateLimitPolicyName | typeof NO_RATE_LIMIT | undefined
      >(RATE_LIMIT_POLICY_KEY, [context.getHandler(), context.getClass()]) ??
      'default';
    if (name === NO_RATE_LIMIT) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const policy = this.limiter.policy(name);
    const decision = await this.limiter.consume(
      policy,
      identityOf(request, policy),
    );

    setHeaders(response, policy, decision);
    if (!decision.allowed) {
      const wait = Math.max(1, seconds(decision.retryAfterMs));
      response.setHeader('Retry-After', String(wait));
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.TOO_MANY_REQUESTS,
        `Too many requests. Try again in ${wait} second${wait === 1 ? '' : 's'}.`,
      );
    }
    return true;
  }
}

function identityOf(request: Request, policy: RateLimitPolicy): string {
  if (policy.key === 'user-or-ip' && request.user !== undefined) {
    return `u:${request.user.userId}`;
  }
  // request.ip honours the TRUST_PROXY setting (app.setup.ts).
  return `ip:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`;
}

function setHeaders(
  response: Response,
  policy: RateLimitPolicy,
  decision: RateLimitDecision,
): void {
  response.setHeader('RateLimit-Limit', String(decision.limit));
  response.setHeader('RateLimit-Remaining', String(decision.remaining));
  response.setHeader('RateLimit-Reset', String(seconds(decision.resetMs)));
  response.setHeader(
    'RateLimit-Policy',
    `${policy.limit};w=${seconds(policy.windowMs)}`,
  );
}
