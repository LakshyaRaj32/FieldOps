import { ProductStatus, type Product } from '@fieldops/types';

import {
  isArrayOf,
  isNullableString,
  isNumber,
  isRecord,
  isString,
  oneOf,
} from '../../../services/api/guards';

const isStatus = oneOf(ProductStatus);

export function isProduct(value: unknown): value is Product {
  if (!isRecord(value)) {
    return false;
  }
  const { id, name, sku, category, unitPrice, status, createdAt, updatedAt } =
    value;
  return (
    [id, name, sku, createdAt, updatedAt].every(isString) &&
    isNullableString(category) &&
    isNumber(unitPrice) &&
    isStatus(status)
  );
}

export function isProductList(value: unknown): value is Product[] {
  return isArrayOf(value, isProduct);
}
