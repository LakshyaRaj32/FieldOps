# Redis and caching

Phase 5.1 ([master-development-plan.md](master-development-plan.md)). Redis holds **cache entries
and rate-limit counters only**. PostgreSQL is the source of truth; nothing in Redis needs a
backup, and the API keeps working without it.

## Running it

| Where | How |
| --- | --- |
| Local | `docker compose -f infra/docker/compose.yaml up -d redis`, then `REDIS_URL=redis://localhost:6379` in `apps/api/.env` |
| Compose stack | The `redis` service (Redis 7, no persistence, 64 MB, `volatile-lru`); the `api` service gets `REDIS_URL=redis://redis:6379` |
| Render | The `fieldops-redis` Key Value instance in `render.yaml` (free plan, private network only); `REDIS_URL` comes from its `connectionString` |
| E2E tests | `TEST_REDIS_URL=redis://localhost:6379 npm run test:e2e -w @fieldops/api`. Without it, the Redis-only tests are skipped and the rest run on the fallbacks |

Configuration (`apps/api/src/config/app-config.ts`):

- `REDIS_URL`: `redis://` or `rediss://`. Empty means no Redis.
- `REDIS_KEY_PREFIX`: prepended to every key (default `fieldops:`; tests use `fieldops-test:`).

## Behaviour when Redis is missing or down

`RedisService` (`apps/api/src/redis/`) owns the one connection. Commands fail fast while it is
disconnected (no offline queue), and the client keeps reconnecting in the background. The API
starts even if Redis is unreachable.

| Feature | Without Redis |
| --- | --- |
| Cache | Every read goes to PostgreSQL. A failed invalidation is logged; the entry expires at its TTL |
| Rate limiting | Counted in the process's memory: still enforced, but per instance |
| `/health/ready` | Still `200` (it depends on PostgreSQL only) and reports `redis: up \| down \| disabled` |

## Caching

`CacheService.getOrLoad(key, { ttlSeconds }, load)` is cache-aside: on a hit it returns the
stored JSON, and on a miss it reads PostgreSQL and fills the entry. Keys and TTLs live in
`apps/api/src/cache/cache-keys.ts`, under `cache:v1:` (bump the version when a value's shape
changes).

### What is cached

| Key | Read by | Invalidated by | TTL |
| --- | --- | --- | --- |
| `catalog:active:<orgId>` | `CatalogService.activeProducts`: the worker working set and `GET /products` (status `ACTIVE`) | Product create and update | 5 min |
| `org:money:<orgId>` | `OrdersService.money` (currency, time zone): orders, payments and the dashboard | Organization update | 10 min |

Not cached, on purpose:

- **Prices for writes.** Order lines and operations validate products with
  `activeProductsById`, which reads PostgreSQL, so a price is never taken from the cache.
- **The session check on every request** (`AccessTokenVerifier`). Caching it would delay
  logout, revocation and deactivation by up to the TTL. Revisit after measuring (Phase 6).
- **Dashboard figures.** They change with every job and payment, and realtime events trigger
  refetches that must see fresh data.

### Stale-data handling

- Writers call `invalidate(key)` **after their transaction commits**. It increments the key's
  generation counter and deletes the value.
- A miss reads the generation *before* loading. The fill is a Lua script that stores the value
  only if the generation is unchanged. A reader that loaded the old row while a write
  committed therefore cannot put stale data back.
- The TTL bounds staleness if an invalidation is lost (for example while Redis is down). TTLs
  have ±10% jitter so entries filled together don't all expire together.
- The remaining window is between a commit and its invalidation, a few milliseconds. That is
  acceptable for these values.

### Stampede protection

Concurrent misses for one key in one process share a single database read (single-flight).
Across instances, each may read once, which is cheap for these lookups. Distributed locks
(Phase 5.4) could close that gap if a costly entry ever needs it.

## Tests

- `src/rate-limit/algorithms.spec.ts`: the algorithms (unit).
- `test/redis.e2e-spec.ts`: checks that the Lua scripts match the algorithms. It also covers
  atomicity under 60 concurrent requests from two connections, counters shared across
  instances, cache hit/miss, the invalidation race, single-flight, TTL expiry, and the
  fallbacks with Redis unreachable.
- `test/rate-limit.e2e-spec.ts`: the HTTP behaviour, run against Redis or memory.
