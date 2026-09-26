import React, { useState } from 'react';

import type { AppTabScreenProps } from '../../../app/navigation/types';
import {
  AppText,
  Badge,
  Button,
  Card,
  Screen,
  SegmentedControl,
  type SegmentedOption,
} from '../../../components/ui';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useThemePreference, type ThemePreference } from '../../../theme';
import { signOut } from '../../auth/session';
import { DiagnosticsCard } from '../components/DiagnosticsCard';
import { InfoRow } from '../../../components/common/InfoRow';

const THEME_OPTIONS: readonly SegmentedOption<ThemePreference>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ProfileScreen(
  _props: AppTabScreenProps<'Profile'>,
): React.JSX.Element {
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectSessionUser);
  const { preference, setPreference } = useThemePreference();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = () => {
    setSigningOut(true);
    // The session state change unmounts this screen; no need to reset the flag.
    dispatch(signOut()).catch(() => setSigningOut(false));
  };

  return (
    <Screen>
      {user !== null ? (
        <Card>
          <AppText variant="label" tone="muted">
            Account
          </AppText>
          <AppText variant="heading">
            {user.firstName} {user.lastName}
          </AppText>
          <Badge label={user.role} tone="primary" />
          <InfoRow label="Email" value={user.email} />
          <InfoRow
            label="Member since"
            value={new Date(user.createdAt).toLocaleDateString()}
          />
        </Card>
      ) : null}

      <Card>
        <AppText variant="label" tone="muted">
          Appearance
        </AppText>
        <SegmentedControl
          accessibilityLabel="Theme"
          options={THEME_OPTIONS}
          value={preference}
          onChange={setPreference}
        />
      </Card>

      <DiagnosticsCard />

      <Button
        label="Sign out"
        variant="danger"
        loading={signingOut}
        onPress={handleSignOut}
      />
    </Screen>
  );
}
