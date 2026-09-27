/**
 * Client-side checks for the auth forms. They mirror the API's rules so users get instant
 * feedback, but the server remains the authority: its VALIDATION_ERROR details are shown
 * the same way.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
const NAME_MAX_LENGTH = 100;

/** Deliberately loose: the server does the real validation. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldErrors<Field extends string> = Partial<Record<Field, string>>;

export interface LoginForm {
  readonly email: string;
  readonly password: string;
}

export interface RegisterForm extends LoginForm {
  readonly firstName: string;
  readonly lastName: string;
}

function validateEmail(email: string): string | undefined {
  const value = email.trim();
  if (value === '') {
    return 'Enter your email address.';
  }
  return EMAIL_PATTERN.test(value) ? undefined : 'Enter a valid email address.';
}

function validateName(value: string, label: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') {
    return `Enter your ${label.toLowerCase()}.`;
  }
  return trimmed.length > NAME_MAX_LENGTH
    ? `${label} must be at most ${NAME_MAX_LENGTH} characters.`
    : undefined;
}

function withoutUndefined<Field extends string>(
  errors: Record<Field, string | undefined>,
): FieldErrors<Field> {
  const result: FieldErrors<Field> = {};
  for (const [field, message] of Object.entries(errors) as [
    Field,
    string | undefined,
  ][]) {
    if (message !== undefined) {
      result[field] = message;
    }
  }
  return result;
}

export function validateLogin(form: LoginForm): FieldErrors<keyof LoginForm> {
  return withoutUndefined({
    email: validateEmail(form.email),
    password: form.password === '' ? 'Enter your password.' : undefined,
  });
}

export function validateRegister(
  form: RegisterForm,
): FieldErrors<keyof RegisterForm> {
  let password: string | undefined;
  if (form.password.length < PASSWORD_MIN_LENGTH) {
    password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (form.password.length > PASSWORD_MAX_LENGTH) {
    password = `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return withoutUndefined({
    firstName: validateName(form.firstName, 'First name'),
    lastName: validateName(form.lastName, 'Last name'),
    email: validateEmail(form.email),
    password,
  });
}

export function hasErrors(errors: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(errors).length > 0;
}
