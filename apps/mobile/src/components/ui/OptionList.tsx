import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export interface OptionItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  /** Shown at the end of the row (an amount, a count). */
  readonly trailing?: string;
  readonly icon?: IconName;
}

export interface OptionListProps {
  readonly items: readonly OptionItem[];
  /** Selected IDs: one for a single choice, several for `multiple`. */
  readonly selected: readonly string[];
  readonly onToggle: (id: string) => void;
  readonly multiple?: boolean;
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
}

/**
 * Rows to choose from (a shop, an order, products to count, a person), compact and easy to
 * tap: at least 48 dp each, the selection shown by a radio or check mark and a tinted row.
 */
export function OptionList({
  items,
  selected,
  onToggle,
  multiple = false,
  accessibilityLabel,
  disabled = false,
}: OptionListProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessibilityRole={multiple ? 'list' : 'radiogroup'}
      accessibilityLabel={accessibilityLabel}
      style={{ gap: theme.spacing.xs }}
    >
      {items.map(item => {
        const isSelected = selected.includes(item.id);
        const mark: IconName = multiple
          ? isSelected
            ? 'checkbox'
            : 'square-outline'
          : isSelected
          ? 'radio-button-on'
          : 'radio-button-off';
        return (
          <Pressable
            key={item.id}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={{
              checked: isSelected,
              disabled,
            }}
            accessibilityLabel={[item.title, item.subtitle, item.trailing]
              .filter(part => part !== undefined)
              .join(', ')}
            disabled={disabled}
            onPress={() => onToggle(item.id)}
            style={({ pressed }) => [
              styles.row,
              {
                gap: theme.spacing.md,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radii.md,
                borderColor: isSelected
                  ? theme.colors.primary
                  : theme.colors.border,
                backgroundColor: isSelected
                  ? theme.colors.primaryMuted
                  : pressed
                  ? theme.colors.surfaceMuted
                  : theme.colors.surface,
              },
            ]}
          >
            <Icon
              name={mark}
              size="md"
              tone={isSelected ? 'primary' : 'muted'}
            />
            {item.icon !== undefined ? (
              <Icon name={item.icon} size="md" tone="muted" />
            ) : null}
            <View style={styles.fill}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {item.title}
              </AppText>
              {item.subtitle !== undefined ? (
                <AppText variant="caption" tone="muted" numberOfLines={2}>
                  {item.subtitle}
                </AppText>
              ) : null}
            </View>
            {item.trailing !== undefined ? (
              <AppText variant="captionStrong">{item.trailing}</AppText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 6,
    borderWidth: 1,
  },
  fill: { flex: 1 },
});
