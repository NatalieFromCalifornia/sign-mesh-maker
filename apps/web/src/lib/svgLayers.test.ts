import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  averageColor,
  colorDistance,
  groupLayersByColor,
  mergeSimilarColors,
  parseSvgLayers,
  resolveFill,
  shapeToPathData,
  SvgParseError,
} from './svgLayers';
import {
  CAIRO_PERCENT_SVG,
  HEX_SIGN_SVG,
  OVERLAPPING_SAME_COLOR_SVG,
  STROKE_ONLY_SVG,
} from '../test/fixtures';

const FALLBACK = new THREE.Color('#ffffff');

describe('resolveFill', () => {
  /*
   * Regression: three's Color.setStyle matches percentage rgb with `(\d+)%`,
   * so decimals never matched and every colour silently became white. Cairo
   * writes fills this way, which is most Inkscape and PDF-derived output.
   */
  it('parses percentage rgb carrying decimals', () => {
    expect(resolveFill('rgb(75.72937%, 87.400818%, 96.116638%)', FALLBACK)).toBe('#c1dff5');
    expect(resolveFill('rgb(17.643738%, 16.757202%, 17.834473%)', FALLBACK)).toBe('#2d2b2d');
  });

  it('does not collapse distinct decimal-percentage fills to one colour', () => {
    const colors = [
      'rgb(75.72937%, 87.400818%, 96.116638%)',
      'rgb(85.414124%, 93.208313%, 98.08197%)',
      'rgb(56.521606%, 73.13385%, 90.461731%)',
    ].map((c) => resolveFill(c, FALLBACK));

    expect(new Set(colors).size).toBe(3);
    expect(colors).not.toContain('#ffffff');
  });

  it('parses whole-number percentages', () => {
    expect(resolveFill('rgb(100%, 100%, 100%)', FALLBACK)).toBe('#ffffff');
    expect(resolveFill('rgb(0%, 0%, 0%)', FALLBACK)).toBe('#000000');
  });

  it('parses numeric rgb, hex and named colours', () => {
    expect(resolveFill('rgb(242, 104, 28)', FALLBACK)).toBe('#f2681c');
    expect(resolveFill('#2f9d8f', FALLBACK)).toBe('#2f9d8f');
    expect(resolveFill('#FFF', FALLBACK)).toBe('#ffffff');
    expect(resolveFill('red', FALLBACK)).toBe('#ff0000');
  });

  it('handles whitespace-separated and alpha forms', () => {
    expect(resolveFill('rgba(242, 104, 28, 0.5)', FALLBACK)).toBe('#f2681c');
    expect(resolveFill('rgb(242 104 28)', FALLBACK)).toBe('#f2681c');
  });

  it('falls back for absent or unpaintable values', () => {
    expect(resolveFill(undefined, new THREE.Color('#123456'))).toBe('#123456');
    expect(resolveFill('none', new THREE.Color('#123456'))).toBe('#123456');
  });
});

describe('parseSvgLayers', () => {
  it('groups one layer per distinct fill, in document order', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    expect(parsed.layers.map((l) => l.color)).toEqual(['#2f9d8f', '#f2681c', '#ffffff']);
  });

  it('keeps decimal-percentage fills distinct end to end', () => {
    const parsed = parseSvgLayers(CAIRO_PERCENT_SVG);

    // The bug produced exactly one all-white layer here.
    expect(parsed.layers).toHaveLength(3);
    expect(parsed.layers.map((l) => l.color)).toEqual(['#c1dff5', '#f28f62', '#2d2b2d']);
  });

  it('reports artwork extents in SVG units', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    expect(parsed.width).toBeCloseTo(200, 5);
    expect(parsed.height).toBeCloseTo(100, 5);
  });

  it('keeps same-colour shapes separate rather than merging them', () => {
    const parsed = parseSvgLayers(OVERLAPPING_SAME_COLOR_SVG);

    // One layer, but two shapes — merging them into a single path made
    // fill-rule cancel the overlap into a hole.
    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0].shapes.length).toBe(2);
  });

  it('rejects artwork with nothing fillable', () => {
    expect(() => parseSvgLayers(STROKE_ONLY_SVG)).toThrow(SvgParseError);
  });
});

describe('shapeToPathData', () => {
  it('emits a closed path and restores SVG Y-down orientation', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const d = shapeToPathData(parsed.layers[0].shapes[0]);

    expect(d.startsWith('M')).toBe(true);
    expect(d.trimEnd().endsWith('Z')).toBe(true);

    // Shapes are stored Y-up; emitted path data must be back in SVG space,
    // where the fixture's rect spans y 0..100 rather than -100..0.
    const ys = [...d.matchAll(/[ML]-?[\d.]+ (-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeCloseTo(100, 1);
  });
});

describe('colour helpers', () => {
  it('measures distance as zero for identical colours', () => {
    expect(colorDistance('#ff8800', '#ff8800')).toBe(0);
  });

  it('rates near-identical blues closer than clearly different colours', () => {
    const nearlySame = colorDistance('#4d7fbe', '#4f81c0');
    const different = colorDistance('#4d7fbe', '#f2681c');
    expect(nearlySame).toBeLessThan(different);
    expect(nearlySame).toBeLessThan(14);
  });

  it('averages colours channel-wise', () => {
    expect(averageColor(['#000000', '#ffffff'])).toBe('#808080');
    expect(averageColor(['#ff0000', '#00ff00', '#0000ff'])).toBe('#555555');
  });
});

describe('groupLayersByColor', () => {
  const parsed = () => parseSvgLayers(HEX_SIGN_SVG);

  it('leaves layers alone when nothing is reassigned', () => {
    const layers = parsed().layers;
    const groups = groupLayersByColor(layers, []);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.sourceIndices)).toEqual([[0], [1], [2]]);
  });

  it('folds layers sharing an assigned colour into one', () => {
    const layers = parsed().layers;
    const groups = groupLayersByColor(layers, ['#111111', '#111111', '#222222']);

    expect(groups).toHaveLength(2);
    expect(groups[0].sourceIndices).toEqual([0, 1]);
    // Shapes are combined, so the merge produces one printed layer, not two.
    expect(groups[0].shapes.length).toBe(layers[0].shapes.length + layers[1].shapes.length);
  });

  it('keeps first-appearance order so z-order is stable', () => {
    const layers = parsed().layers;
    const groups = groupLayersByColor(layers, ['#aaaaaa', '#bbbbbb', '#aaaaaa']);
    expect(groups.map((g) => g.color)).toEqual(['#aaaaaa', '#bbbbbb']);
    expect(groups[0].sourceIndices).toEqual([0, 2]);
  });

  it('treats colour case as insignificant', () => {
    const layers = parsed().layers;
    const groups = groupLayersByColor(layers, ['#ABCDEF', '#abcdef', '#123456']);
    expect(groups).toHaveLength(2);
  });
});

describe('mergeSimilarColors', () => {
  it('collapses near-identical colours onto a shared average', () => {
    const merged = mergeSimilarColors(['#4d7fbe', '#4f81c0', '#f2681c'], 14);
    expect(merged[0]).toBe(merged[1]);
    expect(merged[2]).toBe('#f2681c');
    expect(new Set(merged).size).toBe(2);
  });

  it('leaves genuinely distinct colours untouched', () => {
    const colors = ['#2f9d8f', '#f2681c', '#ffffff', '#2d2b2d'];
    expect(mergeSimilarColors(colors, 14)).toEqual(colors);
  });

  it('preserves length and position', () => {
    const colors = ['#000000', '#010101', '#ffffff'];
    const merged = mergeSimilarColors(colors, 14);
    expect(merged).toHaveLength(3);
    expect(merged[2]).toBe('#ffffff');
  });
});
