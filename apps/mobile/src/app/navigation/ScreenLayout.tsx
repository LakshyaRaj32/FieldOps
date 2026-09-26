import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConnectivityBanner } from '../../components/common/ConnectivityBanner';
import { SyncStatusBanner } from '../../features/jobs/components/SyncStatusBanner';

/**
 * Wraps every screen (via the navigators' `screenLayout`) so app-wide UI such as the
 * connectivity banner appears below the header on every screen without each screen
 * having to render it.
 */
export function ScreenLayout({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.fill}>
      <ConnectivityBanner />
      <SyncStatusBanner />
      <View style={styles.fill}>{children}</View>
    </View>
  );
}

export const renderScreenLayout = ({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element => <ScreenLayout>{children}</ScreenLayout>;

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
