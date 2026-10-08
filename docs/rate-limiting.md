# Rate limiting

Phase 5.2 ([master-development-plan.md](master-development-plan.md)). This is a custom
limiter, not a library: `apps/api/src/rate-limit/`.

## How a request is limited

1. `RateLimitGuard` is a global guard. It runs after `JwtAuthGuard` and before `RolesGuard`,
   so refused requests (403) still count.
2. The policy is the route's `@RateLimit(name)`, or `default`. `@SkipRateLimit()` exempts a
   route (health probes).
3. The key is `rl:<policy>:u:<userId>` for a signed-in user (shared by all their devices and
   networks), or `rl:<policy>:ip:<address>` otherwise, and always the IP for `key: 'ip'`
   policies.
4. `RateLimiterService` counts in Redis (a Lua script: atomic and shared by every instance,
   using Redis's clock). It falls back to in-process counters when Redis is missing or fails,
   so limits stay on, per instance.
5. Every limited response carries the RateLimit headers. A refusal is `429 TOO_MANY_REQUESTS`
   with `Retry-After`. The mobile app already retries 429 with backoff
   (`retryPolicy.ts`).

```text
RateLimit-Limit: 20
RateLimit-Remaining: 0
RateLimit-Reset: 287          (seconds until the quota is fully back)
RateLimit-Policy: 20;w=300
Retry-After: 41               (429 only)
```

## Policies

Defined in `rate-limit.policies.ts`. These are starting values, to be checked against real
traffic in Phase 6.

| Policy | Routes | Algorithm | Default | Key |
| --- | --- | --- | --- | --- |
| `default` | Every route without a policy | Token bucket | 120, refilled 120/min (bursts, then 2/s) | user or IP |
| `auth` | `register`, `login`, `change-password` | Sliding window (log) | 20 / 5 min | IP |
| `refresh` | `auth/refresh` | Fixed window | 60 / min | IP |
| `upload` | `POST jobs/:id/evidence` | Fixed window | 60 / min | user or IP |

Each policy can be overridden per deployment with `RATE_LIMIT_<NAME>=<requests>/<window>`,
for example `RATE_LIMIT_AUTH=50/5m`. `RATE_LIMIT_ENABLED=false` turns limiting off (the E2E
suite does this; `rate-limit.e2e-spec.ts` turns it back on with small policies).

## The algorithms

`algorithms.ts` holds the pure functions, used by the memory store and unit-tested.
`redis-scripts.ts` has the same arithmetic in Lua.

| Algorithm | State | Strength | Weakness |
| --- | --- | --- | --- |
| Fixed window | One counter with a TTL (window opens on the first request) | Cheapest: one `INCR` | Up to twice the limit across a window boundary |
| Sliding window log | Sorted set of accepted request times | Exact; no boundary burst | One entry per accepted request: for small limits only |
| Token bucket | `{ tokens, ts }`, continuous refill | Allows bursts (a phone draining its outbox) at a bounded average | Burst size has to be chosen |

Refused requests count in the fixed window, but not in the sliding log or the token bucket,
so retrying while refused doesn't push the window further out.

## Client IP behind a proxy

`TRUST_PROXY` is the number of proxies in front of the API (0 locally, 1 on Render). Express
reads `X-Forwarded-For` through exactly that many hops. A higher value would let clients
choose their own IP; a lower one would make every client share the proxy's IP.
**To verify after deploying:** two devices on different networks must get separate `auth`
counters.

## Known limitations

- Requests with an invalid access token are rejected by authentication before they are
  counted. They cost one JWT signature check (no database access).
- The `auth` policy keys by IP. Many workers behind one office NAT share it, which is why the
  default is 20 per 5 minutes rather than lower. A per-account counter for failed sign-ins is
  a candidate for the security review (Phase 5.6).
- Without Redis, each instance enforces the limits separately.
