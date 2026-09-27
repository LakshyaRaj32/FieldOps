import React, { useState } from 'react';
import { View } from 'react-native';
import type { JobDetail } from '@fieldops/types';
import { distanceMeters } from '@fieldops/shared/geo';

import { AppText, Button } from '../../../components/ui';
import {
  describeLocationFailure,
  type LocationFailure,
} from '../../../services/location/locationResult';
import {
  getCurrentLocation,
  openAppSettings,
  openLocationSettings,
} from '../../../services/location/locationService';
import { useTheme } from '../../../theme';
import { formatDistance } from '../presentation';

type DistanceState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'locating' }
  | {
      readonly kind: 'located';
      readonly meters: number;
      readonly accuracyMeters: number;
    }
  | { readonly kind: 'failed'; readonly failure: LocationFailure };

/**
 * "How far am I from the site?" for the assigned worker. On demand only: one fix when the
 * worker asks, shown and then forgotten (nothing is stored or sent). The permission prompt
 * appears here, in context, after the explanation; a refusal is explained with the way out.
 */
export function WorkerLocationPanel({
  job,
}: {
  readonly job: JobDetail;
}): React.JSX.Element | null {
  const theme = useTheme();
  const [state, setState] = useState<DistanceState>({ kind: 'idle' });
  const site = job.location;
  if (site === null) {
    return null;
  }

  const check = async () => {
    setState({ kind: 'locating' });
    const result = await getCurrentLocation({ request: true });
    if (result.kind !== 'ok') {
      setState({ kind: 'failed', failure: result.kind });
      return;
    }
    setState({
      kind: 'located',
      meters: distanceMeters(site, result.location),
      accuracyMeters: result.location.accuracyMeters,
    });
  };
  const runCheck = () => {
    check().catch(() => setState({ kind: 'failed', failure: 'unavailable' }));
  };

  let body: React.ReactNode = null;
  if (state.kind === 'located') {
    body = (
      <AppText>
        You are about {formatDistance(state.meters)} from the site (±
        {formatDistance(state.accuracyMeters)}).
      </AppText>
    );
  } else if (state.kind === 'failed') {
    const { message, action } = describeLocationFailure(state.failure);
    body = (
      <View style={{ gap: theme.spacing.sm }}>
        <AppText tone="warning">{message}</AppText>
        {action === 'settings' ? (
          <Button
            label="Open app settings"
            variant="secondary"
            onPress={openAppSettings}
          />
        ) : null}
        {action === 'location_settings' ? (
          <Button
            label="Turn on location"
            variant="secondary"
            onPress={openLocationSettings}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {body}
      <Button
        label={state.kind === 'located' ? 'Check again' : 'Check my distance'}
        variant="secondary"
        loading={state.kind === 'locating'}
        onPress={runCheck}
      />
    </View>
  );
}
