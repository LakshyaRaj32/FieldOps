import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';

/** A label/value pair for read-only details (account, diagnostics). */
export function InfoRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={[styles.row, { paddingVertical: theme.spacing.xs }]}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText selectable>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2 },
});
