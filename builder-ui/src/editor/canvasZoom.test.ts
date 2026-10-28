import { describe, expect, it } from 'vitest';
import { MAX_FIT_SCALE, fitMove } from './canvasZoom';

const view = { left: 0, top: 100, width: 1800, height: 700 };

describe('fitMove', () => {
  it('zooms a small route in past 100% to fill the canvas, and centres it', () => {
    // The route of the report: 1100 x 300 at 100%, up and to the left of the middle.
    const move = fitMove(view, { left: 290, top: 170, width: 1100, height: 300 }, 1)!;
    expect(move.factor).toBeCloseTo(1720 / 1100);
    expect(move.dx).toBe(290 + 550 - 900);
    expect(move.dy).toBe(170 + 150 - 450);
  });

  it('stops at the largest zoom, counting the zoom already there', () => {
    const tiny = { left: 800, top: 400, width: 100, height: 40 };
    expect(fitMove(view, tiny, 1)!.factor).toBeCloseTo(MAX_FIT_SCALE);
    expect(fitMove(view, tiny, 2)!.factor).toBeCloseTo(MAX_FIT_SCALE / 2);
  });

  it('zooms out a route bigger than the canvas', () => {
    const move = fitMove(view, { left: 0, top: 0, width: 3440, height: 500 }, 1)!;
    expect(move.factor).toBeCloseTo(0.5);
  });

  it('does nothing for an empty box', () => {
    expect(fitMove(view, { left: 0, top: 0, width: 0, height: 10 }, 1)).toBeUndefined();
  });
});
