import { describe, expect, it } from 'vitest';
import { ensureVisibleBounds } from './windowBounds';

describe('ensureVisibleBounds', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
  const fallback = { x: 1512, y: 470, width: 380, height: 520 };

  it('keeps visible bounds inside the current screen', () => {
    expect(ensureVisibleBounds(fallback, [workArea], fallback)).toEqual(fallback);
  });

  it('centers a fully offscreen window', () => {
    expect(ensureVisibleBounds({ x: 4000, y: 3000, width: 380, height: 520 }, [workArea], fallback)).toEqual({
      x: 770,
      y: 256,
      width: 380,
      height: 520
    });
  });

  it('clamps a partially offscreen window back into the work area', () => {
    expect(ensureVisibleBounds({ x: 1800, y: 900, width: 380, height: 520 }, [workArea], fallback)).toEqual({
      x: 1540,
      y: 512,
      width: 380,
      height: 520
    });
  });

  it('uses the work area that contains most of the window', () => {
    const secondary = { x: 1920, y: 0, width: 1280, height: 900 };

    expect(ensureVisibleBounds({ x: 2200, y: 200, width: 380, height: 520 }, [workArea, secondary], fallback)).toEqual({
      x: 2200,
      y: 200,
      width: 380,
      height: 520
    });
  });
});
