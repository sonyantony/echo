import { opaqueBounds } from './diagramImage';

/** A width x height RGBA image, transparent except for the given opaque pixels. */
function image(width: number, height: number, opaque: Array<[number, number]>) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of opaque) data[(y * width + x) * 4 + 3] = 255;
  return data;
}

describe('opaqueBounds', () => {
  it('finds the box around the drawn pixels', () => {
    expect(opaqueBounds(image(10, 8, [[2, 3], [6, 5], [4, 1]]), 10, 8)).toEqual({ x: 2, y: 1, width: 5, height: 5 });
  });

  it('returns undefined for a fully transparent image', () => {
    expect(opaqueBounds(image(4, 4, []), 4, 4)).toBeUndefined();
  });
});
