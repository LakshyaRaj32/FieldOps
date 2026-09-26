import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Role } from '@fieldops/types';

import type { AppTabScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import {
  AppText,
  Badge,
  Card,
  Screen,
  type BadgeTone,
} from '../../../components/ui';
import { useConnectivity } from '../../../hooks/useConnectivity';
import {
  describeConnectivityStatus,
  type ConnectivityStatus,
} from '../../../services/network/connectivity';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';

const STATUS_TONES: Readonly<Record<ConnectivityStatus, BadgeTone>> = {
  online: 'success',
  offline: 'warning',
  checking: 'neutral',
  unknown: 'neutral',
};

function greeting(hour: number): string {
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 18) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

export function DashboardScreen({
  navigation,
}: AppTabScreenProps<'Dashboard'>): React.JSX.Element {
  const theme = useTheme();
  const user = useAppSelector(selectSessionUser);
  const connectivity = useConnectivity();
  const isWorker = user?.role === Role.WORKER;

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText tone="muted">{greeting(new Date().getHours())},</AppText>
        <AppText variant="title">{user?.displayName ?? 'there'}</AppText>
        {user !== null ? <Badge label={user.role} tone="primary" /> : null}
      </View>

      <Card>
        <AppText variant="label" tone="muted">
          Connection
        </AppText>
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <Badge
            label={describeConnectivityStatus(connectivity.status)}
            tone={STATUS_TONES[connectivity.status]}
          />
          <AppText tone="muted">via {connectivity.connectionType}</AppText>
        </View>
      </Card>

      <Card>
        <AppText variant="label" tone="muted">
          {isWorker ? "Today's jobs" : "Team's jobs"}
        </AppText>
        <EmptyState
          title="No jobs yet"
          description={
            isWorker
              ? 'Jobs assigned to you will appear here, even when you are offline.'
              : 'Jobs you assign to your team will appear here.'
          }
          actionLabel="Open Jobs"
          onAction={() => navigation.navigate('Jobs')}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
