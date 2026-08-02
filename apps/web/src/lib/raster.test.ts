import { describe, expect, it } from 'vitest';
import {
  MAX_COLOR_COUNT,
  MIN_COLOR_COUNT,
  isRasterFile,
  traceImageData,
} from './raster';
import { parseSvgLayers } from './svgLayers';

/**
 * Flat-colour artwork: four regions, no gradients, no antialiasing.
 *
 * Built as a plain object rather than `new ImageData(...)` because jsdom has no
 * canvas and therefore no ImageData constructor. The tracer reads only `data`,
 * `width` and `height`, so this is the whole contract — and it keeps the suite
 * free of a native canvas dependency.
 */
function fourColorImage(size = 64): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  const put = (i: number, [r, g, b]: number[]) => {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (x < size / 2 && y < size / 2) put(i, [242, 104, 28]);
      else if (x >= size / 2 && y < size / 2) put(i, [47, 157, 143]);
      else if (x < size / 2) put(i, [77, 127, 190]);
      else put(i, [231, 237, 236]);
    }
  }
  return { data, width: size, height: size, colorSpace: 'srgb' } as ImageData;
}

describe('isRasterFile', () => {
  const asFile = (name: string, type: string) => new File([''], name, { type });

  it('accepts the raster formats the picker offers', () => {
    expect(isRasterFile(asFile('a.png', 'image/png'))).toBe(true);
    expect(isRasterFile(asFile('a.jpg', 'image/jpeg'))).toBe(true);
    expect(isRasterFile(asFile('a.webp', 'image/webp'))).toBe(true);
  });

  it('recognises by extension when the browser reports no type', () => {
    expect(isRasterFile(asFile('photo.JPEG', ''))).toBe(true);
  });

  it('rejects vector and unrelated files', () => {
    expect(isRasterFile(asFile('a.svg', 'image/svg+xml'))).toBe(false);
    expect(isRasterFile(asFile('a.pdf', 'application/pdf'))).toBe(false);
  });
});

describe('traceImageData', () => {
  it('produces SVG that the layer parser understands', () => {
    const { svg } = traceImageData(fourColorImage(), 4);

    expect(svg).toContain('<svg');
    const parsed = parseSvgLayers(svg);
    expect(parsed.layers.length).toBeGreaterThan(0);
  });

  it('returns a palette with no duplicates', () => {
    // The quantizer targets the requested count but converges lower on flat
    // artwork; raw entries repeat, which would promise colours that never print.
    const { palette } = traceImageData(fourColorImage(), 8);
    expect(new Set(palette).size).toBe(palette.length);
  });

  it('never reports more colours than were asked for', () => {
    const { palette } = traceImageData(fourColorImage(), 4);
    expect(palette.length).toBeLessThanOrEqual(4);
  });

  it('emits palette entries as hex', () => {
    const { palette } = traceImageData(fourColorImage(), 4);
    for (const color of palette) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('finds more colours as the count rises', () => {
    const few = traceImageData(fourColorImage(), 2).palette.length;
    const many = traceImageData(fourColorImage(), 8).palette.length;
    expect(many).toBeGreaterThanOrEqual(few);
  });

  it('traces deterministically for a given count', () => {
    // colorsampling: 2 is deterministic, so nudging the count must not
    // reshuffle unrelated regions.
    const a = traceImageData(fourColorImage(), 4);
    const b = traceImageData(fourColorImage(), 4);
    expect(a.palette).toEqual(b.palette);
    expect(a.svg).toBe(b.svg);
  });

  it('clamps the requested count into the supported range', () => {
    expect(traceImageData(fourColorImage(), 0).palette.length).toBeLessThanOrEqual(
      MIN_COLOR_COUNT,
    );
    expect(traceImageData(fourColorImage(), 999).palette.length).toBeLessThanOrEqual(
      MAX_COLOR_COUNT,
    );
  });
});
