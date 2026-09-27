import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
}

export interface ChoiceChipsProps<T extends string> {
  readonly options: readonly ChoiceOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
}

/**
 * A single choice among more options than fit a segmented control (operation types,
 * payment methods): wrapping chips, exposed as a radio group. The selected chip is shown by
 * fill, border and a check mark, never by color alone.
 */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  disabled = false,
}: ChoiceChipsProps<T>): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[styles.wrap, { gap: theme.spacing.sm }]}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            accessibilityLabel={option.label}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.chip,
              {
                gap: theme.spacing.xs,
                borderRadius: theme.radii.pill,
                paddingHorizontal: theme.spacing.md,
                borderColor: selected
                  ? theme.colors.primary
                  : theme.colors.borderStrong,
                backgroundColor: selected
                  ? theme.colors.primaryMuted
                  : pressed
                  ? theme.colors.surfaceMuted
                  : theme.colors.surface,
                opacity: disabled ? 0.6 : 1,
              },
            ]}
          >
            <Icon
              name={selected ? 'checkmark' : option.icon ?? 'ellipse-outline'}
              size="sm"
              tone={selected ? 'primary' : 'muted'}
            />
            <AppText
              variant="captionStrong"
              tone={selected ? 'primary' : 'default'}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    borderWidth: 1,
  },
});
