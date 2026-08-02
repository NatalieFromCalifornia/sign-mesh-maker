import { describe, expect, it } from 'vitest';
import { quantize } from './quantize';
import { colorDistance, rgbToHex } from './svgLayers';

interface Region {
  color: [number, number, number];
  /** Fraction of the image this colour covers. */
  share: number;
}

/** Builds an image whose colours cover exactly the requested proportions. */
function imageOf(regions: Region[], size = 120): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  const total = size * size;

  let pixel = 0;
  regions.forEach((region, index) => {
    const last = index === regions.length - 1;
    const count = last ? total - pixel : Math.round(total * region.share);
    for (let n = 0; n < count && pixel < total; n++, pixel++) {
      const i = pixel * 4;
      data[i] = region.color[0];
      data[i + 1] = region.color[1];
      data[i + 2] = region.color[2];
      data[i + 3] = 255;
    }
  });

  return { data, width: size, height: size, colorSpace: 'srgb' } as ImageData;
}

const asHex = (palette: { r: number; g: number; b: number }[]) => palette.map(rgbToHex);

/** Distance from `target` to the nearest palette entry. */
const closest = (palette: { r: number; g: number; b: number }[], target: string) =>
  Math.min(...asHex(palette).map((c) => colorDistance(c, target)));

describe('quantize', () => {
  /*
   * The failure that shipped: a poster of mostly cream with large black, red
   * and yellow regions. The tracer's own sampler returned three near-identical
   * creams and no black at all, so every black pixel snapped to the nearest
   * survivor — dark red — and a whole colour vanished into it.
   */
  it('finds a large dark region on a light background', () => {
    const palette = quantize(
      imageOf([
        { color: [247, 242, 204], share: 0.6 },
        { color: [219, 36, 31], share: 0.15 },
        { color: [247, 184, 8], share: 0.15 },
        { color: [8, 7, 5], share: 0.1 },
      ]),
      8,
    );

    expect(closest(palette, '#080705')).toBeLessThan(12);
    expect(closest(palette, '#db241f')).toBeLessThan(12);
    expect(closest(palette, '#f7b808')).toBeLessThan(12);
    expect(closest(palette, '#f7f2cc')).toBeLessThan(12);
  });

  it('does not spend the palette on near-identical shades of one colour', () => {
    const palette = quantize(
      imageOf([
        { color: [247, 242, 204], share: 0.5 },
        { color: [246, 241, 206], share: 0.3 },
        { color: [8, 7, 5], share: 0.2 },
      ]),
      8,
    );

    const hexes = asHex(palette);
    for (let i = 0; i < hexes.length; i++) {
      for (let j = i + 1; j < hexes.length; j++) {
        expect(colorDistance(hexes[i], hexes[j])).toBeGreaterThan(3);
      }
    }
  });

  it('discards clusters covering almost none of the image', () => {
    // Antialiased edges are a thin band of an in-between colour. Kept as a
    // layer, the tracer draws it as a grubby outline around every shape.
    const palette = quantize(
      imageOf([
        { color: [255, 255, 255], share: 0.55 },
        { color: [0, 0, 0], share: 0.44 },
        { color: [128, 128, 128], share: 0.01 },
      ]),
      6,
    );

    expect(closest(palette, '#808080')).toBeGreaterThan(20);
  });

  it('keeps a colour that covers a meaningful share', () => {
    const palette = quantize(
      imageOf([
        { color: [255, 255, 255], share: 0.6 },
        { color: [0, 0, 0], share: 0.3 },
        { color: [128, 128, 128], share: 0.1 },
      ]),
      6,
    );

    expect(closest(palette, '#808080')).toBeLessThan(12);
  });

  it('is deterministic for the same image and count', () => {
    // Nudging the colour count must refine the palette, not reshuffle it.
    const build = () =>
      imageOf([
        { color: [247, 242, 204], share: 0.5 },
        { color: [219, 36, 31], share: 0.3 },
        { color: [8, 7, 5], share: 0.2 },
      ]);

    expect(asHex(quantize(build(), 5))).toEqual(asHex(quantize(build(), 5)));
  });

  it('never returns more colours than requested', () => {
    const image = imageOf([
      { color: [255, 0, 0], share: 0.25 },
      { color: [0, 255, 0], share: 0.25 },
      { color: [0, 0, 255], share: 0.25 },
      { color: [255, 255, 0], share: 0.25 },
    ]);

    expect(quantize(image, 3).length).toBeLessThanOrEqual(3);
    expect(quantize(image, 8).length).toBeLessThanOrEqual(8);
  });

  it('always returns at least one colour, even for a flat image', () => {
    const palette = quantize(imageOf([{ color: [10, 20, 30], share: 1 }]), 8);
    expect(palette.length).toBeGreaterThanOrEqual(1);
    expect(closest(palette, '#0a141e')).toBeLessThan(6);
  });

  it('ignores fully transparent pixels', () => {
    const size = 60;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      const opaque = i < data.length / 2;
      data[i] = opaque ? 219 : 0;
      data[i + 1] = opaque ? 36 : 255;
      data[i + 2] = opaque ? 31 : 0;
      data[i + 3] = opaque ? 255 : 0;
    }
    const palette = quantize(
      { data, width: size, height: size, colorSpace: 'srgb' } as ImageData,
      4,
    );

    // The transparent half is bright green; it must not reach the palette.
    expect(closest(palette, '#00ff00')).toBeGreaterThan(40);
  });
});
