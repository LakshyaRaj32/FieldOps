import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export interface SectionTitleProps {
  readonly title: string;
  readonly icon?: IconName;
  /** Shown on the right, for example a count or a small action button. */
  readonly accessory?: React.ReactNode;
}

/**
 * The heading of a card or a screen section: an icon plus an overline label, so sections
 * are easy to tell apart when scanning a long screen.
 */
export function SectionTitle({
  title,
  icon,
  accessory,
}: SectionTitleProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={[styles.row, { gap: theme.spacing.sm }]}>
      {icon !== undefined ? <Icon name={icon} size="sm" tone="muted" /> : null}
      <AppText
        variant="label"
        tone="muted"
        accessibilityRole="header"
        style={styles.title}
      >
        {title}
      </AppText>
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 20 },
  title: { flex: 1 },
});
