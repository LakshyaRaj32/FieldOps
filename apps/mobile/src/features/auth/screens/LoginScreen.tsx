import React, { useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { getConfig } from '../../../app/config';
import type { AuthScreenProps } from '../../../app/navigation/types';
import { ErrorState } from '../../../components/common/ErrorState';
import {
  AppText,
  Badge,
  Button,
  Card,
  Icon,
  Screen,
  TextField,
  type TextFieldHandle,
} from '../../../components/ui';
import { useAppSelector } from '../../../store/hooks';
import { selectSignedOutReason } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';
import { fieldError } from '../../../utils/errors';
import { useSignIn } from '../useSignIn';
import {
  hasErrors,
  validateLogin,
  type FieldErrors,
  type LoginForm,
} from '../validation';

/**
 * Sign-in with email and password against the FieldOps API. On success the credential
 * store keeps the tokens and the session state switches the navigator to the main app.
 */
export function LoginScreen({
  navigation,
}: AuthScreenProps<'Login'>): React.JSX.Element {
  const theme = useTheme();
  const { environment } = getConfig();
  const signedOutReason = useAppSelector(selectSignedOutReason);
  const {
    submit: login,
    isLoading,
    error: serverError,
    reset,
  } = useSignIn('login');

  const [form, setForm] = useState<LoginForm>({ email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors<keyof LoginForm>>({});
  const passwordRef = useRef<TextFieldHandle>(null);

  const update = (field: keyof LoginForm) => (value: string) => {
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
    const validation = validateLogin(form);
    setErrors(validation);
    if (!hasErrors(validation) && !isLoading) {
      login({ email: form.email.trim(), password: form.password });
    }
  };

  return (
    <Screen
      edges={['top', 'bottom', 'left', 'right']}
      contentStyle={styles.centered}
    >
      <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.sm }}>
        <Image
          source={BRAND_MARK}
          style={[styles.brand, { borderRadius: theme.radii.lg }]}
          accessibilityIgnoresInvertColors
          accessible={false}
        />
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="display" accessibilityRole="header">
            FieldOps
          </AppText>
          <AppText tone="muted">
            Field work that keeps going when the network doesn't.
          </AppText>
        </View>
      </View>

      {signedOutReason === 'sessionEnded' && serverError === undefined ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.notice,
            {
              gap: theme.spacing.sm,
              padding: theme.spacing.md,
              borderRadius: theme.radii.md,
              backgroundColor: theme.colors.warningMuted,
            },
          ]}
        >
          <Icon name="time-outline" tone="warning" />
          <AppText tone="warning" style={styles.noticeText}>
            Your session has ended. Please sign in again.
          </AppText>
        </View>
      ) : null}

      <Card>
        <AppText variant="heading">Sign in</AppText>
        <TextField
          label="Email"
          value={form.email}
          onChangeText={update('email')}
          error={errors.email ?? fieldError(serverError, 'email')}
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
          error={errors.password ?? fieldError(serverError, 'password')}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!isLoading}
        />

        {serverError !== undefined && serverError.details === undefined ? (
          <ErrorState title="Couldn't sign in" error={serverError} />
        ) : null}

        <Button
          label="Sign in"
          icon="log-in-outline"
          onPress={submit}
          loading={isLoading}
        />
        <Button
          label="Create an account"
          variant="ghost"
          onPress={() => navigation.navigate('Register')}
          disabled={isLoading}
        />
      </Card>

      {environment !== 'production' ? (
        <Badge label={`${environment} build`} tone="warning" />
      ) : null}
    </Screen>
  );
}

// The launcher icon's artwork (rendered by scripts/render-app-icon.py).
const BRAND_MARK = require('../../../assets/brand-mark.png');

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  brand: { width: 56, height: 56 },
  notice: { flexDirection: 'row', alignItems: 'center' },
  noticeText: { flex: 1 },
});
