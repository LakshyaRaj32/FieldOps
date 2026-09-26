import React, { useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { JobAction } from '@fieldops/types';

import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import { AppText, Button, Screen, TextField } from '../../../components/ui';
import { useTheme } from '../../../theme';
import {
  useLocalJob,
  useOfflineJobs,
  useProblemEntries,
} from '../data/OfflineJobsContext';
import { LocalCommandError } from '../data/types';
import { jobCommands, jobSyncBadge, type JobCommand } from '../presentation';
import {
  confirmThen,
  JobChecklist,
  JobCommandButtons,
  JobFieldNotes,
  JobHeader,
  JobHistory,
  JobInformation,
} from './JobDetailSections';
import { SyncProblemList } from './SyncProblemList';

const NOTE_MAX_LENGTH = 2000;

/**
 * The assigned worker's view of a job, from the phone's database. Start, complete and notes
 * commit locally right away (online or not) and reach the server through the sync engine.
 */
export function WorkerJobDetail({
  jobId,
}: {
  readonly jobId: string;
}): React.JSX.Element {
  const theme = useTheme();
  const offline = useOfflineJobs();
  const { data: item, error } = useLocalJob(jobId);
  const { data: problems = [] } = useProblemEntries(jobId);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>();
  const [commandError, setCommandError] = useState<string | undefined>();

  if (offline === null || (item === undefined && error === undefined)) {
    return (
      <Screen contentStyle={styles.centered}>
        <LoadingState message="Opening job…" />
      </Screen>
    );
  }
  const { store, engine, status } = offline;
  if (error !== undefined) {
    return (
      <Screen contentStyle={styles.centered}>
        <ErrorState title="Couldn't read this job" error={error} />
      </Screen>
    );
  }
  if (item === null || item === undefined) {
    return (
      <Screen>
        <SyncProblemList entries={problems} store={store} engine={engine} />
        <EmptyState
          title="This job is no longer on your phone"
          description="It may have been reassigned or closed a while ago."
        />
      </Screen>
    );
  }
  const { job } = item;

  /** A local command commits at once; syncing happens in the background. */
  const perform = (write: () => Promise<unknown>) => {
    setCommandError(undefined);
    write()
      .then(() => engine.sync())
      .catch((failure: unknown) => {
        setCommandError(
          failure instanceof LocalCommandError
            ? failure.message
            : 'The change could not be saved on this phone.',
        );
      });
  };

  const run = (command: JobCommand) => {
    if (command.action === JobAction.START) {
      perform(() => store.startJob(job.id));
    } else if (command.action === JobAction.COMPLETE) {
      perform(() => store.completeJob(job.id));
    }
  };

  const addNote = () => {
    const body = note.trim();
    if (body === '') {
      setNoteError('Write something first.');
      return;
    }
    if (body.length > NOTE_MAX_LENGTH) {
      setNoteError(`Use at most ${NOTE_MAX_LENGTH} characters.`);
      return;
    }
    setNoteError(undefined);
    setNote('');
    perform(() => store.addNote(job.id, body));
  };

  const canNote = job.allowedActions.includes(JobAction.NOTE);

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={status.phase === 'syncing'}
          onRefresh={() => {
            engine.sync().catch(() => undefined);
          }}
          colors={[theme.colors.primary]}
        />
      }
    >
      <JobHeader job={job} syncBadge={jobSyncBadge(item)} />
      <SyncProblemList entries={problems} store={store} engine={engine} />
      <JobCommandButtons
        commands={jobCommands(job)}
        onRun={command => confirmThen(command, () => run(command))}
      />
      {commandError !== undefined ? (
        <AppText tone="danger" accessibilityRole="alert">
          {commandError}
        </AppText>
      ) : null}
      {item.pendingChanges > 0 ? (
        <AppText variant="caption" tone="muted">
          Saved on this phone. It will sync automatically.
        </AppText>
      ) : null}
      <JobInformation job={job} showAssignee={false} />
      <JobChecklist job={job} />
      <JobFieldNotes
        job={job}
        composer={
          canNote ? (
            <View style={{ gap: theme.spacing.sm }}>
              <TextField
                label="Add a note"
                value={note}
                onChangeText={value => {
                  setNote(value);
                  setNoteError(undefined);
                }}
                error={noteError}
                multiline
                textAlignVertical="top"
                placeholder="What did you find or do?"
              />
              <Button label="Save note" variant="secondary" onPress={addNote} />
            </View>
          ) : undefined
        }
      />
      <JobHistory job={job} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
});
