import { hasErrors, validateLogin, validateRegister } from './validation';

describe('validateLogin', () => {
  it('accepts a complete form', () => {
    expect(
      validateLogin({ email: ' asha@example.com ', password: 'x' }),
    ).toEqual({});
  });

  it('requires an email and a password', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'Enter your email address.',
      password: 'Enter your password.',
    });
  });

  it('rejects a malformed email', () => {
    expect(validateLogin({ email: 'asha@', password: 'x' }).email).toBe(
      'Enter a valid email address.',
    );
  });
});

describe('validateRegister', () => {
  const valid = {
    firstName: 'Asha',
    lastName: 'Verma',
    email: 'asha@example.com',
    password: 'correct horse',
  };

  it('accepts a complete form', () => {
    expect(hasErrors(validateRegister(valid))).toBe(false);
  });

  it('applies the same password length rule as the API', () => {
    expect(validateRegister({ ...valid, password: '1234567' }).password).toBe(
      'Use at least 8 characters.',
    );
    expect(
      validateRegister({ ...valid, password: 'x'.repeat(129) }).password,
    ).toBe('Use at most 128 characters.');
    expect(
      validateRegister({ ...valid, password: '12345678' }).password,
    ).toBeUndefined();
  });

  it('requires names that are not just whitespace', () => {
    const errors = validateRegister({
      ...valid,
      firstName: '   ',
      lastName: '',
    });
    expect(errors).toEqual({
      firstName: 'Enter your first name.',
      lastName: 'Enter your last name.',
    });
  });
});
