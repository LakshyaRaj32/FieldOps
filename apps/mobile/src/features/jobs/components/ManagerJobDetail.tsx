import React, { useState } from 'react';
import { RefreshControl, StyleSheet } from 'react-native';
import { JobAction } from '@fieldops/types';

import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import { Screen } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { toAppError, type AppError } from '../../../utils/errors';
import { uuidv7 } from '../../../utils/uuid';
import {
  useCancelJobMutation,
  useDeleteJobMutation,
  useGetJobQuery,
  useSendJobMessageMutation,
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

/**
 * A manager's or admin's view of a job: online, with the actions the server allows them
 * (assign, edit, cancel, delete), the worker's field notes, photos and visit positions, and
 * the job's conversation. Realtime events refetch it (app/providers/RealtimeConnection).
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
  const [cancel, cancelState] = useCancelJobMutation();
  const [remove, removeState] = useDeleteJobMutation();
  const [sendMessage, messageState] = useSendJobMessageMutation();
  const [commandError, setCommandError] = useState<AppError | undefined>();
  const [messageError, setMessageError] = useState<AppError | undefined>();
  const busy = cancelState.isLoading || removeState.isLoading;

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
    switch (command.action) {
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
});
