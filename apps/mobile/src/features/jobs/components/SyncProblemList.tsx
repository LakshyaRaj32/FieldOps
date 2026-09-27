import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { LocalJobStore } from '../data/localJobStore';
import type { JobSyncEngine } from '../data/syncEngine';
import type { OutboxEntry } from '../data/types';
import { describeProblem } from '../presentation';

/**
 * Commands the server did not accept, each with its reason. A conflict can only be
 * dismissed (the server state won); a failure can be tried again.
 */
export function SyncProblemList({
  entries,
  store,
  engine,
}: {
  readonly entries: readonly OutboxEntry[];
  readonly store: LocalJobStore;
  readonly engine: JobSyncEngine;
}): React.JSX.Element | null {
  const theme = useTheme();
  if (entries.length === 0) {
    return null;
  }
  return (
    <View
      accessibilityRole="alert"
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radii.md,
        backgroundColor: theme.colors.dangerMuted,
      }}
    >
      {entries.map(entry => (
        <View key={entry.seq} style={{ gap: theme.spacing.xs }}>
          <AppText>{describeProblem(entry)}</AppText>
          <View style={[styles.actions, { gap: theme.spacing.sm }]}>
            {entry.status === 'failed' ? (
              <Button
                label="Try again"
                variant="secondary"
                style={styles.action}
                onPress={() => {
                  store
                    .retry(entry.seq)
                    .then(() => engine.sync())
                    .catch(() => undefined);
                }}
              />
            ) : null}
            <Button
              label="Dismiss"
              variant="ghost"
              style={styles.action}
              onPress={() => {
                store.dismiss(entry.seq).catch(() => undefined);
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row' },
  action: { flex: 1 },
});
