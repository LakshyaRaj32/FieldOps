import React, { useState } from 'react';
import { Alert } from 'react-native';

import type { AccountScreenProps } from '../../../app/navigation/types';
import {
  AppText,
  Badge,
  Button,
  Card,
  Screen,
  SegmentedControl,
  type SegmentedOption,
  SectionTitle,
} from '../../../components/ui';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useThemePreference, type ThemePreference } from '../../../theme';
import { isOrganizationAdmin, ROLE_LABELS } from '../../auth/roles';
import { signOut } from '../../auth/session';
import { SyncCard } from '../../jobs/components/SyncCard';
import { useOfflineJobs } from '../../jobs/data/OfflineJobsContext';
import { DiagnosticsCard } from '../components/DiagnosticsCard';
import { LiveUpdatesCard } from '../components/LiveUpdatesCard';
import { InfoRow } from '../../../components/common/InfoRow';

const THEME_OPTIONS: readonly SegmentedOption<ThemePreference>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ProfileScreen({
  navigation,
}: AccountScreenProps<'Profile'>): React.JSX.Element {
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
          <SectionTitle title="Account" icon="person-outline" />
          <AppText variant="heading">
            {user.firstName} {user.lastName}
          </AppText>
          <Badge label={ROLE_LABELS[user.role]} tone="primary" />
          <InfoRow label="Email" value={user.email} />
          {user.organization !== null ? (
            <InfoRow label="Organization" value={user.organization.name} />
          ) : null}
          {user.organizationWideAccess ? (
            <InfoRow
              label="Access"
              value="Every team and shop of the organization"
            />
          ) : null}
          <InfoRow
            label="Member since"
            value={new Date(user.createdAt).toLocaleDateString()}
          />
          <Button
            label="Change password"
            icon="key-outline"
            variant="secondary"
            size="sm"
            onPress={() => navigation.navigate('ChangePassword')}
          />
        </Card>
      ) : null}

      {isOrganizationAdmin(user) ? (
        <Card>
          <SectionTitle title="Administration" icon="business-outline" />
          <Button
            label="People and teams"
            icon="people-outline"
            variant="secondary"
            onPress={() => navigation.navigate('Members')}
          />
          <Button
            label="Products"
            icon="pricetags-outline"
            variant="secondary"
            onPress={() => navigation.navigate('Products')}
          />
          <Button
            label="Organization settings"
            icon="options-outline"
            variant="secondary"
            onPress={() => navigation.navigate('OrganizationSettings')}
          />
        </Card>
      ) : null}

      <Card>
        <SectionTitle title="Appearance" icon="color-palette-outline" />
        <SegmentedControl
          accessibilityLabel="Theme"
          options={THEME_OPTIONS}
          value={preference}
          onChange={setPreference}
        />
      </Card>

      <SyncCard />

      <LiveUpdatesCard />

      <DiagnosticsCard />

      <Button
        label="Sign out"
        icon="log-out-outline"
        variant="danger"
        loading={signingOut}
        onPress={handleSignOut}
      />
    </Screen>
  );
}
