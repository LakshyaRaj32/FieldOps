import React, { useState } from 'react';
import { Alert } from 'react-native';

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
import { SyncCard } from '../../jobs/components/SyncCard';
import { useOfflineJobs } from '../../jobs/data/OfflineJobsContext';
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

  const offline = useOfflineJobs();
  const unsynced =
    offline === null
      ? 0
      : offline.status.pending +
        offline.status.failed +
        offline.status.conflicts;

  const doSignOut = () => {
    setSigningOut(true);
    // The session state change unmounts this screen; no need to reset the flag.
    dispatch(signOut()).catch(() => setSigningOut(false));
  };

  // Unsynced work is never discarded: it stays on the phone until this worker signs in again.
  const handleSignOut = () => {
    if (unsynced === 0) {
      doSignOut();
      return;
    }
    Alert.alert(
      'Sign out with unsynced changes?',
      `${unsynced} change${
        unsynced === 1 ? ' has' : 's have'
      } not reached the server yet. ` +
        'They stay on this phone and sync after you sign in again.',
      [
        { text: 'Stay signed in', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: doSignOut },
      ],
    );
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

      <SyncCard />

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
