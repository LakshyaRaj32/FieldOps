import type {
  CreateShopRequest,
  ShopDetail,
  UpdateShopRequest,
} from '@fieldops/types';

import type { FieldErrors } from '../auth/validation';

/**
 * The shop form: values as typed, checks that mirror the API (the server stays the
 * authority) and conversion to requests. Pure functions, unit-tested.
 */

export interface ShopForm {
  readonly name: string;
  readonly ownerName: string;
  readonly phone: string;
  readonly email: string;
  readonly address: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly active: boolean;
}

export type ShopFormErrors = FieldErrors<keyof ShopForm>;

export function emptyShopForm(): ShopForm {
  return {
    name: '',
    ownerName: '',
    phone: '',
    email: '',
    address: '',
    latitude: '',
    longitude: '',
    active: true,
  };
}

export function shopToForm(shop: ShopDetail): ShopForm {
  return {
    name: shop.name,
    ownerName: shop.ownerName ?? '',
    phone: shop.phone ?? '',
    email: shop.email ?? '',
    address: shop.address,
    latitude: shop.location === null ? '' : String(shop.location.latitude),
    longitude: shop.location === null ? '' : String(shop.location.longitude),
    active: shop.status === 'ACTIVE',
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Both coordinates or neither; within WGS 84 bounds. */
export function parseCoordinates(
  latitude: string,
  longitude: string,
): { latitude: number; longitude: number } | null | undefined {
  if (latitude.trim() === '' && longitude.trim() === '') {
    return null;
  }
  const lat = Number(latitude.trim());
  const lng = Number(longitude.trim());
  if (
    latitude.trim() === '' ||
    longitude.trim() === '' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return undefined;
  }
  return { latitude: lat, longitude: lng };
}

export function validateShopForm(form: ShopForm): ShopFormErrors {
  const errors: ShopFormErrors = {};
  if (form.name.trim() === '') {
    errors.name = 'Enter the shop name.';
  } else if (form.name.trim().length > 200) {
    errors.name = 'Name must be at most 200 characters.';
  }
  if (form.address.trim() === '') {
    errors.address = 'Enter the address.';
  } else if (form.address.trim().length > 500) {
    errors.address = 'Address must be at most 500 characters.';
  }
  if (form.email.trim() !== '' && !EMAIL.test(form.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  if (form.phone.trim().length > 30) {
    errors.phone = 'Phone must be at most 30 characters.';
  }
  if (parseCoordinates(form.latitude, form.longitude) === undefined) {
    errors.latitude =
      'Enter both coordinates (latitude -90 to 90, longitude -180 to 180), or neither.';
  }
  return errors;
}

const optional = (value: string): string | undefined =>
  value.trim() === '' ? undefined : value.trim();

/** Call after validateShopForm reported no errors. */
export function toCreateShopRequest(form: ShopForm): CreateShopRequest {
  const location = parseCoordinates(form.latitude, form.longitude);
  const ownerName = optional(form.ownerName);
  const phone = optional(form.phone);
  const email = optional(form.email);
  return {
    name: form.name.trim(),
    address: form.address.trim(),
    ...(ownerName !== undefined && { ownerName }),
    ...(phone !== undefined && { phone }),
    ...(email !== undefined && { email }),
    ...(location != null && { location }),
  };
}

/** Only what changed; cleared optional fields are sent as null. */
export function toUpdateShopRequest(
  form: ShopForm,
  shop: ShopDetail,
): UpdateShopRequest {
  const location = parseCoordinates(form.latitude, form.longitude) ?? null;
  const nullable = (value: string) => optional(value) ?? null;
  const sameLocation =
    (location === null && shop.location === null) ||
    (location !== null &&
      shop.location !== null &&
      location.latitude === shop.location.latitude &&
      location.longitude === shop.location.longitude);
  const status = form.active ? 'ACTIVE' : 'INACTIVE';
  return {
    ...(form.name.trim() !== shop.name && { name: form.name.trim() }),
    ...(form.address.trim() !== shop.address && {
      address: form.address.trim(),
    }),
    ...(nullable(form.ownerName) !== shop.ownerName && {
      ownerName: nullable(form.ownerName),
    }),
    ...(nullable(form.phone) !== shop.phone && { phone: nullable(form.phone) }),
    ...(nullable(form.email) !== shop.email && { email: nullable(form.email) }),
    ...(!sameLocation && { location }),
    ...(status !== shop.status && { status }),
  };
}
