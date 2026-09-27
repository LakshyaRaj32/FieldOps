/**
 * The geometry of the full-screen image viewer's pinch-zoom and pan. Pure, so the limits
 * are unit-tested without touch events.
 */

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
/** Double tap zooms to this, or back to 1 when already zoomed. */
export const DOUBLE_TAP_SCALE = 2.5;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** The distance between two touches (for pinch). */
export function touchDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The size an image of `image` proportions takes inside `frame` with "contain": as large as
 * possible without cropping, aspect ratio kept. Without the image's size, the frame.
 */
export function containedSize(frame: Size, image: Size | null): Size {
  if (image === null || image.width <= 0 || image.height <= 0) {
    return frame;
  }
  const scale = Math.min(
    frame.width / image.width,
    frame.height / image.height,
  );
  return { width: image.width * scale, height: image.height * scale };
}

/**
 * How far the zoomed image may move from center before an edge would come inside the frame:
 * at scale 1 it cannot move; zoomed in, each edge can reach the frame's edge but not beyond.
 */
export function panLimits(frame: Size, content: Size, scale: number): Point {
  return {
    x: Math.max(0, (content.width * scale - frame.width) / 2),
    y: Math.max(0, (content.height * scale - frame.height) / 2),
  };
}

export function clampPan(
  pan: Point,
  frame: Size,
  content: Size,
  scale: number,
): Point {
  const limits = panLimits(frame, content, scale);
  return {
    x: clamp(pan.x, -limits.x, limits.x),
    y: clamp(pan.y, -limits.y, limits.y),
  };
}

/** The scale after a double tap. */
export function doubleTapScale(scale: number): number {
  return scale > MIN_SCALE + 0.01 ? MIN_SCALE : DOUBLE_TAP_SCALE;
}
