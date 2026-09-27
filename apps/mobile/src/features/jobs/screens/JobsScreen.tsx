import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import type { JobSummary } from '@fieldops/types';

import type { JobsScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import {
  Button,
  Screen,
  SegmentedControl,
  type SegmentedOption,
} from '../../../components/ui';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';
import { isStaff } from '../../auth/roles';
import { useListJobsInfiniteQuery } from '../api/jobsApi';
import { JobCard } from '../components/JobCard';
import { useLocalJobs, useOfflineJobs } from '../data/OfflineJobsContext';
import { jobSyncBadge, LIST_VIEWS, type JobListView } from '../presentation';

const VIEW_OPTIONS: readonly SegmentedOption<JobListView>[] = [
  { value: 'active', label: 'Active' },
  { value: 'closed', label: 'Done' },
];

const EMPTY: Readonly<
  Record<'worker' | 'manager', Record<JobListView, [string, string]>>
> = {
  worker: {
    active: [
      'Nothing assigned to you',
      'Operations assigned to you appear here and stay available offline.',
    ],
    closed: [
      'Nothing done yet',
      'Operations you completed, or that were cancelled or failed, in the last 7 days.',
    ],
  },
  manager: {
    active: [
      'No open operations',
      'Create an operation, then assign it to a worker.',
    ],
    closed: [
      'Nothing closed yet',
      'Completed, cancelled and failed operations appear here.',
    ],
  },
};

/**
 * Workers: their jobs from the phone's database, so the list opens instantly and works
 * offline; pulling down syncs. Managers and admins: every job, online (manager screens
 * are online-only by design, see docs/offline-first.md).
 */
export function JobsScreen({
  navigation,
}: JobsScreenProps<'JobList'>): React.JSX.Element {
  const theme = useTheme();
  const [view, setView] = useState<JobListView>('active');
  const isManager = isStaff(useAppSelector(selectSessionUser));
  const openJob = (job: JobSummary) =>
    navigation.navigate('JobDetail', { jobId: job.id });

  const header = (extra?: React.ReactNode) => (
    <View style={{ gap: theme.spacing.md }}>
      <SegmentedControl
        accessibilityLabel="Job list"
        options={VIEW_OPTIONS}
        value={view}
        onChange={setView}
      />
      {/* UX only: the API enforces who may create jobs. */}
      {isManager ? (
        <Button
          label="New operation"
          icon="add-circle-outline"
          onPress={() => navigation.navigate('JobForm')}
        />
      ) : null}
      {extra}
    </View>
  );

  return (
    <Screen scroll={false} contentStyle={styles.flush}>
      {isManager ? (
        <ManagerJobList view={view} header={header} onOpen={openJob} />
      ) : (
        <WorkerJobList view={view} header={header} onOpen={openJob} />
      )}
    </Screen>
  );
}

interface ListProps {
  readonly view: JobListView;
  readonly header: (extra?: React.ReactNode) => React.JSX.Element;
  readonly onOpen: (job: JobSummary) => void;
}

function useListStyle() {
  const theme = useTheme();
  return { padding: theme.spacing.lg, gap: theme.spacing.md };
}

function WorkerJobList({ view, header, onOpen }: ListProps): React.JSX.Element {
  const theme = useTheme();
  const contentStyle = useListStyle();
  const offline = useOfflineJobs();
  const { statuses, order } = LIST_VIEWS[view];
  const { data: items, error } = useLocalJobs(statuses, order);
  const syncing = offline?.status.phase === 'syncing';
  const neverSynced = offline?.status.lastSyncedAt === null;

  let empty: React.JSX.Element;
  if (error !== undefined) {
    empty = <ErrorState title="Couldn't read your jobs" error={error} />;
  } else if (items === undefined || (neverSynced && syncing)) {
    empty = <LoadingState message="Getting your jobs…" />;
  } else {
    const [title, description] = EMPTY.worker[view];
    empty = (
      <EmptyState
        icon={
          view === 'active' ? 'briefcase-outline' : 'checkmark-done-outline'
        }
        title={title}
        description={description}
      />
    );
  }

  return (
    <FlatList
      data={items ?? []}
      keyExtractor={item => item.job.id}
      renderItem={({ item }) => (
        <JobCard
          job={item.job}
          onPress={onOpen}
          syncBadge={jobSyncBadge(item)}
        />
      )}
      ListHeaderComponent={header()}
      ListEmptyComponent={empty}
      contentContainerStyle={contentStyle}
      refreshControl={
        <RefreshControl
          refreshing={syncing && items !== undefined && items.length > 0}
          onRefresh={() => {
            offline?.engine.sync().catch(() => undefined);
          }}
          colors={[theme.colors.primary]}
        />
      }
    />
  );
}

function ManagerJobList({
  view,
  header,
  onOpen,
}: ListProps): React.JSX.Element {
  const theme = useTheme();
  const contentStyle = useListStyle();
  const {
    data,
    error,
    isLoading,
    isFetching,
    isFetchingNextPage,
    isError,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useListJobsInfiniteQuery(LIST_VIEWS[view]);
  const jobs = data?.pages.flatMap(page => page.items) ?? [];
  const reload = () => {
    refetch().catch(() => undefined);
  };

  let empty: React.JSX.Element;
  if (isLoading) {
    empty = <LoadingState message="Loading jobs…" />;
  } else if (isError) {
    empty = (
      <ErrorState title="Couldn't load jobs" error={error} onRetry={reload} />
    );
  } else {
    const [title, description] = EMPTY.manager[view];
    empty = (
      <EmptyState
        icon={
          view === 'active' ? 'briefcase-outline' : 'checkmark-done-outline'
        }
        title={title}
        description={description}
      />
    );
  }

  return (
    <FlatList
      data={jobs}
      keyExtractor={job => job.id}
      renderItem={({ item }) => (
        <JobCard job={item} onPress={onOpen} showAssignee />
      )}
      ListHeaderComponent={header(
        isError && jobs.length > 0 ? (
          <ErrorState
            title="Couldn't refresh jobs"
            error={error}
            onRetry={reload}
          />
        ) : null,
      )}
      ListEmptyComponent={empty}
      ListFooterComponent={
        isFetchingNextPage ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : undefined
      }
      contentContainerStyle={contentStyle}
      onEndReached={() => {
        if (hasNextPage && !isFetching) {
          fetchNextPage().catch(() => undefined);
        }
      }}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading && !isFetchingNextPage}
          onRefresh={reload}
          colors={[theme.colors.primary]}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  flush: { padding: 0 },
});
