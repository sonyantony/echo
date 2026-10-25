import { describe, expect, it } from 'vitest';
import { thumbGeometry } from './canvasScrollbars';

describe('thumbGeometry', () => {
  it('shows no bar when the flow fits the canvas', () => {
    expect(thumbGeometry(0, 500, 50, 450, 496)).toBeUndefined();
  });

  it('sizes the thumb to the share of the flow in view, and places it where the view is', () => {
    // A flow twice the canvas's height, scrolled to the top, then to the bottom.
    expect(thumbGeometry(0, 500, 0, 1000, 500)).toEqual({ size: 250, offset: 0, ratio: 2 });
    expect(thumbGeometry(0, 500, -500, 500, 500)).toEqual({ size: 250, offset: 250, ratio: 2 });
  });

  it('counts empty space dragged into view as part of the scrollable extent', () => {
    // The flow sits below the view: its top edge is 300px down, the bar still reads "at the top".
    const geometry = thumbGeometry(0, 500, 300, 1500, 500)!;
    expect(geometry.offset).toBe(0);
    expect(geometry.size).toBeCloseTo((500 * 500) / 1500);
  });

  it('keeps the thumb big enough to grab on a very long flow', () => {
    expect(thumbGeometry(0, 500, 0, 100_000, 500)!.size).toBe(28);
  });
});
