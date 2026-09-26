import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Role } from '@fieldops/types';

import type { AppTabScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import {
  AppText,
  Badge,
  Button,
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
import { useListJobsInfiniteQuery } from '../../jobs/api/jobsApi';
import { JobCard } from '../../jobs/components/JobCard';
import { LIST_VIEWS } from '../../jobs/presentation';

const UP_NEXT = { ...LIST_VIEWS.active, limit: 3 };

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
  const upNext = useListJobsInfiniteQuery(UP_NEXT);
  const jobs = upNext.data?.pages[0]?.items ?? [];
  const openJob = (jobId: string) =>
    navigation.navigate('Jobs', {
      screen: 'JobDetail',
      params: { jobId },
      // Keep the job list underneath, so Back returns to it.
      initial: false,
    });

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText tone="muted">{greeting(new Date().getHours())},</AppText>
        <AppText variant="title">{user?.firstName ?? 'there'}</AppText>
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
          {isWorker ? 'Up next for you' : 'Up next'}
        </AppText>
        {upNext.isLoading ? <LoadingState /> : null}
        {upNext.isError && jobs.length === 0 ? (
          <ErrorState
            title="Couldn't load jobs"
            error={upNext.error}
            onRetry={() => {
              upNext.refetch().catch(() => undefined);
            }}
          />
        ) : null}
        {!upNext.isLoading && !upNext.isError && jobs.length === 0 ? (
          <EmptyState
            title="No open jobs"
            description={
              isWorker
                ? 'Jobs assigned to you will appear here.'
                : 'Create a job in the Jobs tab and assign it to a worker.'
            }
          />
        ) : null}
        {jobs.map(job => (
          <JobCard
            key={job.id}
            job={job}
            onPress={() => openJob(job.id)}
            showAssignee={!isWorker}
          />
        ))}
        <Button
          label="Open Jobs"
          variant="secondary"
          onPress={() => navigation.navigate('Jobs', { screen: 'JobList' })}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
