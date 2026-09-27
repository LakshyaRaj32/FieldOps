import React, { useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { JobAction, JobStatus } from '@fieldops/types';

import { DateTimeField } from '../../../components/common/DateTimeField';
import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import {
  ReasonPrompt,
  type ReasonRequest,
} from '../../../components/common/ReasonPrompt';
import {
  AppText,
  Button,
  Card,
  Screen,
  SectionTitle,
  TextField,
} from '../../../components/ui';
import { useAppSelector } from '../../../store/hooks';
import { selectSessionUser } from '../../../store/slices/sessionSlice';
import { useTheme } from '../../../theme';
import { toAppError, type AppError } from '../../../utils/errors';
import { uuidv7 } from '../../../utils/uuid';
import { currencyOf } from '../../auth/roles';
import {
  useCancelJobMutation,
  useDeleteJobMutation,
  useGetJobQuery,
  useRejectJobMutation,
  useRescheduleJobMutation,
  useSendJobMessageMutation,
  useVerifyJobMutation,
} from '../api/jobsApi';
import {
  formatSchedule,
  fullName,
  jobCommands,
  type JobCommand,
} from '../presentation';
import { serverEvidenceSource } from './evidenceSource';
import {
  EvidenceGallery,
  JobMessages,
  JobSiteCard,
  JobVisitLocations,
} from './FieldOperationSections';
import { MessageComposer } from './MessageComposer';
import {
  confirmThen,
  JobChecklist,
  JobCommandButtons,
  JobFieldNotes,
  JobHeader,
  JobHistory,
  JobInformation,
} from './JobDetailSections';
import { JobLines, JobPayments, OperationSummary } from './OperationSections';

/**
 * The staff's view of an operation: online, with the actions the server allows them
 * (verify or send back a submitted result, assign, reschedule, edit, cancel, delete), what
 * the worker reported (answers, counts, payment), photos and visit positions, and the
 * conversation. Realtime events refetch it (app/providers/RealtimeConnection).
 */
export function ManagerJobDetail({
  jobId,
  onAssign,
  onEdit,
  onDeleted,
}: {
  readonly jobId: string;
  readonly onAssign: () => void;
  readonly onEdit: () => void;
  readonly onDeleted: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const {
    data: job,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useGetJobQuery(jobId);
  const currency = currencyOf(useAppSelector(selectSessionUser));
  const [cancel, cancelState] = useCancelJobMutation();
  const [remove, removeState] = useDeleteJobMutation();
  const [verify, verifyState] = useVerifyJobMutation();
  const [reject, rejectState] = useRejectJobMutation();
  const [reschedule, rescheduleState] = useRescheduleJobMutation();
  const [sendMessage, messageState] = useSendJobMessageMutation();
  const [commandError, setCommandError] = useState<AppError | undefined>();
  const [messageError, setMessageError] = useState<AppError | undefined>();
  const [reasonFor, setReasonFor] = useState<JobCommand | null>(null);
  const [newTime, setNewTime] = useState<Date | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState('');
  const busy =
    cancelState.isLoading ||
    removeState.isLoading ||
    verifyState.isLoading ||
    rejectState.isLoading ||
    rescheduleState.isLoading;

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

  const report = (result: { error?: unknown }) => {
    if (result.error !== undefined) {
      setCommandError(toAppError(result.error));
    }
  };

  const execute = async (command: JobCommand, reason?: string) => {
    setCommandError(undefined);
    if (command.reason !== undefined && reason === undefined) {
      setReasonFor(command);
      return;
    }
    switch (command.action) {
      case JobAction.VERIFY:
        report(await verify({ id: job.id }));
        return;
      case JobAction.REJECT:
        report(await reject({ id: job.id, reason: reason ?? '' }));
        return;
      case JobAction.RESCHEDULE:
        setRescheduleReason('');
        setNewTime(new Date(job.scheduledAt));
        return;
      case JobAction.ASSIGN:
        onAssign();
        return;
      case JobAction.EDIT:
        onEdit();
        return;
      case JobAction.CANCEL: {
        const result = await cancel({ id: job.id });
        if (result.error !== undefined) {
          setCommandError(toAppError(result.error));
        }
        return;
      }
      case JobAction.DELETE: {
        const result = await remove(job.id);
        if (result.error !== undefined) {
          setCommandError(toAppError(result.error));
        } else {
          onDeleted();
        }
        return;
      }
      default:
        // Worker actions never appear for managers (the server does not allow them).
        return;
    }
  };

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
      <JobHeader job={job} />
      {job.status === JobStatus.SUBMITTED &&
      job.allowedActions.includes(JobAction.VERIFY) ? (
        <AppText tone="warning">
          The worker submitted this result. Check it below, then verify it or
          send it back.
        </AppText>
      ) : null}
      <JobCommandButtons
        commands={jobCommands(job)}
        busy={busy}
        onRun={command =>
          confirmThen(command, () => {
            execute(command).catch(() => undefined);
          })
        }
      />
      {commandError !== undefined ? (
        <ErrorState title="That didn't work" error={commandError} />
      ) : null}
      {newTime !== null ? (
        <Card>
          <SectionTitle title="Reschedule" icon="calendar-outline" />
          <View style={[styles.row, { gap: theme.spacing.md }]}>
            <View style={styles.fill}>
              <DateTimeField
                label="Date"
                mode="date"
                value={newTime}
                minimumDate={new Date()}
                onChange={date => {
                  const next = new Date(newTime);
                  next.setFullYear(
                    date.getFullYear(),
                    date.getMonth(),
                    date.getDate(),
                  );
                  setNewTime(next);
                }}
              />
            </View>
            <View style={styles.fill}>
              <DateTimeField
                label="Time"
                mode="time"
                value={newTime}
                onChange={time => {
                  const next = new Date(newTime);
                  next.setHours(time.getHours(), time.getMinutes(), 0, 0);
                  setNewTime(next);
                }}
              />
            </View>
          </View>
          <TextField
            label="Reason (optional, the worker sees it)"
            value={rescheduleReason}
            onChangeText={setRescheduleReason}
          />
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Button
              label="Back"
              variant="ghost"
              onPress={() => setNewTime(null)}
            />
            <Button
              label="Reschedule"
              icon="checkmark"
              loading={rescheduleState.isLoading}
              onPress={() => {
                const reason = rescheduleReason.trim();
                reschedule({
                  id: job.id,
                  scheduledAt: newTime.toISOString(),
                  ...(reason !== '' && { reason }),
                })
                  .then(result => {
                    report(result);
                    if (result.error === undefined) {
                      setNewTime(null);
                    }
                  })
                  .catch(() => undefined);
              }}
            />
          </View>
        </Card>
      ) : null}
      <OperationSummary job={job} currency={currency} />
      <JobPayments job={job} currency={currency} />
      <JobLines job={job} />
      <JobInformation job={job} showAssignee />
      <JobSiteCard job={job} />
      <JobVisitLocations job={job} />
      <JobChecklist job={job} />
      <EvidenceGallery
        items={job.evidence.map(evidence => ({
          id: evidence.id,
          source: serverEvidenceSource(job.id, evidence.id),
          caption: `${fullName(evidence.uploadedBy)} · ${formatSchedule(
            evidence.capturedAt,
          )}`,
        }))}
      />
      <JobMessages
        job={job}
        {...(job.allowedActions.includes(JobAction.MESSAGE) && {
          composer: (
            <>
              <MessageComposer
                busy={messageState.isLoading}
                onSend={body => {
                  setMessageError(undefined);
                  // The message ID doubles as the idempotency key: a retry is one message.
                  const id = uuidv7();
                  sendMessage({
                    id: job.id,
                    idempotencyKey: id,
                    message: { id, body, occurredAt: new Date().toISOString() },
                  })
                    .unwrap()
                    .catch((failure: unknown) =>
                      setMessageError(toAppError(failure)),
                    );
                }}
              />
              {messageError !== undefined ? (
                <ErrorState title="Message not sent" error={messageError} />
              ) : null}
            </>
          ),
        })}
      />
      <JobFieldNotes job={job} />
      <JobHistory job={job} />
      <ReasonPrompt
        request={
          reasonFor === null || reasonFor.reason === undefined
            ? null
            : ({
                ...reasonFor.reason,
                confirmLabel: reasonFor.label,
                destructive: reasonFor.variant === 'danger',
              } satisfies ReasonRequest)
        }
        onCancel={() => setReasonFor(null)}
        onSubmit={reason => {
          const command = reasonFor;
          setReasonFor(null);
          if (command !== null) {
            execute(command, reason).catch(() => undefined);
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  fill: { flex: 1 },
});
