import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  JobEventType,
  JobStatus,
  type JobActivity,
  type JobOverview,
  type WorkerWorkload,
} from '@fieldops/types';

import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import {
  AppText,
  badgeColors,
  Button,
  Card,
  Icon,
  SectionTitle,
  Skeleton,
  type BadgeTone,
  type IconName,
} from '../../../components/ui';
import { useTheme } from '../../../theme';
import { formatRelativeTime, formatTimeLabel } from '../../../utils/dateFormat';
import { useListJobsInfiniteQuery } from '../../jobs/api/jobsApi';
import { JobCard } from '../../jobs/components/JobCard';
import {
  describeHistoryEntry,
  fullName,
  LIST_VIEWS,
  money,
} from '../../jobs/presentation';
import {
  completionRate,
  formatPercent,
  openJobs,
  underWay,
  waiting,
} from '../dashboardMetrics';
import { MetricGrid, MetricGridSkeleton, type Metric } from './MetricTile';
import { StatusBreakdown } from './StatusBreakdown';

const UNASSIGNED = {
  statuses: [JobStatus.PENDING],
  order: 'asc',
  limit: 3,
} as const;
const UP_NEXT = { ...LIST_VIEWS.active, limit: 3 };

const ACTIVITY_ICONS: Readonly<
  Record<JobEventType, { icon: IconName; tone: BadgeTone }>
> = {
  [JobEventType.CREATED]: { icon: 'add-circle-outline', tone: 'neutral' },
  [JobEventType.ASSIGNED]: { icon: 'person-add-outline', tone: 'info' },
  [JobEventType.ACCEPTED]: { icon: 'thumbs-up-outline', tone: 'info' },
  [JobEventType.DECLINED]: {
    icon: 'return-down-back-outline',
    tone: 'warning',
  },
  [JobEventType.DEPARTED]: { icon: 'navigate-outline', tone: 'primary' },
  [JobEventType.ARRIVED]: { icon: 'location-outline', tone: 'primary' },
  [JobEventType.STARTED]: { icon: 'play-circle-outline', tone: 'primary' },
  [JobEventType.SUBMITTED]: { icon: 'cloud-upload-outline', tone: 'warning' },
  [JobEventType.VERIFIED]: {
    icon: 'shield-checkmark-outline',
    tone: 'success',
  },
  [JobEventType.REJECTED]: { icon: 'arrow-undo-outline', tone: 'danger' },
  [JobEventType.COMPLETED]: {
    icon: 'checkmark-circle-outline',
    tone: 'success',
  },
  [JobEventType.FAILED]: { icon: 'alert-circle-outline', tone: 'danger' },
  [JobEventType.CANCELLED]: { icon: 'close-circle-outline', tone: 'danger' },
  [JobEventType.RESCHEDULED]: { icon: 'calendar-outline', tone: 'info' },
};

/** The operations figures, all from the server's counts. */
export function overviewMetrics(overview: JobOverview): Metric[] {
  const counts = overview.statusCounts;
  const rate = completionRate(
    overview.completedLast7Days,
    overview.cancelledLast7Days,
    overview.failedLast7Days,
  );
  return [
    {
      label: 'Open',
      value: String(openJobs(counts)),
      icon: 'briefcase-outline',
      tone: 'primary',
      caption: `${counts.PENDING} unassigned · ${waiting(counts)} assigned`,
    },
    {
      label: 'Under way',
      value: String(underWay(counts)),
      icon: 'navigate-outline',
      tone: 'info',
      caption: 'On the way, at the shop or working',
    },
    {
      label: 'To verify',
      value: String(overview.awaitingVerification),
      icon: 'shield-checkmark-outline',
      tone: overview.awaitingVerification > 0 ? 'warning' : 'neutral',
      caption: 'Submitted results',
    },
    {
      label: 'Overdue',
      value: String(overview.overdue),
      icon: 'alarm-outline',
      tone: overview.overdue > 0 ? 'danger' : 'neutral',
      caption: `${overview.dueNext24Hours} due in 24 hours`,
    },
    {
      label: 'Completed',
      value: String(overview.completedLast7Days),
      icon: 'checkmark-circle-outline',
      tone: 'success',
      caption: `Last 7 days · ${formatPercent(rate)} of closed`,
    },
    {
      label: 'Failed',
      value: String(overview.failedLast7Days),
      icon: 'alert-circle-outline',
      tone: overview.failedLast7Days > 0 ? 'danger' : 'neutral',
      caption: 'Last 7 days',
    },
  ];
}

/** Money in scope, formatted in the organization's currency. */
export function collectionMetrics(overview: JobOverview): Metric[] {
  const { collections } = overview;
  const amount = (value: number) => money(value, collections.currency);
  return [
    {
      label: 'Outstanding',
      value: amount(collections.outstanding),
      icon: 'wallet-outline',
      tone: 'primary',
      caption: 'Unpaid on open orders',
    },
    {
      label: 'Overdue',
      value: amount(collections.overdue),
      icon: 'alarm-outline',
      tone: collections.overdue > 0 ? 'danger' : 'neutral',
      caption: 'Past the due date',
    },
    {
      label: 'Due today',
      value: amount(collections.dueToday),
      icon: 'today-outline',
      tone: 'warning',
    },
    {
      label: 'Collected today',
      value: amount(collections.collectedToday),
      icon: 'cash-outline',
      tone: 'success',
      caption: 'Verified payments',
    },
    {
      label: 'To verify',
      value: amount(collections.pendingVerification),
      icon: 'hourglass-outline',
      tone: collections.pendingVerification > 0 ? 'warning' : 'neutral',
      caption: 'Collected, not verified',
    },
  ];
}

/** The team and shop coverage. */
export function teamMetrics(overview: JobOverview): Metric[] {
  const { workers, shops } = overview;
  return [
    {
      label: 'Workers',
      value: String(workers.total),
      icon: 'people-outline',
      tone: 'primary',
      caption: `${workers.online} online now`,
    },
    {
      label: 'Available',
      value: String(workers.available),
      icon: 'person-outline',
      tone: 'success',
      caption: `${workers.busy} busy`,
    },
    {
      label: 'Shops',
      value: String(shops.total),
      icon: 'storefront-outline',
      tone: 'primary',
      caption: `${shops.visitedToday} visited today`,
    },
    {
      label: 'Pending visits',
      value: String(shops.pendingVisits),
      icon: 'walk-outline',
      tone: shops.pendingVisits > 0 ? 'warning' : 'neutral',
      caption: 'Open shop visits',
    },
  ];
}

/**
 * The manager's and admin's dashboard (online): what needs attention now and how the team is
 * doing. Every figure comes from GET /jobs/overview or the job list; nothing is estimated.
 */
export function ManagerDashboard({
  overview,
  error,
  loading,
  onRetry,
  onOpenJob,
  onOpenJobs,
}: {
  readonly overview: JobOverview | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  readonly onRetry: () => void;
  readonly onOpenJob: (jobId: string) => void;
  readonly onOpenJobs: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <>
      <View style={{ gap: theme.spacing.md }}>
        <SectionTitle
          title="Overview"
          icon="stats-chart-outline"
          {...(overview !== undefined && {
            accessory: (
              <AppText variant="caption" tone="muted">
                Updated {formatTimeLabel(new Date(overview.generatedAt))}
              </AppText>
            ),
          })}
        />
        {overview !== undefined ? (
          <MetricGrid metrics={overviewMetrics(overview)} />
        ) : loading ? (
          <MetricGridSkeleton count={6} />
        ) : (
          <ErrorState
            title="Couldn't load the overview"
            error={error}
            onRetry={onRetry}
          />
        )}
      </View>

      {overview !== undefined ? (
        <>
          <View style={{ gap: theme.spacing.md }}>
            <SectionTitle title="Collections" icon="wallet-outline" />
            <MetricGrid metrics={collectionMetrics(overview)} />
          </View>
          <View style={{ gap: theme.spacing.md }}>
            <SectionTitle
              title={
                overview.scope === 'team'
                  ? 'My team and shops'
                  : 'Team and shops'
              }
              icon="people-outline"
            />
            <MetricGrid metrics={teamMetrics(overview)} />
          </View>
        </>
      ) : null}

      {overview !== undefined ? (
        <StatusBreakdown counts={overview.statusCounts} />
      ) : null}

      {overview === undefined || overview.statusCounts.PENDING > 0 ? (
        <JobListCard
          title="Needs a worker"
          icon="person-add-outline"
          args={UNASSIGNED}
          emptyTitle="Every operation has a worker"
          onOpenJob={onOpenJob}
          onOpenJobs={onOpenJobs}
        />
      ) : null}

      <JobListCard
        title="Up next"
        icon="calendar-outline"
        args={UP_NEXT}
        emptyTitle="No open operations"
        emptyDescription="Create an operation in the Operations tab and assign it to a worker."
        onOpenJob={onOpenJob}
        onOpenJobs={onOpenJobs}
      />

      {overview !== undefined ? (
        <>
          <WorkloadCard workload={overview.workload} />
          <ActivityCard
            activity={overview.recentActivity}
            onOpenJob={onOpenJob}
          />
        </>
      ) : null}
    </>
  );
}

/** A short job list from the job API (up to three), with a way to the full list. */
function JobListCard({
  title,
  icon,
  args,
  emptyTitle,
  emptyDescription,
  onOpenJob,
  onOpenJobs,
}: {
  readonly title: string;
  readonly icon: IconName;
  readonly args: Parameters<typeof useListJobsInfiniteQuery>[0];
  readonly emptyTitle: string;
  readonly emptyDescription?: string;
  readonly onOpenJob: (jobId: string) => void;
  readonly onOpenJobs: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const query = useListJobsInfiniteQuery(args);
  const jobs = query.data?.pages[0]?.items ?? [];

  let body: React.ReactNode;
  if (query.isLoading) {
    body = (
      <View style={{ gap: theme.spacing.sm }}>
        <Skeleton height={56} radius="md" />
        <Skeleton height={56} radius="md" />
      </View>
    );
  } else if (query.isError && jobs.length === 0) {
    body = (
      <ErrorState
        title="Couldn't load jobs"
        error={query.error}
        onRetry={() => {
          query.refetch().catch(() => undefined);
        }}
      />
    );
  } else if (jobs.length === 0) {
    body = (
      <EmptyState
        icon="checkmark-done-outline"
        title={emptyTitle}
        {...(emptyDescription !== undefined && {
          description: emptyDescription,
        })}
      />
    );
  } else {
    body = jobs.map(job => (
      <JobCard
        key={job.id}
        job={job}
        onPress={() => onOpenJob(job.id)}
        showAssignee
        dense
      />
    ));
  }

  return (
    <Card>
      <SectionTitle
        title={title}
        icon={icon}
        accessory={
          <Button label="All" variant="ghost" size="sm" onPress={onOpenJobs} />
        }
      />
      {body}
    </Card>
  );
}

/** Open jobs per worker, busiest first, as bars on a shared scale. */
function WorkloadCard({
  workload,
}: {
  readonly workload: readonly WorkerWorkload[];
}): React.JSX.Element {
  const theme = useTheme();
  const max = Math.max(
    1,
    ...workload.map(entry => entry.assigned + entry.inProgress),
  );
  return (
    <Card>
      <SectionTitle title="Team workload" icon="people-outline" />
      {workload.length === 0 ? (
        <AppText tone="muted">No worker has open operations right now.</AppText>
      ) : (
        workload.map(entry => {
          return (
            <View
              key={entry.worker.id}
              accessible
              accessibilityLabel={`${fullName(entry.worker)}: ${
                entry.assigned
              } assigned, ${entry.inProgress} in progress`}
              style={{ gap: theme.spacing.xs }}
            >
              <View style={[styles.row, { gap: theme.spacing.sm }]}>
                <AppText
                  variant="bodyStrong"
                  numberOfLines={1}
                  style={styles.fill}
                >
                  {fullName(entry.worker)}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {entry.assigned} assigned · {entry.inProgress} in progress
                </AppText>
              </View>
              <View
                style={[
                  styles.track,
                  {
                    borderRadius: theme.radii.pill,
                    backgroundColor: theme.colors.surfaceMuted,
                  },
                ]}
              >
                {entry.inProgress > 0 ? (
                  <View
                    style={{
                      width: `${(entry.inProgress / max) * 100}%`,
                      backgroundColor: theme.chart.inProgress,
                    }}
                  />
                ) : null}
                {entry.assigned > 0 ? (
                  <View
                    style={{
                      width: `${(entry.assigned / max) * 100}%`,
                      backgroundColor: theme.chart.assigned,
                    }}
                  />
                ) : null}
              </View>
            </View>
          );
        })
      )}
      {workload.length > 0 ? (
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <LegendKey color={theme.chart.inProgress} label="In progress" />
          <LegendKey color={theme.chart.assigned} label="Assigned" />
        </View>
      ) : null}
    </Card>
  );
}

function LegendKey({
  color,
  label,
}: {
  readonly color: string;
  readonly label: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={[styles.row, { gap: theme.spacing.xs }]}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

/** The latest job history entries across the team; each opens its job. */
function ActivityCard({
  activity,
  onOpenJob,
}: {
  readonly activity: readonly JobActivity[];
  readonly onOpenJob: (jobId: string) => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Card>
      <SectionTitle title="Recent activity" icon="pulse-outline" />
      {activity.length === 0 ? (
        <AppText tone="muted">
          Every step of your operations (assigned, accepted, arrived, submitted,
          verified) appears here.
        </AppText>
      ) : (
        activity.map(entry => {
          const kind = ACTIVITY_ICONS[entry.type];
          const colors = badgeColors(theme, kind.tone);
          const time = formatRelativeTime(entry.createdAt);
          const what = describeHistoryEntry(entry);
          return (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={`${entry.jobTitle}: ${what}, ${time}`}
              accessibilityHint="Opens the job"
              onPress={() => onOpenJob(entry.jobId)}
              style={({ pressed }) => [
                styles.activity,
                {
                  gap: theme.spacing.md,
                  borderRadius: theme.radii.md,
                  backgroundColor: pressed
                    ? theme.colors.surfaceMuted
                    : 'transparent',
                },
              ]}
            >
              <View
                style={[
                  styles.activityIcon,
                  {
                    borderRadius: theme.radii.pill,
                    backgroundColor: colors.background,
                  },
                ]}
              >
                <Icon name={kind.icon} size="sm" color={colors.text} />
              </View>
              <View style={styles.fill}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {entry.jobTitle}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  {what}
                </AppText>
              </View>
              <AppText variant="caption" tone="muted">
                {time}
              </AppText>
            </Pressable>
          );
        })
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
  track: { flexDirection: 'row', height: 8, overflow: 'hidden', gap: 2 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  activity: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 4,
  },
  activityIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
