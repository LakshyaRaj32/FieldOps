import React from 'react';

import { InfoRow } from '../../../components/common/InfoRow';
import { AppText, Button, Card } from '../../../components/ui';
import { useOfflineJobs, useProblemEntries } from '../data/OfflineJobsContext';
import { formatSchedule } from '../presentation';
import { SyncProblemList } from './SyncProblemList';

const PHASES = {
  idle: 'Up to date',
  syncing: 'Syncing…',
  offline: "Can't reach the server",
  error: 'Last sync failed',
} as const;

/**
 * The worker's sync details (Profile): state, last successful sync, what is waiting, and every
 * change the server did not accept, with the reason. Also the manual "Sync now".
 */
export function SyncCard(): React.JSX.Element | null {
  const offline = useOfflineJobs();
  const { data: problems = [] } = useProblemEntries();
  if (offline === null) {
    return null;
  }
  const { status, store, engine } = offline;
  return (
    <Card>
      <AppText variant="label" tone="muted">
        Offline sync
      </AppText>
      <InfoRow label="Status" value={PHASES[status.phase]} />
      <InfoRow
        label="Last synced"
        value={
          status.lastSyncedAt === null
            ? 'Not yet'
            : formatSchedule(status.lastSyncedAt)
        }
      />
      <InfoRow
        label="Waiting to sync"
        value={status.pending === 0 ? 'Nothing' : String(status.pending)}
      />
      <SyncProblemList entries={problems} store={store} engine={engine} />
      <Button
        label="Sync now"
        variant="secondary"
        loading={status.phase === 'syncing'}
        onPress={() => {
          engine.sync().catch(() => undefined);
        }}
      />
    </Card>
  );
}
