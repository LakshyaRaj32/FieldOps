import React from 'react';

import { InfoRow } from '../../../components/common/InfoRow';
import { AppText, Card, SectionTitle } from '../../../components/ui';
import {
  usePushStatus,
  useRealtimeStatus,
} from '../../../hooks/useLiveUpdates';

const REALTIME = {
  stopped: 'Paused (offline or in the background)',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  unauthorized: 'Signed out by the server',
} as const;

const PUSH = {
  unavailable: 'Not available in this build',
  off: 'Off (allow notifications in Android settings)',
  on: 'On for this phone',
  pending: 'Setting up…',
} as const;

/**
 * How this phone hears about changes. Both are hints: the job data itself always comes
 * through sync, so work is never lost when they are off.
 */
export function LiveUpdatesCard(): React.JSX.Element {
  const realtime = useRealtimeStatus();
  const push = usePushStatus();
  return (
    <Card>
      <SectionTitle title="Live updates" icon="radio-outline" />
      <InfoRow label="Realtime" value={REALTIME[realtime]} />
      <InfoRow label="Push notifications" value={PUSH[push]} />
      <AppText variant="caption" tone="muted">
        Without them, changes still arrive when the app syncs.
      </AppText>
    </Card>
  );
}
