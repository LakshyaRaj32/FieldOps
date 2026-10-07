/**
 * Every cache key and its TTL in one place, so readers and the writers that invalidate them
 * cannot drift apart (docs/redis.md, "What is cached").
 */
export const CacheKeys = {
  /** The organization's ACTIVE products, by name (CatalogService.activeProducts). */
  activeCatalog: (organizationId: string): string =>
    `catalog:active:${organizationId}`,
  /** The organization's currency and time zone (OrdersService.money). */
  organizationMoney: (organizationId: string): string =>
    `org:money:${organizationId}`,
} as const;

export const CacheTtl = {
  activeCatalog: { ttlSeconds: 300 },
  organizationMoney: { ttlSeconds: 600 },
} as const;
