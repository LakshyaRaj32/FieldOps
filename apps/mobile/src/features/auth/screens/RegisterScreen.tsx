import React, { useRef, useState } from 'react';
import { View } from 'react-native';

import type { AuthScreenProps } from '../../../app/navigation/types';
import { ErrorState } from '../../../components/common/ErrorState';
import {
  AppText,
  Button,
  Card,
  Screen,
  TextField,
  type TextFieldHandle,
} from '../../../components/ui';
import { useTheme } from '../../../theme';
import { fieldError } from '../../../utils/errors';
import { useSignIn } from '../useSignIn';
import {
  PASSWORD_MIN_LENGTH,
  hasErrors,
  validateRegister,
  type FieldErrors,
  type RegisterForm,
} from '../validation';

type Field = keyof RegisterForm;

/**
 * Self-registration. New accounts are always WORKER accounts; managers and admins are
 * promoted by an administrator. A successful registration signs the user in directly.
 */
export function RegisterScreen({
  navigation,
}: AuthScreenProps<'Register'>): React.JSX.Element {
  const theme = useTheme();
  const {
    submit: register,
    isLoading,
    error: serverError,
    reset,
  } = useSignIn('register');

  const [form, setForm] = useState<RegisterForm>({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const lastNameRef = useRef<TextFieldHandle>(null);
  const emailRef = useRef<TextFieldHandle>(null);
  const passwordRef = useRef<TextFieldHandle>(null);

  const errorFor = (field: Field) =>
    errors[field] ?? fieldError(serverError, field);
  const update = (field: Field) => (value: string) => {
    setForm(current => ({ ...current, [field]: value }));
    setErrors(current => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    if (serverError !== undefined) {
      reset();
    }
  };

  const submit = () => {
    const validation = validateRegister(form);
    setErrors(validation);
    if (!hasErrors(validation) && !isLoading) {
      register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        password: form.password,
      });
    }
  };

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <View style={{ gap: theme.spacing.sm }}>
        <AppText variant="title">Create your account</AppText>
        <AppText tone="muted">
          New accounts start as field workers. Your administrator can change
          your role.
        </AppText>
      </View>

      <Card>
        <TextField
          label="First name"
          value={form.firstName}
          onChangeText={update('firstName')}
          error={errorFor('firstName')}
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="next"
          onSubmitEditing={() => lastNameRef.current?.focus()}
          editable={!isLoading}
        />
        <TextField
          ref={lastNameRef}
          label="Last name"
          value={form.lastName}
          onChangeText={update('lastName')}
          error={errorFor('lastName')}
          autoComplete="family-name"
          textContentType="familyName"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          editable={!isLoading}
        />
        <TextField
          ref={emailRef}
          label="Email"
          value={form.email}
          onChangeText={update('email')}
          error={errorFor('email')}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!isLoading}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          value={form.password}
          onChangeText={update('password')}
          error={errorFor('password')}
          placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!isLoading}
        />

        {serverError !== undefined && serverError.details === undefined ? (
          <ErrorState title="Couldn't create the account" error={serverError} />
        ) : null}

        <Button label="Create account" onPress={submit} loading={isLoading} />
        <Button
          label="I already have an account"
          variant="ghost"
          onPress={() => navigation.goBack()}
          disabled={isLoading}
        />
      </Card>
    </Screen>
  );
}
