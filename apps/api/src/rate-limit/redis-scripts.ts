/**
 * Lua versions of algorithms.ts. A script runs atomically on the Redis server, so two API
 * instances counting the same key can never both read "one left" and both proceed: there is
 * no read-modify-write race between the instances.
 *
 * The clock is Redis's (TIME), not the API instance's, so instances whose clocks drift still
 * agree on the windows. Every script returns
 * { allowed (0|1), remaining, resetMs, retryAfterMs } as integers.
 *
 * KEYS[1]: the counter. ARGV[1]: limit, ARGV[2]: window (ms), ARGV[3]: a unique request ID.
 */

const NOW = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
`;

/** Window opened by the first request; the key's TTL is the time left in the window. */
export const FIXED_WINDOW_SCRIPT = `${NOW}
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], window)
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], window)
  ttl = window
end
if count > limit then
  return {0, 0, ttl, ttl}
end
return {1, limit - count, ttl, 0}
`;

/** Sorted set of accepted request times (score = ms); members are unique request IDs. */
export const SLIDING_WINDOW_SCRIPT = `${NOW}
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
local allowed = 0
if count < limit then
  redis.call('ZADD', KEYS[1], now, ARGV[3])
  count = count + 1
  allowed = 1
end
local oldest = tonumber(redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')[2])
local newest = tonumber(redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')[2])
redis.call('PEXPIRE', KEYS[1], newest + window - now)
if allowed == 1 then
  return {1, limit - count, newest + window - now, 0}
end
return {0, 0, newest + window - now, oldest + window - now}
`;

/** Hash { tokens, ts }; tokens is fractional (refill is continuous). */
export const TOKEN_BUCKET_SCRIPT = `${NOW}
local rate = limit / window
local stored = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(stored[1])
local updated = tonumber(stored[2])
if tokens == nil or updated == nil then
  tokens = limit
  updated = now
end
tokens = math.min(limit, tokens + math.max(0, now - updated) * rate)
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', now)
local untilFull = math.max(1, math.ceil((limit - tokens) / rate))
redis.call('PEXPIRE', KEYS[1], untilFull)
if allowed == 1 then
  return {1, math.floor(tokens), untilFull, 0}
end
return {0, 0, untilFull, math.ceil((1 - tokens) / rate)}
`;
