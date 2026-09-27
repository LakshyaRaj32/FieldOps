import React from 'react';
import type { JobPriority, JobStatus } from '@fieldops/types';

import { Badge } from '../../../components/ui';
import { priorityBadge, STATUS_LABELS, STATUS_TONES } from '../presentation';

export function JobStatusBadge({
  status,
}: {
  readonly status: JobStatus;
}): React.JSX.Element {
  return <Badge label={STATUS_LABELS[status]} tone={STATUS_TONES[status]} />;
}

/** Shown only for high and urgent jobs. */
export function JobPriorityBadge({
  priority,
}: {
  readonly priority: JobPriority;
}): React.JSX.Element | null {
  const badge = priorityBadge(priority);
  return badge === null ? null : (
    <Badge label={badge.label} tone={badge.tone} />
  );
}
