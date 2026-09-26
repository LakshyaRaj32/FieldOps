import React, { type PropsWithChildren } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';

export interface ScreenProps {
  /** Wrap content in a ScrollView (default true). */
  readonly scroll?: boolean;
  /**
   * Safe-area edges to pad. Defaults to left/right: navigator headers and tab bars already
   * handle the top and bottom. Screens without a header (login) pass all edges.
   */
  readonly edges?: readonly Edge[];
  readonly contentStyle?: StyleProp<ViewStyle>;
}

const DEFAULT_EDGES: readonly Edge[] = ['left', 'right'];

/** Root container for every screen: background, safe area, padding and optional scrolling. */
export function Screen({
  children,
  scroll = true,
  edges = DEFAULT_EDGES,
  contentStyle,
}: PropsWithChildren<ScreenProps>): React.JSX.Element {
  const theme = useTheme();
  const padding = { padding: theme.spacing.lg, gap: theme.spacing.lg };

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.fill, { backgroundColor: theme.colors.background }]}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.grow, padding, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, padding, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
});
