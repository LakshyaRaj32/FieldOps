import React, { useRef, type PropsWithChildren } from 'react';
import {
  Platform,
  ScrollView,
  type RefreshControlProps,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useKeyboardInset } from '../../hooks/useKeyboardInset';
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
  /** Pull-to-refresh for scrolling screens. */
  readonly refreshControl?: React.ReactElement<RefreshControlProps>;
}

const DEFAULT_EDGES: readonly Edge[] = ['left', 'right'];

// iOS scroll views move their content above the keyboard and to the focused input natively.
const NATIVE_KEYBOARD_INSETS = Platform.OS === 'ios';

/**
 * Root container for every screen: background, safe area, padding, optional scrolling, and
 * keyboard handling, so every form behaves the same:
 *
 * - While the keyboard is open, the screen's bottom is padded by exactly the part the
 *   keyboard covers (useKeyboardInset). The scroll view shrinks, everything stays reachable
 *   by scrolling, and Android's scroll view scrolls the focused input into view (also when
 *   "Next" moves focus to a field lower down). No padding while the keyboard is closed.
 * - Tapping outside an input, or dragging the content, closes the keyboard; taps on buttons
 *   still reach the button (`keyboardShouldPersistTaps="handled"`).
 */
export function Screen({
  children,
  scroll = true,
  edges = DEFAULT_EDGES,
  contentStyle,
  refreshControl,
}: PropsWithChildren<ScreenProps>): React.JSX.Element {
  const theme = useTheme();
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
  const keyboard = useKeyboardInset(containerRef);
  const padding = { padding: theme.spacing.lg, gap: theme.spacing.lg };
  const nativeInsets = scroll && NATIVE_KEYBOARD_INSETS;

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.fill, { backgroundColor: theme.colors.background }]}
    >
      <View
        ref={containerRef}
        onLayout={keyboard.onLayout}
        style={[
          styles.fill,
          !nativeInsets && { paddingBottom: keyboard.inset },
        ]}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={[styles.grow, padding, contentStyle]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={
              Platform.OS === 'ios' ? 'interactive' : 'on-drag'
            }
            automaticallyAdjustKeyboardInsets={nativeInsets}
            {...(refreshControl !== undefined && { refreshControl })}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.fill, padding, contentStyle]}>{children}</View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
});
