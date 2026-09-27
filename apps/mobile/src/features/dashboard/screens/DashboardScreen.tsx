import React from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import type { AppTabScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import {
  AppText,
  Badge,
  Button,
  Card,
  Screen,
  SectionTitle,
  Skeleton,
  type BadgeTone,
  type IconName,
} from '../../../components/ui';
import { useConnectivity } from '../../../hooks/useConnectivity';
import {
  describeConnectivityStatus,
  type ConnectivityStatus,
} from '../../../services/network/connectivity';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';
import { isFieldWorker, isUnaffiliated, ROLE_LABELS } from '../../auth/roles';
import { jobsApi, useGetJobOverviewQuery } from '../../jobs/api/jobsApi';
import { JobCard } from '../../jobs/components/JobCard';
import {
  useLocalJobs,
  useOfflineJobs,
} from '../../jobs/data/OfflineJobsContext';
import { jobSyncBadge, LIST_VIEWS } from '../../jobs/presentation';
import { workerFigures } from '../dashboardMetrics';
import { ManagerDashboard } from '../components/ManagerDashboard';
import { MetricGrid, MetricGridSkeleton } from '../components/MetricTile';

const UP_NEXT_COUNT = 3;

const STATUS_BADGES: Readonly<
  Record<ConnectivityStatus, { tone: BadgeTone; icon: IconName }>
> = {
  online: { tone: 'success', icon: 'wifi' },
  offline: { tone: 'warning', icon: 'cloud-offline-outline' },
  checking: { tone: 'neutral', icon: 'sync-outline' },
  unknown: { tone: 'neutral', icon: 'help-circle-outline' },
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
  const user = useAppSelector(selectSessionUser);
  const openJob = (jobId: string) =>
    navigation.navigate('Jobs', {
      screen: 'JobDetail',
      params: { jobId },
      // Keep the job list underneath, so Back returns to it.
      initial: false,
    });
  const openJobs = () => navigation.navigate('Jobs', { screen: 'JobList' });

  if (isUnaffiliated(user)) {
    // No Operations tab: there is nothing to open until an organization adds the account.
    return <UnaffiliatedHome />;
  }
  return isFieldWorker(user) ? (
    <WorkerHome onOpenJob={openJob} onOpenJobs={openJobs} />
  ) : (
    <ManagerHome onOpenJob={openJob} onOpenJobs={openJobs} />
  );
}

/** A self-registered account no organization has added yet: say what happens next. */
function UnaffiliatedHome(): React.JSX.Element {
  const theme = useTheme();
  const user = useAppSelector(selectSessionUser);
  return (
    <Screen>
      <DashboardHeader />
      <Card>
        <EmptyState
          icon="business-outline"
          title="You're not part of an organization yet"
          description={
            'Ask your organization admin to add you as a member, using the email ' +
            `${
              user?.email ?? 'you signed up with'
            }. Once they have, sign out and back in ` +
            'to see your operations.'
          }
        />
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="caption" tone="muted">
            Nothing is shared with any organization until you are added.
          </AppText>
        </View>
      </Card>
    </Screen>
  );
}

interface HomeProps {
  readonly onOpenJob: (jobId: string) => void;
  readonly onOpenJobs: () => void;
}

/** Greeting, role and connection: the same on every dashboard. */
function DashboardHeader(): React.JSX.Element {
  const theme = useTheme();
  const user = useAppSelector(selectSessionUser);
  const connectivity = useConnectivity();
  const status = STATUS_BADGES[connectivity.status];
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View>
        <AppText tone="muted">{greeting(new Date().getHours())},</AppText>
        <AppText variant="title">{user?.firstName ?? 'there'}</AppText>
      </View>
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        {user !== null ? (
          <Badge
            label={ROLE_LABELS[user.role]}
            tone="primary"
            icon="shield-outline"
          />
        ) : null}
        <Badge
          label={describeConnectivityStatus(connectivity.status)}
          tone={status.tone}
          icon={status.icon}
        />
      </View>
    </View>
  );
}

/** Managers and admins: the team overview, online. Pulling down refreshes every section. */
function ManagerHome({ onOpenJob, onOpenJobs }: HomeProps): React.JSX.Element {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const { data, error, isLoading, isFetching, refetch } =
    useGetJobOverviewQuery();

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={() => {
            // The overview and the job lists share the list tag.
            dispatch(
              jobsApi.util.invalidateTags([{ type: 'Job', id: 'LIST' }]),
            );
          }}
          colors={[theme.colors.primary]}
        />
      }
    >
      <DashboardHeader />
      <ManagerDashboard
        overview={data}
        error={error}
        loading={isLoading}
        onRetry={() => {
          refetch().catch(() => undefined);
        }}
        onOpenJob={onOpenJob}
        onOpenJobs={onOpenJobs}
      />
    </Screen>
  );
}

/** Workers: their own figures and next jobs, from the phone (works offline). */
function WorkerHome({ onOpenJob, onOpenJobs }: HomeProps): React.JSX.Element {
  const theme = useTheme();
  const offline = useOfflineJobs();
  const active = useLocalJobs(
    LIST_VIEWS.active.statuses,
    LIST_VIEWS.active.order,
  );
  const closed = useLocalJobs(
    LIST_VIEWS.closed.statuses,
    LIST_VIEWS.closed.order,
  );
  const syncing = offline?.status.phase === 'syncing';
  const error = active.error ?? closed.error;
  const figures =
    active.data !== undefined && closed.data !== undefined
      ? workerFigures(active.data, closed.data)
      : undefined;

  let upNext: React.ReactNode;
  if (active.error !== undefined) {
    // Reported once, under "My work".
    upNext = null;
  } else if (active.data === undefined) {
    upNext = (
      <View style={{ gap: theme.spacing.sm }}>
        <Skeleton height={72} radius="md" />
        <Skeleton height={72} radius="md" />
      </View>
    );
  } else if (active.data.length === 0) {
    upNext = (
      <EmptyState
        icon="briefcase-outline"
        title="No open jobs"
        description="Jobs assigned to you will appear here, also when you are offline."
      />
    );
  } else {
    upNext = active.data
      .slice(0, UP_NEXT_COUNT)
      .map(item => (
        <JobCard
          key={item.job.id}
          job={item.job}
          onPress={() => onOpenJob(item.job.id)}
          syncBadge={jobSyncBadge(item)}
          dense
        />
      ));
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={syncing}
          onRefresh={() => {
            offline?.engine.sync().catch(() => undefined);
          }}
          colors={[theme.colors.primary]}
        />
      }
    >
      <DashboardHeader />

      <View style={{ gap: theme.spacing.md }}>
        <SectionTitle title="My work" icon="stats-chart-outline" />
        {error !== undefined ? (
          <ErrorState title="Couldn't read your jobs" error={error} />
        ) : figures === undefined ? (
          <MetricGridSkeleton count={4} />
        ) : (
          <MetricGrid
            metrics={[
              {
                label: 'Open jobs',
                value: String(figures.open),
                icon: 'briefcase-outline',
                tone: 'primary',
              },
              {
                label: 'In progress',
                value: String(figures.inProgress),
                icon: 'play-circle-outline',
                tone: 'info',
              },
              {
                label: 'To verify',
                value: String(figures.awaitingVerification),
                icon: 'hourglass-outline',
                tone: 'warning',
                caption: 'Submitted, with your manager',
              },
              {
                label: 'Completed',
                value: String(figures.completedRecently),
                icon: 'checkmark-circle-outline',
                tone: 'success',
                caption: 'Last 7 days',
              },
            ]}
          />
        )}
      </View>

      <Card>
        <SectionTitle
          title="Up next for you"
          icon="calendar-outline"
          accessory={
            <Button
              label="All jobs"
              variant="ghost"
              size="sm"
              onPress={onOpenJobs}
            />
          }
        />
        {upNext}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});
