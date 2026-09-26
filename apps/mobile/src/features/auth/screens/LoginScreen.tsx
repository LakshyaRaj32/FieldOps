import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Role } from '@fieldops/types';

import { getConfig } from '../../../app/config';
import type { AuthScreenProps } from '../../../app/navigation/types';
import { AppText, Badge, Button, Card, Screen } from '../../../components/ui';
import { useAppDispatch } from '../../../store/hooks';
import { developmentSessionStarted } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  [Role.WORKER]: 'Continue as Worker',
  [Role.MANAGER]: 'Continue as Manager',
  [Role.ADMIN]: 'Continue as Admin',
};

const ROLES: readonly Role[] = [Role.WORKER, Role.MANAGER, Role.ADMIN];

/**
 * Version 1 placeholder for sign-in. Real authentication arrives in Version 2. Until then,
 * development builds offer a clearly labeled development entry so navigation can be tested.
 */
export function LoginScreen(
  _props: AuthScreenProps<'Login'>,
): React.JSX.Element {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const { environment } = getConfig();
  const developmentEntryEnabled = environment === 'development';

  const continueAs = useCallback(
    (role: Role) => dispatch(developmentSessionStarted(role)),
    [dispatch],
  );

  return (
    <Screen
      edges={['top', 'bottom', 'left', 'right']}
      contentStyle={styles.centered}
    >
      <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
        <AppText variant="display">FieldOps</AppText>
        <AppText tone="muted">
          Field work that keeps going when the network doesn't.
        </AppText>
      </View>

      <Card>
        <AppText variant="heading">Sign in</AppText>
        <AppText tone="muted">Secure sign-in arrives in Version 2.</AppText>

        {developmentEntryEnabled ? (
          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            <AppText variant="label" tone="muted">
              Development access
            </AppText>
            {ROLES.map(role => (
              <Button
                key={role}
                label={ROLE_LABELS[role]}
                variant={role === Role.WORKER ? 'primary' : 'secondary'}
                onPress={() => continueAs(role)}
              />
            ))}
          </View>
        ) : (
          <AppText>Sign-in is not available in this build yet.</AppText>
        )}
      </Card>

      <Badge
        label={`${environment} build`}
        tone={developmentEntryEnabled ? 'warning' : 'neutral'}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
});
