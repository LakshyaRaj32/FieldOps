import React, { useState } from 'react';
import { Alert, RefreshControl, StyleSheet, View } from 'react-native';
import { JobAction, Role, type JobDetail } from '@fieldops/types';

import type { JobsScreenProps } from '../../../app/navigation/types';
import { ErrorState } from '../../../components/common/ErrorState';
import { InfoRow } from '../../../components/common/InfoRow';
import { LoadingState } from '../../../components/common/LoadingState';
import { AppText, Button, Card, Screen } from '../../../components/ui';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';
import { toAppError, type AppError } from '../../../utils/errors';
import {
  useCancelJobMutation,
  useCompleteJobMutation,
  useDeleteJobMutation,
  useGetJobQuery,
  useStartJobMutation,
} from '../api/jobsApi';
import { JobPriorityBadge, JobStatusBadge } from '../components/JobBadges';
import {
  describeHistoryEntry,
  formatSchedule,
  fullName,
  jobCommands,
  PRIORITY_LABELS,
  type JobCommand,
} from '../presentation';

/**
 * Everything about one job, plus the commands the signed-in user may run on it now. The
 * buttons come from the server's `allowedActions`, so a worker sees "Start job" only on an
 * assigned job of theirs and "Complete job" only once it is in progress.
 */
export function JobDetailScreen({
  navigation,
  route,
}: JobsScreenProps<'JobDetail'>): React.JSX.Element {
  const { jobId } = route.params;
  const theme = useTheme();
  const isWorker = useAppSelector(selectSessionUser)?.role === Role.WORKER;
  const {
    data: job,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useGetJobQuery(jobId);

  const [start, startState] = useStartJobMutation();
  const [complete, completeState] = useCompleteJobMutation();
  const [cancel, cancelState] = useCancelJobMutation();
  const [remove, removeState] = useDeleteJobMutation();
  const [commandError, setCommandError] = useState<AppError | undefined>();
  const busy =
    startState.isLoading ||
    completeState.isLoading ||
    cancelState.isLoading ||
    removeState.isLoading;

  const refresh = () => {
    setCommandError(undefined);
    refetch().catch(() => undefined);
  };

  if (job === undefined) {
    return (
      <Screen contentStyle={styles.centered}>
        {isLoading ? (
          <LoadingState message="Loading job…" />
        ) : (
          <ErrorState
            title="Couldn't load this job"
            error={error}
            onRetry={refresh}
          />
        )}
      </Screen>
    );
  }

  const execute = async (command: JobCommand) => {
    setCommandError(undefined);
    let result: { error?: unknown } | undefined;
    switch (command.action) {
      case JobAction.START:
        result = await start(job.id);
        break;
      case JobAction.COMPLETE:
        result = await complete(job.id);
        break;
      case JobAction.CANCEL:
        result = await cancel({ id: job.id });
        break;
      case JobAction.DELETE:
        result = await remove(job.id);
        if (result.error === undefined) {
          navigation.goBack();
          return;
        }
        break;
      case JobAction.ASSIGN:
        navigation.navigate('AssignWorker', { jobId: job.id });
        return;
      case JobAction.EDIT:
        navigation.navigate('JobForm', { jobId: job.id });
        return;
    }
    if (result.error !== undefined) {
      setCommandError(toAppError(result.error));
    }
  };

  const run = (command: JobCommand) => {
    const { confirm } = command;
    if (confirm === undefined) {
      execute(command).catch(() => undefined);
      return;
    }
    Alert.alert(confirm.title, confirm.message, [
      { text: 'Back', style: 'cancel' },
      {
        text: confirm.confirmLabel,
        style: command.variant === 'danger' ? 'destructive' : 'default',
        onPress: () => {
          execute(command).catch(() => undefined);
        },
      },
    ]);
  };

  const commands = jobCommands(job);

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading && !busy}
          onRefresh={refresh}
          colors={[theme.colors.primary]}
        />
      }
    >
      <View style={{ gap: theme.spacing.sm }}>
        <AppText variant="title">{job.title}</AppText>
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <JobStatusBadge status={job.status} />
          <JobPriorityBadge priority={job.priority} />
        </View>
      </View>

      {commands.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          {commands.map(command => (
            <Button
              key={command.action}
              label={command.label}
              variant={command.variant}
              onPress={() => run(command)}
              disabled={busy}
              loading={
                (command.action === JobAction.START && startState.isLoading) ||
                (command.action === JobAction.COMPLETE &&
                  completeState.isLoading) ||
                (command.action === JobAction.CANCEL &&
                  cancelState.isLoading) ||
                (command.action === JobAction.DELETE && removeState.isLoading)
              }
            />
          ))}
        </View>
      ) : null}

      {commandError !== undefined ? (
        <ErrorState title="That didn't work" error={commandError} />
      ) : null}

      <JobInformation job={job} showAssignee={!isWorker} />

      {job.checklist.length > 0 ? (
        <Card>
          <AppText variant="label" tone="muted">
            Checklist
          </AppText>
          {job.checklist.map(item => (
            <AppText key={item.id}>
              {item.position + 1}. {item.label}
            </AppText>
          ))}
        </Card>
      ) : null}

      <Card>
        <AppText variant="label" tone="muted">
          History
        </AppText>
        {job.history.map(entry => (
          <InfoRow
            key={entry.id}
            label={formatSchedule(entry.createdAt)}
            value={describeHistoryEntry(entry)}
          />
        ))}
      </Card>
    </Screen>
  );
}

function JobInformation({
  job,
  showAssignee,
}: {
  readonly job: JobDetail;
  readonly showAssignee: boolean;
}): React.JSX.Element {
  return (
    <Card>
      <AppText variant="label" tone="muted">
        Details
      </AppText>
      <InfoRow label="Scheduled" value={formatSchedule(job.scheduledAt)} />
      <InfoRow label="Customer" value={job.customerName} />
      <InfoRow label="Address" value={job.address} />
      {job.location !== null ? (
        <InfoRow
          label="Coordinates"
          value={`${job.location.latitude.toFixed(
            5,
          )}, ${job.location.longitude.toFixed(5)}`}
        />
      ) : null}
      <InfoRow label="Priority" value={PRIORITY_LABELS[job.priority]} />
      {showAssignee ? (
        <InfoRow
          label="Assigned to"
          value={
            job.assignedWorker === null
              ? 'Nobody yet'
              : fullName(job.assignedWorker)
          }
        />
      ) : null}
      {job.description !== null ? (
        <InfoRow label="Description" value={job.description} />
      ) : null}
      {job.notes !== null ? <InfoRow label="Notes" value={job.notes} /> : null}
      {job.cancellationReason !== null ? (
        <InfoRow label="Cancellation reason" value={job.cancellationReason} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});
