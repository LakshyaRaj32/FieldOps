import {
  HttpStatus,
  Logger,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';

import { AuthErrors } from '../errors/app-exception.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function run(exception: unknown): { status: number; body: unknown } {
  const captured = { status: 0, body: undefined as unknown };
  const response = {
    headersSent: false,
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', path: '/x', requestId: 'req-1' }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);
  return captured;
}

describe('AllExceptionsFilter', () => {
  let loggedError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loggedError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps an AppException to its status, code and message', () => {
    expect(run(AuthErrors.invalidCredentials())).toEqual({
      status: HttpStatus.UNAUTHORIZED,
      body: {
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
          requestId: 'req-1',
        },
      },
    });
  });

  it('replaces framework messages with a generic one', () => {
    const { status, body } = run(
      new NotFoundException('Cannot GET /secret-route'),
    );

    expect(status).toBe(404);
    expect(JSON.stringify(body)).not.toContain('secret-route');
    expect(body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('maps body-parser errors (invalid JSON) to BAD_REQUEST', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      type: 'entity.parse.failed',
    });
    expect(run(parseError)).toMatchObject({
      status: 400,
      body: { error: { code: 'BAD_REQUEST' } },
    });
  });

  it('hides unexpected errors behind INTERNAL_ERROR and logs them server-side', () => {
    const { status, body } = run(
      new Error('connect ECONNREFUSED 127.0.0.1:5432 password=hunter2'),
    );

    expect(status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. Please try again.',
        requestId: 'req-1',
      },
    });
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(loggedError).toHaveBeenCalled();
  });
});
