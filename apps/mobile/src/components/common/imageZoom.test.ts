import {
  clampPan,
  containedSize,
  DOUBLE_TAP_SCALE,
  doubleTapScale,
  panLimits,
  touchDistance,
} from './imageZoom';

const frame = { width: 400, height: 800 };

describe('image viewer geometry', () => {
  it('fits an image inside the frame keeping its aspect ratio', () => {
    // Landscape photo on a portrait screen: full width.
    expect(containedSize(frame, { width: 1920, height: 1440 })).toEqual({
      width: 400,
      height: 300,
    });
    // Tall photo: full height.
    expect(containedSize(frame, { width: 1000, height: 4000 })).toEqual({
      width: 200,
      height: 800,
    });
    // Unknown size: the frame.
    expect(containedSize(frame, null)).toEqual(frame);
  });

  it('does not pan at scale 1 and pans only up to the edges when zoomed', () => {
    const content = { width: 400, height: 300 };
    expect(panLimits(frame, content, 1)).toEqual({ x: 0, y: 0 });
    // 2x: 800 x 600 in a 400 x 800 frame → 200 each way sideways, none vertically.
    expect(panLimits(frame, content, 2)).toEqual({ x: 200, y: 0 });
    expect(clampPan({ x: 500, y: 90 }, frame, content, 2)).toEqual({
      x: 200,
      y: 0,
    });
    expect(clampPan({ x: -120, y: 0 }, frame, content, 2)).toEqual({
      x: -120,
      y: 0,
    });
  });

  it('measures pinch distance and toggles zoom on double tap', () => {
    expect(touchDistance({ x: 0, y: 0 }, { x: 30, y: 40 })).toBe(50);
    expect(doubleTapScale(1)).toBe(DOUBLE_TAP_SCALE);
    expect(doubleTapScale(3)).toBe(1);
  });
});
