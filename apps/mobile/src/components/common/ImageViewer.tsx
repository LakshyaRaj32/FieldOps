import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type ImageSourcePropType,
  type NativeTouchEvent,
  type PanResponderGestureState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { AppText, Icon, type IconName } from '../ui';
import {
  clamp,
  clampPan,
  containedSize,
  doubleTapScale,
  MAX_SCALE,
  MIN_SCALE,
  touchDistance,
  type Size,
} from './imageZoom';

/** The viewer is always dark, like the platform's photo viewers, in both themes. */
const BACKDROP = '#000000';
const ON_BACKDROP = '#FFFFFF';
const CONTROL_BACKGROUND = 'rgba(255, 255, 255, 0.16)';
const CAPTION_BACKGROUND = 'rgba(0, 0, 0, 0.55)';

const DOUBLE_TAP_MS = 280;
const TAP_SLOP = 8;
/** At scale 1, dragging down this far and letting go closes the viewer. */
const SWIPE_CLOSE_DISTANCE = 120;

export interface ImageViewerProps {
  readonly visible: boolean;
  /** The same source as the thumbnail (a local file or the authorized download). */
  readonly source: ImageSourcePropType | null;
  /** Describes the photo for screen readers and is shown at the bottom. */
  readonly caption: string;
  readonly onClose: () => void;
}

interface GestureStart {
  scale: number;
  x: number;
  y: number;
  distance: number;
  touches: number;
  dx: number;
  dy: number;
}

/**
 * A full-screen photo viewer: the image fills the screen without cropping (aspect ratio kept),
 * pinch or double-tap to zoom (up to 4x), drag to move around when zoomed, and close with
 * the button, the Android back button or a downward swipe. Zoom also has a button, for
 * people who can't pinch or use a screen reader. Built on React Native's PanResponder and
 * Animated, so it needs no gesture library.
 */
export function ImageViewer({
  visible,
  source,
  caption,
  onClose,
}: ImageViewerProps): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [frame, setFrame] = useState<Size>({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState<Size | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const current = useRef({ scale: 1, x: 0, y: 0 });
  const start = useRef<GestureStart>({
    scale: 1,
    x: 0,
    y: 0,
    distance: 0,
    touches: 0,
    dx: 0,
    dy: 0,
  });
  const lastTap = useRef(0);
  const layout = useRef({ frame, content: frame });
  layout.current = { frame, content: containedSize(frame, imageSize) };

  const apply = (next: { scale: number; x: number; y: number }) => {
    current.current = next;
    scale.setValue(next.scale);
    translateX.setValue(next.x);
    translateY.setValue(next.y);
  };

  const animateTo = (next: { scale: number; x: number; y: number }) => {
    current.current = next;
    setZoomed(next.scale > MIN_SCALE + 0.01);
    Animated.parallel(
      [
        Animated.spring(scale, { toValue: next.scale, useNativeDriver: true }),
        Animated.spring(translateX, { toValue: next.x, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: next.y, useNativeDriver: true }),
      ],
      { stopTogether: false },
    ).start();
  };

  const zoomTo = (target: number) => animateTo({ scale: target, x: 0, y: 0 });

  // Every opening starts at full view.
  useEffect(() => {
    if (visible) {
      apply({ scale: 1, x: 0, y: 0 });
      setZoomed(false);
      setFailed(false);
      setLoading(true);
      setImageSize(null);
    }
    // `apply` only touches refs and animated values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, source]);

  const responder = useMemo(() => {
    const begin = (
      touches: readonly NativeTouchEvent[],
      gesture: PanResponderGestureState,
    ) => {
      const [first, second] = touches;
      start.current = {
        ...current.current,
        distance:
          first !== undefined && second !== undefined
            ? touchDistance(
                { x: first.pageX, y: first.pageY },
                { x: second.pageX, y: second.pageY },
              )
            : 0,
        touches: touches.length,
        dx: gesture.dx,
        dy: gesture.dy,
      };
    };

    const move = (
      event: GestureResponderEvent,
      gesture: PanResponderGestureState,
    ) => {
      const { touches } = event.nativeEvent;
      if (touches.length !== start.current.touches) {
        // A finger was added or lifted: continue from where the image is now.
        begin(touches, gesture);
        return;
      }
      const { frame: frameSize, content } = layout.current;
      const base = start.current;
      const [first, second] = touches;
      if (first !== undefined && second !== undefined && base.distance > 0) {
        const distance = touchDistance(
          { x: first.pageX, y: first.pageY },
          { x: second.pageX, y: second.pageY },
        );
        const nextScale = clamp(
          (base.scale * distance) / base.distance,
          MIN_SCALE,
          MAX_SCALE,
        );
        apply({
          scale: nextScale,
          ...clampPan({ x: base.x, y: base.y }, frameSize, content, nextScale),
        });
        return;
      }
      const dx = gesture.dx - base.dx;
      const dy = gesture.dy - base.dy;
      if (base.scale > MIN_SCALE + 0.01) {
        apply({
          scale: base.scale,
          ...clampPan(
            { x: base.x + dx, y: base.y + dy },
            frameSize,
            content,
            base.scale,
          ),
        });
      } else {
        // Not zoomed: the photo follows a downward drag (swipe to close).
        apply({ scale: 1, x: 0, y: Math.max(0, dy) });
      }
    };

    const end = (
      _event: GestureResponderEvent,
      gesture: PanResponderGestureState,
    ) => {
      const now = Date.now();
      const tapped =
        Math.abs(gesture.dx) < TAP_SLOP && Math.abs(gesture.dy) < TAP_SLOP;
      const { scale: currentScale } = current.current;
      if (tapped) {
        if (now - lastTap.current < DOUBLE_TAP_MS) {
          lastTap.current = 0;
          zoomTo(doubleTapScale(currentScale));
        } else {
          lastTap.current = now;
        }
        return;
      }
      if (currentScale <= MIN_SCALE + 0.01) {
        if (gesture.dy > SWIPE_CLOSE_DISTANCE) {
          onClose();
          return;
        }
        zoomTo(MIN_SCALE);
        return;
      }
      setZoomed(true);
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event, gesture) =>
        begin(event.nativeEvent.touches, gesture),
      onPanResponderMove: move,
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
      // Keep the gesture while pinching or panning.
      onPanResponderTerminationRequest: () => false,
    });
    // The handlers read everything that changes through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
    >
      <StatusBar barStyle="light-content" />
      <View
        style={[styles.fill, { backgroundColor: BACKDROP }]}
        onLayout={event => {
          const { width, height } = event.nativeEvent.layout;
          setFrame({ width, height });
        }}
      >
        <View style={styles.fill} {...responder.panHandlers}>
          {source !== null && !failed ? (
            <Animated.View
              style={[
                styles.fill,
                {
                  transform: [{ translateX }, { translateY }, { scale }],
                },
              ]}
            >
              <Image
                source={source}
                style={styles.fill}
                resizeMode="contain"
                accessibilityLabel={caption}
                onLoad={event => {
                  const { width, height } = event.nativeEvent.source;
                  setImageSize({ width, height });
                  setLoading(false);
                }}
                onError={() => {
                  setLoading(false);
                  setFailed(true);
                }}
              />
            </Animated.View>
          ) : null}
          {loading && !failed && source !== null ? (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <ActivityIndicator color={ON_BACKDROP} size="large" />
            </View>
          ) : null}
          {failed || source === null ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                styles.center,
                { gap: theme.spacing.sm, padding: theme.spacing.xl },
              ]}
            >
              <Icon name="image-outline" size="xl" color={ON_BACKDROP} />
              <AppText style={[styles.onBackdrop, styles.centerText]}>
                {source === null
                  ? 'This photo is not on this phone.'
                  : "The photo couldn't be loaded. Check your connection and try again."}
              </AppText>
            </View>
          ) : null}
        </View>

        <View
          style={[
            styles.controls,
            {
              top: insets.top + theme.spacing.sm,
              right: insets.right + theme.spacing.md,
              gap: theme.spacing.sm,
            },
          ]}
        >
          {source !== null && !failed ? (
            <ViewerButton
              icon={zoomed ? 'contract-outline' : 'expand-outline'}
              label={zoomed ? 'Zoom out' : 'Zoom in'}
              onPress={() => zoomTo(doubleTapScale(current.current.scale))}
            />
          ) : null}
          <ViewerButton icon="close" label="Close photo" onPress={onClose} />
        </View>

        <View
          pointerEvents="none"
          style={[
            styles.caption,
            {
              paddingBottom: insets.bottom + theme.spacing.md,
              paddingTop: theme.spacing.md,
              paddingHorizontal: theme.spacing.lg,
              backgroundColor: CAPTION_BACKGROUND,
              gap: theme.spacing.xxs,
            },
          ]}
        >
          <AppText variant="bodyStrong" style={styles.onBackdrop}>
            {caption}
          </AppText>
          {source !== null && !failed ? (
            <AppText variant="caption" style={styles.hint}>
              Pinch or double-tap to zoom · Swipe down to close
            </AppText>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function ViewerButton({
  icon,
  label,
  onPress,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: CONTROL_BACKGROUND },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} size="lg" color={ON_BACKDROP} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  controls: { position: 'absolute', flexDirection: 'row' },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  onBackdrop: { color: ON_BACKDROP },
  hint: { color: 'rgba(255, 255, 255, 0.8)' },
});
