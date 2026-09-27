import React, { useState } from 'react';

import type { AccountScreenProps } from '../../../app/navigation/types';
import { ErrorState } from '../../../components/common/ErrorState';
import {
  AppText,
  Button,
  Card,
  Screen,
  SectionTitle,
  TextField,
} from '../../../components/ui';
import { fieldError, toAppError, type AppError } from '../../../utils/errors';
import { useChangePasswordMutation } from '../api/organizationApi';
import { PASSWORD_MIN } from '../memberForm';

/**
 * Change the password (people added by an admin start with an initial one). The current
 * password is required, and every other device is signed out; this one stays signed in.
 */
export function ChangePasswordScreen({
  navigation,
}: AccountScreenProps<'ChangePassword'>): React.JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [serverError, setServerError] = useState<AppError | undefined>();
  const [change, state] = useChangePasswordMutation();

  const submit = async () => {
    setProblem(undefined);
    setServerError(undefined);
    if (next.length < PASSWORD_MIN) {
      setProblem(`Use at least ${PASSWORD_MIN} characters.`);
      return;
    }
    if (next !== repeat) {
      setProblem("The new passwords don't match.");
      return;
    }
    const result = await change({
      currentPassword: current,
      newPassword: next,
    });
    if (result.error !== undefined) {
      setServerError(toAppError(result.error));
    } else {
      navigation.goBack();
    }
  };

  return (
    <Screen>
      <Card>
        <SectionTitle title="Change password" icon="key-outline" />
        <TextField
          label="Current password"
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          autoCapitalize="none"
          error={fieldError(serverError, 'currentPassword')}
        />
        <TextField
          label="New password"
          value={next}
          onChangeText={setNext}
          secureTextEntry
          autoCapitalize="none"
          hint={`At least ${PASSWORD_MIN} characters. A few unrelated words work well.`}
          error={fieldError(serverError, 'newPassword')}
        />
        <TextField
          label="Repeat the new password"
          value={repeat}
          onChangeText={setRepeat}
          secureTextEntry
          autoCapitalize="none"
        />
        <AppText variant="caption" tone="muted">
          Your other devices will be signed out.
        </AppText>
      </Card>
      {problem !== undefined ? (
        <AppText tone="danger" accessibilityRole="alert">
          {problem}
        </AppText>
      ) : null}
      {serverError !== undefined &&
      fieldError(serverError, 'currentPassword') === undefined ? (
        <ErrorState title="Couldn't change the password" error={serverError} />
      ) : null}
      <Button
        label="Change password"
        icon="checkmark"
        loading={state.isLoading}
        onPress={() => {
          submit().catch(() => undefined);
        }}
      />
    </Screen>
  );
}
