import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import type { WorkerSummary } from '@fieldops/types';

import type { JobsScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import { AppText, Badge, Card, Screen } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { toAppError, type AppError } from '../../../utils/errors';
import {
  useAssignJobMutation,
  useGetJobQuery,
  useListWorkersQuery,
} from '../api/jobsApi';
import { fullName } from '../presentation';

/** Managers pick the worker for a job. Tapping a worker assigns (or reassigns) at once. */
export function AssignWorkerScreen({
  navigation,
  route,
}: JobsScreenProps<'AssignWorker'>): React.JSX.Element {
  const { jobId } = route.params;
  const theme = useTheme();
  const { data: job } = useGetJobQuery(jobId);
  const { data: workers, error, isLoading, refetch } = useListWorkersQuery();
  const [assign, { isLoading: assigning }] = useAssignJobMutation();
  const [assigningTo, setAssigningTo] = useState<string | undefined>();
  const [assignError, setAssignError] = useState<AppError | undefined>();
  const currentId = job?.assignedWorker?.id;

  const choose = async (worker: WorkerSummary) => {
    if (assigning) {
      return;
    }
    setAssignError(undefined);
    setAssigningTo(worker.id);
    const result = await assign({ id: jobId, workerId: worker.id });
    setAssigningTo(undefined);
    if (result.error !== undefined) {
      setAssignError(toAppError(result.error));
    } else {
      navigation.goBack();
    }
  };

  let empty: React.JSX.Element;
  if (isLoading) {
    empty = <LoadingState message="Loading workers…" />;
  } else if (error !== undefined) {
    empty = (
      <ErrorState
        title="Couldn't load workers"
        error={error}
        onRetry={() => {
          refetch().catch(() => undefined);
        }}
      />
    );
  } else {
    empty = (
      <EmptyState
        title="No workers yet"
        description="Workers appear here once they have an active FieldOps account."
      />
    );
  }

  return (
    <Screen scroll={false} contentStyle={styles.flush}>
      <FlatList
        data={workers ?? []}
        keyExtractor={worker => worker.id}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md }}>
            {job !== undefined ? (
              <AppText tone="muted">Choose who will do “{job.title}”.</AppText>
            ) : null}
            {assignError !== undefined ? (
              <ErrorState title="Couldn't assign" error={assignError} />
            ) : null}
          </View>
        }
        ListEmptyComponent={empty}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Assign to ${fullName(item)}`}
            accessibilityState={{
              disabled: assigning,
              busy: assigningTo === item.id,
            }}
            disabled={assigning}
            onPress={() => {
              choose(item).catch(() => undefined);
            }}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Card style={[styles.row, { gap: theme.spacing.md }]}>
              <View style={styles.fill}>
                <AppText variant="bodyStrong">{fullName(item)}</AppText>
                <AppText variant="caption" tone="muted">
                  {item.email}
                </AppText>
              </View>
              {assigningTo === item.id ? (
                <Badge label="Assigning…" tone="primary" />
              ) : item.id === currentId ? (
                <Badge label="Current" tone="success" />
              ) : null}
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flush: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
  pressed: { opacity: 0.85 },
});
