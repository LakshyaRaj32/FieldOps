import React from 'react';

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
import { selectSession, signOut } from '../../../store/slices/sessionSlice';
import { useThemePreference, type ThemePreference } from '../../../theme';
import { DiagnosticsCard } from '../components/DiagnosticsCard';
import { InfoRow } from '../components/InfoRow';

const THEME_OPTIONS: readonly SegmentedOption<ThemePreference>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ProfileScreen(
  _props: AppTabScreenProps<'Profile'>,
): React.JSX.Element {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectSession);
  const { preference, setPreference } = useThemePreference();

  return (
    <Screen>
      {session.status === 'signedIn' ? (
        <Card>
          <AppText variant="label" tone="muted">
            Account
          </AppText>
          <AppText variant="heading">{session.user.displayName}</AppText>
          <Badge label={session.user.role} tone="primary" />
          <InfoRow
            label="Session"
            value="Development session (not authenticated)"
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
        onPress={() => dispatch(signOut())}
      />
    </Screen>
  );
}
