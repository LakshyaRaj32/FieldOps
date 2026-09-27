import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { useTheme } from '../../theme';
import { AppText } from './AppText';

export interface ToggleRowProps {
  readonly label: string;
  readonly description?: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
  readonly disabled?: boolean;
}

/** A labeled on/off setting (a native switch), the whole row tappable for the reader. */
export function ToggleRow({
  label,
  description,
  value,
  onChange,
  disabled = false,
}: ToggleRowProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[styles.row, { gap: theme.spacing.md }]}
      accessible
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      onAccessibilityTap={() => !disabled && onChange(!value)}
    >
      <View style={styles.fill}>
        <AppText variant="bodyStrong">{label}</AppText>
        {description !== undefined ? (
          <AppText variant="caption" tone="muted">
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{
          false: theme.colors.borderStrong,
          true: theme.colors.primary,
        }}
        thumbColor={theme.colors.surface}
        importantForAccessibility="no-hide-descendants"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  fill: { flex: 1 },
});
