import type { OrganizationRole } from '@fieldops/types';

import type { FieldErrors } from '../auth/validation';

/** Adding a person: the fields and the checks that mirror the API's. Pure. */
export interface MemberForm {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly password: string;
  readonly role: OrganizationRole;
  readonly managerId: string | null;
  readonly organizationWideAccess: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The API's policy: at least 8 characters, at most 128 (docs/authentication.md). */
export const PASSWORD_MIN = 8;

export function validateMemberForm(
  form: MemberForm,
): FieldErrors<keyof MemberForm> {
  const errors: FieldErrors<keyof MemberForm> = {};
  if (form.firstName.trim() === '') {
    errors.firstName = 'Enter the first name.';
  }
  if (form.lastName.trim() === '') {
    errors.lastName = 'Enter the last name.';
  }
  if (!EMAIL.test(form.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  if (form.password.length < PASSWORD_MIN) {
    errors.password = `Use at least ${PASSWORD_MIN} characters.`;
  } else if (form.password.length > 128) {
    errors.password = 'Use at most 128 characters.';
  }
  return errors;
}
