import React from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { JobAction, type JobDetail } from '@fieldops/types';

import { InfoRow } from '../../../components/common/InfoRow';
import {
  AppText,
  Badge,
  Button,
  Card,
  type BadgeTone,
  SectionTitle,
  type IconName,
} from '../../../components/ui';
import { useTheme } from '../../../theme';
import {
  describeHistoryEntry,
  formatSchedule,
  fullName,
  PRIORITY_LABELS,
  type JobCommand,
} from '../presentation';
import { JobPriorityBadge, JobStatusBadge } from './JobBadges';
import { ChecklistAnswerRow } from './OperationSections';

const COMMAND_ICONS: Readonly<Partial<Record<JobAction, IconName>>> = {
  [JobAction.ACCEPT]: 'thumbs-up-outline',
  [JobAction.DECLINE]: 'return-down-back-outline',
  [JobAction.DEPART]: 'navigate-outline',
  [JobAction.ARRIVE]: 'location-outline',
  [JobAction.FAIL]: 'alert-circle-outline',
  [JobAction.VERIFY]: 'shield-checkmark-outline',
  [JobAction.REJECT]: 'arrow-undo-outline',
  [JobAction.RESCHEDULE]: 'calendar-outline',
  [JobAction.START]: 'play-circle-outline',
  [JobAction.COMPLETE]: 'checkmark-circle-outline',
  [JobAction.ASSIGN]: 'person-add-outline',
  [JobAction.EDIT]: 'create-outline',
  [JobAction.CANCEL]: 'close-circle-outline',
  [JobAction.DELETE]: 'trash-outline',
};

/** Runs a command, asking first when it is irreversible or destructive. */
export function confirmThen(command: JobCommand, run: () => void): void {
  const { confirm } = command;
  if (confirm === undefined) {
    run();
    return;
  }
  Alert.alert(confirm.title, confirm.message, [
    { text: 'Back', style: 'cancel' },
    {
      text: confirm.confirmLabel,
      style: command.variant === 'danger' ? 'destructive' : 'default',
      onPress: run,
    },
  ]);
}

export function JobHeader({
  job,
  syncBadge = null,
}: {
  readonly job: JobDetail;
  readonly syncBadge?: { label: string; tone: BadgeTone } | null;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <AppText variant="title">{job.title}</AppText>
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <JobStatusBadge status={job.status} />
        <JobPriorityBadge priority={job.priority} />
        {syncBadge !== null ? (
          <Badge label={syncBadge.label} tone={syncBadge.tone} />
        ) : null}
      </View>
    </View>
  );
}

export function JobCommandButtons({
  commands,
  onRun,
  busy = false,
}: {
  readonly commands: readonly JobCommand[];
  readonly onRun: (command: JobCommand) => void;
  readonly busy?: boolean;
}): React.JSX.Element | null {
  const theme = useTheme();
  if (commands.length === 0) {
    return null;
  }
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {commands.map(command => (
        <Button
          key={command.action}
          label={command.label}
          variant={command.variant}
          {...(COMMAND_ICONS[command.action] !== undefined && {
            icon: COMMAND_ICONS[command.action],
          })}
          onPress={() => onRun(command)}
          disabled={busy}
        />
      ))}
    </View>
  );
}

export function JobInformation({
  job,
  showAssignee,
}: {
  readonly job: JobDetail;
  readonly showAssignee: boolean;
}): React.JSX.Element {
  return (
    <Card>
      <SectionTitle title="Details" icon="information-circle-outline" />
      <InfoRow label="Due" value={formatSchedule(job.scheduledAt)} />
      {job.shop === null ? (
        <InfoRow label="Customer" value={job.customerName} />
      ) : null}
      {/* Address and coordinates: JobSiteCard (FieldOperationSections.tsx). */}
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
      {job.notes !== null ? (
        <InfoRow label="Instructions" value={job.notes} />
      ) : null}
      {job.cancellationReason !== null ? (
        <InfoRow label="Cancellation reason" value={job.cancellationReason} />
      ) : null}
    </Card>
  );
}

export function JobChecklist({
  job,
}: {
  readonly job: JobDetail;
}): React.JSX.Element | null {
  if (job.checklist.length === 0) {
    return null;
  }
  const answered = job.checklist.some(item => item.checked !== null);
  return (
    <Card>
      <SectionTitle title="Checklist" icon="checkbox-outline" />
      {job.checklist.map(item =>
        answered ? (
          <ChecklistAnswerRow
            key={item.id}
            label={item.label}
            checked={item.checked}
            note={item.responseNote}
          />
        ) : (
          <AppText key={item.id}>
            {item.position + 1}. {item.label}
          </AppText>
        ),
      )}
    </Card>
  );
}

/** Field notes, with a composer on top when the viewer may add notes. */
export function JobFieldNotes({
  job,
  composer,
}: {
  readonly job: JobDetail;
  readonly composer?: React.ReactNode;
}): React.JSX.Element | null {
  if (job.fieldNotes.length === 0 && composer === undefined) {
    return null;
  }
  return (
    <Card>
      <SectionTitle title="Field notes" icon="create-outline" />
      {composer}
      {job.fieldNotes.map(note => (
        <InfoRow
          key={note.id}
          label={`${fullName(note.author)} · ${formatSchedule(
            note.occurredAt,
          )}`}
          value={note.body}
        />
      ))}
    </Card>
  );
}

export function JobHistory({
  job,
}: {
  readonly job: JobDetail;
}): React.JSX.Element {
  return (
    <Card>
      <SectionTitle title="History" icon="time-outline" />
      {job.history.map(entry => (
        <InfoRow
          key={entry.id}
          label={formatSchedule(entry.createdAt)}
          value={describeHistoryEntry(entry)}
        />
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});
