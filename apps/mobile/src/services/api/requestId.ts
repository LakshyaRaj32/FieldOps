/**
 * Generates a correlation ID sent as `X-Request-Id`, so a failing request on the phone can be
 * matched with server logs (Version 15 adds full tracing).
 *
 * Not cryptographically random, and never used for security: it only needs to be unique
 * enough to find a request in logs.
 */
export function createRequestId(
  now: number = Date.now(),
  random: () => number = Math.random,
): string {
  const time = now.toString(36);
  const entropy = random().toString(36).slice(2, 10).padEnd(8, '0');
  return `${time}-${entropy}`;
}
