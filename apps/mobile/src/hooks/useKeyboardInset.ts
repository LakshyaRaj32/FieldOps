import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentRef,
  type RefObject,
} from 'react';
import {
  Keyboard,
  Platform,
  type KeyboardEvent,
  type View,
} from 'react-native';

type ViewHandle = ComponentRef<typeof View>;

/**
 * How much of a view the software keyboard covers, in dp, so the view can pad its bottom by
 * that much and keep its content above the keyboard.
 *
 * The app is edge-to-edge (android/gradle.properties), so Android no longer resizes the
 * window for the keyboard: the overlap is computed from the view's position in the window
 * and the keyboard's top edge (`screenY`, in the same window coordinates). Measuring the view
 * itself, rather than assuming it starts at the top of the screen, keeps the result right
 * below any header, banner or tab bar, which is what KeyboardAvoidingView's
 * `keyboardVerticalOffset` would otherwise have to guess.
 *
 * Returns 0 while the keyboard is hidden, so closed forms get no extra space.
 */
export function useKeyboardInset(viewRef: RefObject<ViewHandle | null>): {
  readonly inset: number;
  /** Pass to the view's `onLayout`: the overlap changes when the view moves or resizes. */
  readonly onLayout: () => void;
} {
  const [inset, setInset] = useState(0);
  const keyboardTop = useRef<number | null>(null);

  const measure = useCallback(() => {
    const top = keyboardTop.current;
    const view = viewRef.current;
    if (top === null || view === null) {
      setInset(0);
      return;
    }
    view.measureInWindow((_x, y, _width, height) => {
      // The keyboard may have closed while the measurement was in flight.
      if (keyboardTop.current === null) {
        return;
      }
      setInset(Math.max(0, Math.round(y + height - top)));
    });
  }, [viewRef]);

  useEffect(() => {
    const onShow = (event: KeyboardEvent) => {
      keyboardTop.current = event.endCoordinates.screenY;
      measure();
    };
    const onHide = () => {
      keyboardTop.current = null;
      setInset(0);
    };
    // Android only emits the "did" events; iOS announces changes before they animate.
    const subscriptions =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillChangeFrame', onShow),
            Keyboard.addListener('keyboardWillHide', onHide),
          ]
        : [
            Keyboard.addListener('keyboardDidShow', onShow),
            Keyboard.addListener('keyboardDidHide', onHide),
          ];
    return () => subscriptions.forEach(subscription => subscription.remove());
  }, [measure]);

  // While the keyboard is open, a layout change (the tab bar hiding, a banner appearing)
  // moves the view, so the overlap is measured again. The padding itself does not change
  // the view's frame, so this cannot loop.
  const onLayout = useCallback(() => {
    if (keyboardTop.current !== null) {
      measure();
    }
  }, [measure]);

  return { inset, onLayout };
}
