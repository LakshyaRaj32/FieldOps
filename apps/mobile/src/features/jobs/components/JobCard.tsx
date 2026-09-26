import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { JobSummary } from '@fieldops/types';

import { AppText, Card } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { formatSchedule, fullName, STATUS_LABELS } from '../presentation';
import { JobPriorityBadge, JobStatusBadge } from './JobBadges';

export interface JobCardProps {
  readonly job: JobSummary;
  readonly onPress: (job: JobSummary) => void;
  /** Managers see who the job is assigned to; a worker knows it is theirs. */
  readonly showAssignee?: boolean;
}

/** A job in a list: title, customer, status, schedule and (for managers) the assignee. */
export function JobCard({
  job,
  onPress,
  showAssignee = false,
}: JobCardProps): React.JSX.Element {
  const theme = useTheme();
  const schedule = formatSchedule(job.scheduledAt);
  const assignee =
    job.assignedWorker === null ? 'Unassigned' : fullName(job.assignedWorker);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.title}, ${job.customerName}, ${
        STATUS_LABELS[job.status]
      }, ${schedule}`}
      onPress={() => onPress(job)}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Card style={{ gap: theme.spacing.sm }}>
        <View style={[styles.header, { gap: theme.spacing.sm }]}>
          <AppText variant="heading" style={styles.title} numberOfLines={2}>
            {job.title}
          </AppText>
          <JobStatusBadge status={job.status} />
        </View>
        <AppText tone="muted" numberOfLines={1}>
          {job.customerName} · {job.address}
        </AppText>
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <AppText variant="bodyStrong">{schedule}</AppText>
          <JobPriorityBadge priority={job.priority} />
        </View>
        {showAssignee ? (
          <AppText variant="caption" tone="muted">
            {assignee}
          </AppText>
        ) : null}
      </Card>
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
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  pressed: { opacity: 0.85 },
});
