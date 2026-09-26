import React from 'react';

import { AppText, Card, Screen } from '../components/ui';

/**
 * Shown instead of the app when build-time configuration is invalid, so a misconfigured
 * build fails visibly and explains why, rather than crashing or calling the wrong server.
 */
export function ConfigurationErrorScreen({
  errors,
}: {
  readonly errors: readonly string[];
}): React.JSX.Element {
  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <AppText variant="title">Configuration error</AppText>
      <AppText tone="muted">
        This build of FieldOps was created with invalid environment
        configuration and cannot start. Fix the environment file for this build
        type and rebuild the app.
      </AppText>
      <Card>
        {errors.map(error => (
          <AppText key={error} tone="danger">
            • {error}
          </AppText>
        ))}
      </Card>
      <AppText variant="caption" tone="muted">
        See docs/mobile-development.md, section "API environments".
      </AppText>
    </Screen>
  );
}
