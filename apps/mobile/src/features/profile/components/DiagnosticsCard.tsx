import React, { useState } from 'react';

import { getConfig } from '../../../app/config';
import { ErrorState } from '../../../components/common/ErrorState';
import { AppText, Button, Card, SectionTitle } from '../../../components/ui';
import { useConnectivity } from '../../../hooks/useConnectivity';
import { useLazyCheckLivenessQuery } from '../../../services/api/healthApi';
import { describeConnectivityStatus } from '../../../services/network/connectivity';
import { InfoRow } from '../../../components/common/InfoRow';

/** Throws during render so the error boundary can be verified on a device (development only). */
function RenderErrorTrigger(): React.JSX.Element {
  throw new Error('Test render error triggered from diagnostics');
}

/**
 * Shows which environment and API this build uses, live connectivity, and a manual API
 * reachability check. Useful on a physical device, where logs are not always at hand.
 */
export function DiagnosticsCard(): React.JSX.Element {
  const config = getConfig();
  const connectivity = useConnectivity();
  const [checkLiveness, liveness] = useLazyCheckLivenessQuery();
  const [triggerRenderError, setTriggerRenderError] = useState(false);

  return (
    <Card>
      <SectionTitle title="Diagnostics" icon="construct-outline" />
      <InfoRow label="Environment" value={config.environment} />
      <InfoRow label="API base URL" value={config.apiBaseUrl} />
      <InfoRow
        label="Connectivity"
        value={`${describeConnectivityStatus(connectivity.status)} (${
          connectivity.connectionType
        })`}
      />

      <Button
        label="Check API connection"
        variant="secondary"
        loading={liveness.isFetching}
        onPress={() => {
          checkLiveness();
        }}
      />
      {!liveness.isFetching && liveness.isSuccess ? (
        <AppText tone="success">
          API reachable at{' '}
          {new Date(liveness.data.checkedAt).toLocaleTimeString()}
        </AppText>
      ) : null}
      {!liveness.isFetching && liveness.isError ? (
        <ErrorState title="API not reachable" error={liveness.error} />
      ) : null}

      {config.environment === 'development' ? (
        <Button
          label="Simulate render error"
          variant="ghost"
          onPress={() => setTriggerRenderError(true)}
          accessibilityHint="Throws a test error to verify the error screen"
        />
      ) : null}
      {triggerRenderError ? <RenderErrorTrigger /> : null}
    </Card>
  );
}
