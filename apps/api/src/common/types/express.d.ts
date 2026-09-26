import type { AuthenticatedUser } from './authenticated-user.js';

declare global {
  namespace Express {
    // Passport attaches the value returned by JwtStrategy.validate() as request.user.
    interface User extends AuthenticatedUser {}

    interface Request {
      /** Correlation ID, from a valid X-Request-Id header or generated per request. */
      requestId?: string;
    }
  }
}

export {};
