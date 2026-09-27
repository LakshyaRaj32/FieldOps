import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { JobSummary } from '@fieldops/types';

import {
  AppText,
  Badge,
  Card,
  Icon,
  type BadgeTone,
  type IconName,
} from '../../../components/ui';
import { useTheme } from '../../../theme';
import {
  formatSchedule,
  fullName,
  priorityBadge,
  STATUS_LABELS,
} from '../presentation';
import { JobPriorityBadge, JobStatusBadge } from './JobBadges';

export interface JobCardProps {
  readonly job: JobSummary;
  readonly onPress: (job: JobSummary) => void;
  /** Managers see who the job is assigned to; a worker knows it is theirs. */
  readonly showAssignee?: boolean;
  /** The worker's unsynced state for this job, when there is one. */
  readonly syncBadge?: {
    readonly label: string;
    readonly tone: BadgeTone;
  } | null;
  /** A flatter variant for lists inside a card (the dashboard). */
  readonly dense?: boolean;
}

function MetaLine({
  icon,
  text,
  strong = false,
}: {
  readonly icon: IconName;
  readonly text: string;
  readonly strong?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={[styles.meta, { gap: theme.spacing.xs + 2 }]}>
      <Icon name={icon} size="sm" tone="muted" />
      <AppText
        variant={strong ? 'captionStrong' : 'caption'}
        tone={strong ? 'default' : 'muted'}
        numberOfLines={1}
        style={styles.metaText}
      >
        {text}
      </AppText>
    </View>
  );
}

/** A job in a list: title, status, schedule, customer and (for managers) the assignee. */
export function JobCard({
  job,
  onPress,
  showAssignee = false,
  syncBadge = null,
  dense = false,
}: JobCardProps): React.JSX.Element {
  const theme = useTheme();
  const schedule = formatSchedule(job.scheduledAt);
  const assignee =
    job.assignedWorker === null ? 'Unassigned' : fullName(job.assignedWorker);

  const content = (
    <>
      <View style={[styles.header, { gap: theme.spacing.sm }]}>
        <AppText variant="bodyStrong" style={styles.title} numberOfLines={2}>
          {job.title}
        </AppText>
        <JobStatusBadge status={job.status} />
      </View>
      <View style={{ gap: theme.spacing.xxs + 1 }}>
        <MetaLine icon="time-outline" text={schedule} strong />
        <MetaLine
          icon="business-outline"
          text={`${job.customerName} · ${job.address}`}
        />
        {showAssignee ? (
          <MetaLine icon="person-outline" text={assignee} />
        ) : null}
      </View>
      {syncBadge !== null || priorityBadge(job.priority) !== null ? (
        <View style={[styles.badges, { gap: theme.spacing.sm }]}>
          <JobPriorityBadge priority={job.priority} />
          {syncBadge !== null ? (
            <Badge
              label={syncBadge.label}
              tone={syncBadge.tone}
              icon={
                syncBadge.tone === 'danger'
                  ? 'alert-circle-outline'
                  : 'cloud-upload-outline'
              }
            />
          ) : null}
        </View>
      ) : null}
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.title}, ${job.customerName}, ${
        STATUS_LABELS[job.status]
      }, ${schedule}${showAssignee ? `, ${assignee}` : ''}`}
      onPress={() => onPress(job)}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {dense ? (
        <View
          style={{
            gap: theme.spacing.sm,
            padding: theme.spacing.md,
            borderRadius: theme.radii.md,
            backgroundColor: theme.colors.background,
          }}
        >
          {content}
        </View>
      ) : (
        <Card padding="md" style={{ gap: theme.spacing.sm }}>
          {content}
        </Card>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  title: { flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center' },
  metaText: { flex: 1 },
  badges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  pressed: { opacity: 0.85 },
});
