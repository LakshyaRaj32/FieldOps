import { fromFetchBaseQueryError, isAppError, toAppError } from './errors';

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

  it('uses RFC 9457 Problem Details from the server when present', () => {
    const error = fromFetchBaseQueryError({
      status: 409,
      data: {
        title: 'Conflict',
        detail: 'Job is no longer assigned to you.',
        code: 'JOB_REASSIGNED',
      },
    });
    expect(error).toEqual({
      kind: 'http',
      status: 409,
      message: 'Job is no longer assigned to you.',
      code: 'JOB_REASSIGNED',
    });
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
