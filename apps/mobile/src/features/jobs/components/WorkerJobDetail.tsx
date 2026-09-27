import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { JobAction, type DeviceLocation } from '@fieldops/types';

import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import { AppText, Button, Screen, TextField } from '../../../components/ui';
import { evidenceFiles } from '../../../services/files/evidenceFiles';
import { describeLocationFailure } from '../../../services/location/locationResult';
import { getCurrentLocation } from '../../../services/location/locationService';
import {
  choosePhoto,
  takePhoto,
  type PhotoPickResult,
} from '../../../services/media/photoPicker';
import { useTheme } from '../../../theme';
import { uuidv7 } from '../../../utils/uuid';
import {
  useActiveEntries,
  useLocalEvidenceFiles,
  useLocalJob,
  useOfflineJobs,
  useProblemEntries,
} from '../data/OfflineJobsContext';
import { LocalCommandError } from '../data/types';
import {
  EVIDENCE_STATE_LABELS,
  formatSchedule,
  jobCommands,
  jobSyncBadge,
  type JobCommand,
} from '../presentation';
import { serverEvidenceSource } from './evidenceSource';
import {
  EvidenceGallery,
  JobMessages,
  JobSiteCard,
  JobVisitLocations,
  type GalleryItem,
} from './FieldOperationSections';
import {
  confirmThen,
  JobChecklist,
  JobCommandButtons,
  JobFieldNotes,
  JobHeader,
  JobHistory,
  JobInformation,
} from './JobDetailSections';
import { MessageComposer } from './MessageComposer';
import { SyncProblemList } from './SyncProblemList';
import { WorkerLocationPanel } from './WorkerLocationPanel';

const NOTE_MAX_LENGTH = 2000;
/** The server's limit; checked here too so a doomed photo never waits in the outbox. */
const EVIDENCE_MAX_BYTES = 10 * 1_048_576;

const PICK_PROBLEMS: Readonly<
  Record<Exclude<PhotoPickResult['kind'], 'picked' | 'cancelled'>, string>
> = {
  unsupported: 'Only JPEG and PNG photos can be attached.',
  camera_unavailable: 'No camera is available on this phone.',
  permission: 'FieldOps is not allowed to use the camera or photos.',
  error: "The photo couldn't be taken. Please try again.",
};

/**
 * The assigned worker's view of a job, from the phone's database. Start, complete, notes,
 * photos and messages commit locally right away (online or not) and reach the server
 * through the sync engine; nothing on this screen waits for the network.
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
  const { data: files = [] } = useLocalEvidenceFiles(jobId);
  const { data: active = [] } = useActiveEntries(jobId);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>();
  const [commandError, setCommandError] = useState<string | undefined>();
  const [locationNotice, setLocationNotice] = useState<string | undefined>();
  const [locating, setLocating] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<string | undefined>();
  const [capturing, setCapturing] = useState(false);
  const [searched, setSearched] = useState(false);

  // Opened from a notification for a job that is not on the phone yet: sync once.
  const missing = item === null;
  const engine = offline?.engine;
  useEffect(() => {
    if (missing && !searched && engine !== undefined) {
      setSearched(true);
      engine.sync().catch(() => undefined);
    }
  }, [missing, searched, engine]);

  const pendingMessageIds = useMemo(
    () =>
      new Set(
        active.flatMap(entry =>
          entry.type === 'job.message.send' ? [entry.payload.messageId] : [],
        ),
      ),
    [active],
  );

  if (offline === null || (item === undefined && error === undefined)) {
    return (
      <Screen contentStyle={styles.centered}>
        <LoadingState message="Opening job…" />
      </Screen>
    );
  }
  const { store, status } = offline;
  if (error !== undefined) {
    return (
      <Screen contentStyle={styles.centered}>
        <ErrorState title="Couldn't read this job" error={error} />
      </Screen>
    );
  }
  if (item === null || item === undefined) {
    if (!searched || status.phase === 'syncing') {
      return (
        <Screen contentStyle={styles.centered}>
          <LoadingState message="Looking for this job…" />
        </Screen>
      );
    }
    return (
      <Screen>
        <SyncProblemList
          entries={problems}
          store={store}
          engine={offline.engine}
        />
        <EmptyState
          title="This job is not on your phone"
          description={
            status.phase === 'offline'
              ? "You're offline. It will appear once your phone syncs."
              : 'It may have been reassigned or closed a while ago.'
          }
        />
      </Screen>
    );
  }
  const { job } = item;

  /** A local command commits at once; syncing happens in the background. */
  const perform = (write: () => Promise<unknown>) => {
    setCommandError(undefined);
    write()
      .then(() => offline.engine.sync())
      .catch((failure: unknown) => {
        setCommandError(
          failure instanceof LocalCommandError
            ? failure.message
            : 'The change could not be saved on this phone.',
        );
      });
  };

  /**
   * Start and complete record where the worker is, when the phone can tell. Getting a fix
   * never blocks the work: without one (permission refused, no signal) the command is
   * saved anyway and the worker is told why no position was recorded.
   */
  const runWithLocation = async (command: JobCommand) => {
    setLocationNotice(undefined);
    setLocating(true);
    let location: DeviceLocation | null = null;
    try {
      const result = await getCurrentLocation({ request: true });
      if (result.kind === 'ok') {
        location = result.location;
      } else {
        setLocationNotice(
          `Saved without your position. ${
            describeLocationFailure(result.kind).message
          }`,
        );
      }
    } finally {
      setLocating(false);
    }
    perform(() =>
      command.action === JobAction.START
        ? store.startJob(job.id, location)
        : store.completeJob(job.id, location),
    );
  };

  const run = (command: JobCommand) => {
    if (
      command.action === JobAction.START ||
      command.action === JobAction.COMPLETE
    ) {
      runWithLocation(command).catch(() => undefined);
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

  /** Camera or gallery → app-private copy → outbox. Works the same offline. */
  const capture = async (pick: () => Promise<PhotoPickResult>) => {
    setPhotoNotice(undefined);
    setCapturing(true);
    try {
      const result = await pick();
      if (result.kind === 'cancelled') {
        return;
      }
      if (result.kind !== 'picked') {
        setPhotoNotice(PICK_PROBLEMS[result.kind]);
        return;
      }
      const { photo } = result;
      const evidenceId = uuidv7();
      const extension = photo.type === 'image/png' ? 'png' : 'jpg';
      let saved: { uri: string; sizeBytes: number };
      try {
        saved = await evidenceFiles.importPhoto(
          photo.uri,
          `${evidenceId}.${extension}`,
        );
      } catch {
        setPhotoNotice("The photo couldn't be saved on this phone.");
        return;
      }
      if (saved.sizeBytes > EVIDENCE_MAX_BYTES) {
        evidenceFiles.remove(saved.uri).catch(() => undefined);
        setPhotoNotice(
          'The photo is larger than 10 MB and cannot be attached.',
        );
        return;
      }
      perform(() =>
        store.addEvidence(job.id, {
          evidenceId,
          fileUri: saved.uri,
          contentType: photo.type,
          sizeBytes: saved.sizeBytes,
          width: photo.width,
          height: photo.height,
        }),
      );
    } finally {
      setCapturing(false);
    }
  };

  const gallery: GalleryItem[] = job.evidence.map(evidence => {
    const local = files.find(file => file.evidenceId === evidence.id);
    return {
      id: evidence.id,
      source:
        local !== undefined
          ? { uri: local.fileUri }
          : serverEvidenceSource(job.id, evidence.id),
      caption: formatSchedule(evidence.capturedAt),
      ...(local !== undefined && { badge: EVIDENCE_STATE_LABELS[local.state] }),
    };
  });

  const canNote = job.allowedActions.includes(JobAction.NOTE);
  const canAddEvidence = job.allowedActions.includes(JobAction.EVIDENCE);
  const canMessage = job.allowedActions.includes(JobAction.MESSAGE);

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={status.phase === 'syncing'}
          onRefresh={() => {
            offline.engine.sync().catch(() => undefined);
          }}
          colors={[theme.colors.primary]}
        />
      }
    >
      <JobHeader job={job} syncBadge={jobSyncBadge(item)} />
      <SyncProblemList
        entries={problems}
        store={store}
        engine={offline.engine}
      />
      <JobCommandButtons
        commands={jobCommands(job)}
        busy={locating}
        onRun={command => confirmThen(command, () => run(command))}
      />
      {locating ? (
        <AppText variant="caption" tone="muted">
          Getting your position…
        </AppText>
      ) : null}
      {locationNotice !== undefined ? (
        <AppText tone="warning">{locationNotice}</AppText>
      ) : null}
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
      <JobSiteCard job={job}>
        <WorkerLocationPanel job={job} />
      </JobSiteCard>
      <JobVisitLocations job={job} />
      <JobChecklist job={job} />
      <EvidenceGallery
        items={gallery}
        {...(photoNotice !== undefined && { notice: photoNotice })}
        {...(canAddEvidence && {
          actions: (
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <Button
                label="Take photo"
                icon="camera-outline"
                variant="secondary"
                loading={capturing}
                onPress={() => {
                  capture(takePhoto).catch(() => undefined);
                }}
              />
              <Button
                label="Choose photo"
                icon="images-outline"
                variant="secondary"
                disabled={capturing}
                onPress={() => {
                  capture(choosePhoto).catch(() => undefined);
                }}
              />
            </View>
          ),
        })}
      />
      <JobMessages
        job={job}
        pendingIds={pendingMessageIds}
        {...(canMessage && {
          composer: (
            <MessageComposer
              onSend={body => perform(() => store.sendMessage(job.id, body))}
            />
          ),
        })}
      />
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
              <Button
                label="Save note"
                icon="save-outline"
                variant="secondary"
                onPress={addNote}
              />
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
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
