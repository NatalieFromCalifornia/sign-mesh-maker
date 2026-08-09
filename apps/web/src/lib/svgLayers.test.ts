import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  averageColor,
  clusterSimilarColors,
  colorDistance,
  documentOrder,
  groupLayersByColor,
  moveGroup,
  orderFromColors,
  parseSvgLayers,
  resolveFill,
  shapeToPathData,
  SvgParseError,
} from './svgLayers';
import { shapesArea } from './offset';
import {
  CAIRO_PERCENT_SVG,
  HEX_SIGN_SVG,
  EMPTY_SVG,
  OVERLAPPING_SAME_COLOR_SVG,
  SELF_INTERSECTING_SVG,
  STROKE_ONLY_SVG,
  STROKED_BORDER_SVG,
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

  /*
   * Regression: a real sign came back with a membrane webbed across its wide
   * letters. The glyph outlines crossed themselves — legal SVG that every
   * renderer fills correctly — and earcut, which has no fill rule, bridged the
   * crossings with overlapping triangles. Repairing at parse time means the
   * previews and the mesh all see the same simple polygons.
   */
  it('resolves self-crossing outlines into polygons three can triangulate', () => {
    const parsed = parseSvgLayers(SELF_INTERSECTING_SVG);
    const shapes = parsed.layers.flatMap((layer) => layer.shapes);

    let enclosed = 0;
    let covered = 0;
    for (const shape of shapes) {
      const { shape: outline, holes } = shape.extractPoints(1);
      enclosed += Math.abs(THREE.ShapeUtils.area(outline));

      const faces = THREE.ShapeUtils.triangulateShape(outline, holes as THREE.Vector2[][]);
      const points = [...outline, ...holes.flat()];
      for (const [a, b, c] of faces) {
        const p = points[a];
        const q = points[b];
        const r = points[c];
        covered += Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2;
      }
    }

    // The membrane is triangles covering ground the outline never enclosed.
    expect(covered / enclosed).toBeCloseTo(1, 3);
    // The doubly-swept sliver is counted once, not twice or not at all.
    expect(enclosed).toBeGreaterThan(3000);
    expect(enclosed).toBeLessThan(5000);
  });

  /*
   * A printed sign has no strokes, so a stroked outline has to become a fill or
   * it is simply not printed — and nothing says so, because every fill in the
   * file still comes through. A sign whose only border was a stroked rounded
   * rectangle arrived with no border at all.
   */
  it('prints a stroked border as a region of its own', () => {
    const parsed = parseSvgLayers(STROKED_BORDER_SVG);

    expect(parsed.layers.map((l) => l.color)).toEqual(['#e5dac5', '#102132']);

    const [border] = parsed.layers.filter((l) => l.color === '#102132');
    // A stroke straddles its line, so the ring is the perimeter by the width,
    // give or take the corners.
    const perimeter = 2 * (100 + 60);
    expect(shapesArea(border.shapes)).toBeGreaterThan(perimeter * 6 * 0.9);
    expect(shapesArea(border.shapes)).toBeLessThan(perimeter * 6 * 1.2);

    // A ring, not a slab: without the hole the border is a filled panel that
    // covers the whole sign.
    expect(border.shapes[0].holes).toHaveLength(1);
  });

  it('prints a line that has only a stroke', () => {
    const parsed = parseSvgLayers(STROKE_ONLY_SVG);

    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0].color).toBe('#000000');
    // A 4-wide stroke down a diagonal of about 113 units.
    expect(shapesArea(parsed.layers[0].shapes)).toBeGreaterThan(400);
  });

  it('rejects artwork with nothing paintable', () => {
    expect(() => parseSvgLayers(EMPTY_SVG)).toThrow(SvgParseError);
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


describe('moveGroup', () => {
  // Stacks are given as the source-layer indices behind each printed group.
  const stack = [[0], [1], [2]];

  it('moves a group one position up the stack', () => {
    expect(moveGroup(stack, 0, 1)).toEqual([1, 0, 2]);
  });

  it('moves a group one position down', () => {
    expect(moveGroup(stack, 2, 1)).toEqual([0, 2, 1]);
  });

  /*
   * A merged group prints as one layer at one height, so its members have to
   * travel together — splitting them would quietly undo the merge.
   */
  it('keeps the layers of a merged group together', () => {
    const merged = [[0], [1, 3, 4], [2]];
    expect(moveGroup(merged, 1, 0)).toEqual([1, 3, 4, 0, 2]);
  });

  it('parks deleted layers at the end', () => {
    expect(moveGroup(stack, 0, 2, [7, 9])).toEqual([1, 2, 0, 7, 9]);
  });

  it('leaves the stack alone when the move goes nowhere', () => {
    expect(moveGroup(stack, 1, 1)).toEqual([0, 1, 2]);
    expect(moveGroup(stack, 0, -1)).toEqual([0, 1, 2]);
    expect(moveGroup(stack, 0, 3)).toEqual([0, 1, 2]);
  });

  it('does not mutate the stack it was given', () => {
    const original = [[0], [1]];
    moveGroup(original, 0, 1);
    expect(original).toEqual([[0], [1]]);
  });
});

describe('orderFromColors', () => {
  const layers = [
    { color: '#efebe4', shapes: [] },
    { color: '#ad130f', shapes: [] },
    { color: '#ffffff', shapes: [] },
  ];

  it('restores a saved stacking by colour, not by position', () => {
    expect(orderFromColors(layers, ['#ffffff', '#efebe4', '#ad130f'])).toEqual([2, 0, 1]);
  });

  /*
   * Matched by colour for the same reason assignments are: the SVG is
   * re-parsed on open, and a parser change that reorders layers would
   * otherwise apply the saved stacking to the wrong ones.
   */
  it('ignores colours the artwork no longer has', () => {
    expect(orderFromColors(layers, ['#ffffff', '#123456', '#efebe4'])).toEqual([2, 0, 1]);
  });

  it('keeps colours the save never mentioned, at the top', () => {
    expect(orderFromColors(layers, ['#ffffff'])).toEqual([2, 0, 1]);
  });

  it('falls back to document order for an empty save', () => {
    expect(orderFromColors(layers, [])).toEqual([0, 1, 2]);
  });
});

describe('documentOrder', () => {
  it('is the identity permutation', () => {
    expect(documentOrder(4)).toEqual([0, 1, 2, 3]);
    expect(documentOrder(0)).toEqual([]);
  });
});


describe('clusterSimilarColors', () => {
  const layer = (color: string, size: number) => ({
    color,
    shapes: [
      new THREE.Shape([
        new THREE.Vector2(0, 0),
        new THREE.Vector2(size, 0),
        new THREE.Vector2(size, size),
        new THREE.Vector2(0, size),
      ]),
    ],
  });

  /*
   * The report: a sign that reads as three colours arrived as twelve layers.
   * Artwork routinely carries fills that differ only by rounding — a shape
   * recoloured a shade off, a flattened gradient, a round trip through another
   * tool — and each one is otherwise a filament change and another step of
   * height for a difference nobody can see.
   */
  it('folds fills that differ only by rounding', () => {
    const navies = ['#0f2132', '#142434', '#0f2131', '#102232', '#102132', '#0d2031'];
    const creams = ['#e5dac5', '#e7dcc7', '#e6dcc8', '#e6dbc7', '#e5dac6'];
    const layers = [
      ...navies.map((c, i) => layer(c, i === 0 ? 50 : 5)),
      layer('#b9441c', 30),
      ...creams.map((c, i) => layer(c, i === 0 ? 40 : 4)),
    ];

    const assigned = clusterSimilarColors(layers);

    // Twelve fills, three printed colours.
    expect(new Set(assigned).size).toBe(3);
    // The largest region names its cluster, so the colour is one the artwork
    // actually uses rather than an average that appears nowhere in it.
    expect(new Set(assigned)).toEqual(new Set(['#0f2132', '#b9441c', '#e5dac5']));
  });

  /*
   * The limit that keeps it honest. Cream lettering on a white panel is 19.82
   * apart — close, and completely deliberate.
   */
  it('leaves a genuine distinction alone', () => {
    const assigned = clusterSimilarColors([layer('#efebe4', 50), layer('#ffffff', 10)]);
    expect(new Set(assigned).size).toBe(2);
  });

  it('leaves an ordinary palette untouched', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const assigned = clusterSimilarColors(parsed.layers);
    expect(assigned).toEqual(parsed.layers.map((l) => l.color));
  });

  it('folds near-identical blacks but keeps the colours apart', () => {
    const assigned = clusterSimilarColors([
      layer('#000000', 40),
      layer('#010101', 5),
      layer('#020202', 5),
      layer('#ad130f', 20),
    ]);
    expect(assigned).toEqual(['#000000', '#000000', '#000000', '#ad130f']);
  });
});
