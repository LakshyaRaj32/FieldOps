import type { Product } from '@fieldops/types';

/** Order entry rules shared by the order form and the worker's order collection. Pure. */

/** A whole quantity of 1..1,000,000, or undefined (0 and empty mean "not ordered"). */
export function parseQuantity(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const quantity = Number(trimmed);
  return quantity >= 1 && quantity <= 1_000_000 ? quantity : undefined;
}

export interface OrderLine {
  readonly product: Product;
  readonly quantity: number;
}

/** The products with a valid quantity, in catalog order. */
export function orderLines(
  catalog: readonly Product[],
  quantities: Readonly<Record<string, string>>,
): OrderLine[] {
  return catalog.flatMap(product => {
    const quantity = parseQuantity(quantities[product.id] ?? '');
    return quantity === undefined ? [] : [{ product, quantity }];
  });
}
