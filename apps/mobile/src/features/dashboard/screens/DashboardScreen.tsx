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
import { useLocalJobs } from '../../jobs/data/OfflineJobsContext';
import { jobSyncBadge, LIST_VIEWS } from '../../jobs/presentation';

const UP_NEXT = { ...LIST_VIEWS.active, limit: 3 };
const UP_NEXT_COUNT = 3;

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
        {isWorker ? (
          <WorkerUpNext onOpen={openJob} />
        ) : (
          <ManagerUpNext onOpen={openJob} />
        )}
        <Button
          label="Open Jobs"
          variant="secondary"
          onPress={() => navigation.navigate('Jobs', { screen: 'JobList' })}
        />
      </Card>
    </Screen>
  );
}

/** The worker's next jobs, from the phone (works offline). */
function WorkerUpNext({
  onOpen,
}: {
  readonly onOpen: (jobId: string) => void;
}): React.JSX.Element {
  const { data: items, error } = useLocalJobs(UP_NEXT.statuses, UP_NEXT.order);
  if (error !== undefined) {
    return <ErrorState title="Couldn't read your jobs" error={error} />;
  }
  if (items === undefined) {
    return <LoadingState />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="No open jobs"
        description="Jobs assigned to you will appear here, also when you are offline."
      />
    );
  }
  return (
    <>
      {items.slice(0, UP_NEXT_COUNT).map(item => (
        <JobCard
          key={item.job.id}
          job={item.job}
          onPress={() => onOpen(item.job.id)}
          syncBadge={jobSyncBadge(item)}
        />
      ))}
    </>
  );
}

/** The next open jobs of the whole team (online). */
function ManagerUpNext({
  onOpen,
}: {
  readonly onOpen: (jobId: string) => void;
}): React.JSX.Element {
  const upNext = useListJobsInfiniteQuery(UP_NEXT);
  const jobs = upNext.data?.pages[0]?.items ?? [];
  if (upNext.isLoading) {
    return <LoadingState />;
  }
  if (upNext.isError && jobs.length === 0) {
    return (
      <ErrorState
        title="Couldn't load jobs"
        error={upNext.error}
        onRetry={() => {
          upNext.refetch().catch(() => undefined);
        }}
      />
    );
  }
  if (jobs.length === 0) {
    return (
      <EmptyState
        title="No open jobs"
        description="Create a job in the Jobs tab and assign it to a worker."
      />
    );
  }
  return (
    <>
      {jobs.map(job => (
        <JobCard
          key={job.id}
          job={job}
          onPress={() => onOpen(job.id)}
          showAssignee
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
