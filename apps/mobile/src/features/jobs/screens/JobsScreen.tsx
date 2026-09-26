import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { Role, type JobSummary } from '@fieldops/types';

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
import { useListJobsInfiniteQuery } from '../api/jobsApi';
import { JobCard } from '../components/JobCard';
import { LIST_VIEWS, type JobListView } from '../presentation';

const VIEW_OPTIONS: readonly SegmentedOption<JobListView>[] = [
  { value: 'active', label: 'Active' },
  { value: 'closed', label: 'Done' },
];

const EMPTY: Readonly<
  Record<'worker' | 'manager', Record<JobListView, [string, string]>>
> = {
  worker: {
    active: ['No active jobs', 'Jobs assigned to you appear here.'],
    closed: ['Nothing done yet', 'Completed and cancelled jobs appear here.'],
  },
  manager: {
    active: ['No open jobs', 'Create a job, then assign it to a worker.'],
    closed: ['Nothing closed yet', 'Completed and cancelled jobs appear here.'],
  },
};

/**
 * Workers: the jobs assigned to them. Managers and admins: every job. The server decides
 * which jobs a user gets; the list only chooses the view (active or done).
 */
export function JobsScreen({
  navigation,
}: JobsScreenProps<'JobList'>): React.JSX.Element {
  const theme = useTheme();
  const user = useAppSelector(selectSessionUser);
  // UX only: the API enforces who may create jobs.
  const isManager = user?.role === Role.MANAGER || user?.role === Role.ADMIN;
  const [view, setView] = useState<JobListView>('active');

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

  const openJob = (job: JobSummary) =>
    navigation.navigate('JobDetail', { jobId: job.id });
  const createJob = () => navigation.navigate('JobForm');
  const reload = () => {
    refetch().catch(() => undefined);
  };
  const loadMore = () => {
    if (hasNextPage && !isFetching) {
      fetchNextPage().catch(() => undefined);
    }
  };
  const [emptyTitle, emptyDescription] =
    EMPTY[isManager ? 'manager' : 'worker'][view];

  const header = (
    <View style={{ gap: theme.spacing.md }}>
      <SegmentedControl
        accessibilityLabel="Job list"
        options={VIEW_OPTIONS}
        value={view}
        onChange={setView}
      />
      {isManager ? <Button label="New job" onPress={createJob} /> : null}
      {isError && jobs.length > 0 ? (
        <ErrorState
          title="Couldn't refresh jobs"
          error={error}
          onRetry={reload}
        />
      ) : null}
    </View>
  );

  let empty: React.JSX.Element;
  if (isLoading) {
    empty = <LoadingState message="Loading jobs…" />;
  } else if (isError) {
    empty = (
      <ErrorState title="Couldn't load jobs" error={error} onRetry={reload} />
    );
  } else {
    empty = <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <Screen scroll={false} contentStyle={styles.flush}>
      <FlatList
        data={jobs}
        keyExtractor={job => job.id}
        renderItem={({ item }) => (
          <JobCard job={item} onPress={openJob} showAssignee={isManager} />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : undefined
        }
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading && !isFetchingNextPage}
            onRefresh={reload}
            colors={[theme.colors.primary]}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flush: { padding: 0 },
});
