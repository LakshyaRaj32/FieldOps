import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'fieldops:isPublic';

/**
 * Marks a route as reachable without an access token. Authentication is on by default for
 * every route (the JWT guard is global), so forgetting a decorator fails closed.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
