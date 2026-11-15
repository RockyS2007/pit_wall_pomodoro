import { describe, expect, it } from 'vitest';
import { clampToScreens, defaultPosition, isDrag } from '../src/core/position';

const size = { width: 300, height: 208 };
const laptop = { x: 0, y: 0, width: 2880, height: 1800 };
const external = { x: 2880, y: 0, width: 3840, height: 2160 };

describe('pet position', () => {
  it('keeps a saved position that is on screen', () => {
    expect(clampToScreens({ x: 500, y: 400 }, size, [laptop])).toEqual({ x: 500, y: 400 });
    expect(clampToScreens({ x: 4000, y: 900 }, size, [laptop, external])).toEqual({ x: 4000, y: 900 });
  });

  it('nudges a window that hangs off the edge back on', () => {
    expect(clampToScreens({ x: 2700, y: 1650 }, size, [laptop])).toEqual({ x: 2580, y: 1592 });
    expect(clampToScreens({ x: -100, y: -50 }, size, [laptop])).toEqual({ x: 0, y: 0 });
  });

  it('moves to the primary screen when its monitor was unplugged', () => {
    const saved = { x: 5000, y: 1200 };
    expect(clampToScreens(saved, size, [laptop, external])).toEqual(saved);
    expect(clampToScreens(saved, size, [laptop])).toEqual(defaultPosition(size, laptop));
  });

  it('uses the default corner on first launch', () => {
    expect(clampToScreens(null, size, [laptop])).toEqual({ x: 2532, y: 1496 });
  });

  it('handles screens placed left of or above the primary one', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    expect(clampToScreens({ x: -1000, y: 500 }, size, [laptop, left])).toEqual({ x: -1000, y: 500 });
    expect(clampToScreens({ x: -1950, y: 500 }, size, [laptop, left])).toEqual({ x: -1920, y: 500 });
  });

  it('leaves the position alone if no screens are reported', () => {
    expect(clampToScreens({ x: 1, y: 2 }, size, [])).toEqual({ x: 1, y: 2 });
  });

  it('tells a click from a drag at about 4 px', () => {
    expect(isDrag({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(false);
    expect(isDrag({ x: 10, y: 10 }, { x: 12.5, y: 12.5 })).toBe(false);
    expect(isDrag({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
    expect(isDrag({ x: 10, y: 10 }, { x: 7, y: 7 })).toBe(true);
  });
});
