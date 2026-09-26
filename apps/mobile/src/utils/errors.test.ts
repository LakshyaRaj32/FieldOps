import {
  fieldError,
  fromFetchBaseQueryError,
  isAppError,
  toAppError,
} from './errors';

describe('fromFetchBaseQueryError', () => {
  it('maps connection failures to a network error', () => {
    const error = fromFetchBaseQueryError(
      { status: 'FETCH_ERROR', error: 'TypeError: Network request failed' },
      'req-1',
    );
    expect(error).toMatchObject({ kind: 'network', requestId: 'req-1' });
    expect(error.detail).toBe('TypeError: Network request failed');
  });

  it('maps timeouts', () => {
    expect(
      fromFetchBaseQueryError({ status: 'TIMEOUT_ERROR', error: 'AbortError' })
        .kind,
    ).toBe('timeout');
  });

  it('reads the API error envelope and uses app-owned copy for known codes', () => {
    const error = fromFetchBaseQueryError(
      {
        status: 401,
        data: {
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
            requestId: 'server-req-1',
          },
        },
      },
      'client-req-1',
    );
    expect(error).toEqual({
      kind: 'http',
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Incorrect email or password.',
      requestId: 'server-req-1',
      detail: 'Invalid email or password.',
    });
  });

  it('keeps validation details for showing next to form fields', () => {
    const error = fromFetchBaseQueryError({
      status: 400,
      data: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are missing or invalid.',
          details: [
            { field: 'email', message: 'Enter a valid email address.' },
            { field: 42, message: 'ignored: malformed' },
          ],
        },
      },
    });
    expect(error.details).toEqual([
      { field: 'email', message: 'Enter a valid email address.' },
    ]);
    expect(fieldError(error, 'email')).toBe('Enter a valid email address.');
    expect(fieldError(error, 'password')).toBeUndefined();
  });

  it('never shows server text for server errors', () => {
    const error = fromFetchBaseQueryError({
      status: 500,
      data: {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'relation "users" does not exist',
        },
      },
    });
    expect(error.message).toBe(
      'The server ran into a problem. Please try again shortly.',
    );
  });

  it.each([
    [401, 'Your session has expired. Please sign in again.'],
    [403, "You don't have permission to do that."],
    [429, 'Too many requests. Please wait a moment and try again.'],
    [503, 'The server ran into a problem. Please try again shortly.'],
    [418, 'The request failed (status 418).'],
  ])('falls back to a safe message for HTTP %i', (status, message) => {
    expect(
      fromFetchBaseQueryError({ status, data: '<html>error page</html>' })
        .message,
    ).toBe(message);
  });

  it('maps unreadable responses to a parse error with the original status', () => {
    expect(
      fromFetchBaseQueryError({
        status: 'PARSING_ERROR',
        originalStatus: 200,
        data: 'not json',
        error: 'SyntaxError',
      }),
    ).toMatchObject({ kind: 'parse', status: 200 });
  });

  it('omits optional fields that are absent', () => {
    const error = fromFetchBaseQueryError({
      status: 'TIMEOUT_ERROR',
      error: 'x',
    });
    expect(Object.keys(error)).not.toContain('requestId');
    expect(Object.keys(error)).not.toContain('status');
  });
});

describe('toAppError', () => {
  it('returns AppErrors unchanged', () => {
    const appError = { kind: 'timeout', message: 'slow' } as const;
    expect(toAppError(appError)).toBe(appError);
  });

  it('normalizes raw RTK Query errors', () => {
    expect(toAppError({ status: 'FETCH_ERROR', error: 'offline' }).kind).toBe(
      'network',
    );
  });

  it('keeps technical details out of the user-facing message', () => {
    const error = toAppError(
      new TypeError("Cannot read properties of undefined (reading 'id')"),
    );
    expect(error.kind).toBe('unexpected');
    expect(error.message).toBe('Something went wrong. Please try again.');
    expect(error.detail).toContain('TypeError');
  });

  it('handles serialized errors and arbitrary values', () => {
    expect(toAppError({ name: 'Error', message: 'boom' }).detail).toBe('boom');
    expect(toAppError('boom').detail).toBe('boom');
    expect(toAppError(undefined).kind).toBe('unexpected');
  });
});

describe('isAppError', () => {
  it('rejects look-alikes with an unknown kind', () => {
    expect(isAppError({ kind: 'weird', message: 'x' })).toBe(false);
    expect(isAppError({ kind: 'http', message: 'x' })).toBe(true);
  });
});
