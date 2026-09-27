import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '../../theme';

export interface SkeletonProps {
  readonly width?: DimensionValue;
  readonly height?: number;
  /** Defaults to the small radius; pass `pill` for avatars and chips. */
  readonly radius?: 'sm' | 'md' | 'pill';
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * A placeholder block shown while content loads, in the shape of that content, so the
 * layout does not jump when data arrives. Pulses gently (static when the user asked the
 * system to reduce motion). Hidden from screen readers: the container announces loading.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = 'sm',
  style,
}: SkeletonProps): React.JSX.Element {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(reduce => {
        if (reduce || cancelled) {
          return;
        }
        animation = Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 0.45,
              duration: 700,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 1,
              duration: 700,
              useNativeDriver: true,
            }),
          ]),
        );
        animation.start();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      animation?.stop();
    };
  }, [opacity]);

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          opacity,
          borderRadius: theme.radii[radius],
          backgroundColor: theme.colors.surfaceMuted,
        },
        style,
      ]}
    />
  );
}
