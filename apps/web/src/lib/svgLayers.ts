import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { repairShapes } from './offset';

export interface SvgLayer {
  /** Fill color as `#rrggbb`, and the identity used to group regions. */
  color: string;
  shapes: THREE.Shape[];
}

export interface ParsedSvg {
  layers: SvgLayer[];
  /** Extents of the artwork in SVG user units, used to scale to millimetres. */
  width: number;
  height: number;
  /** Artwork bounds in the flipped (Y-up) space the shapes live in. */
  bounds: THREE.Box2;
}

/**
 * Flattens a shape's curves to polylines and negates Y.
 *
 * SVG's Y axis points down and three.js's points up. Correcting that with a
 * negative scale would invert triangle winding and leave every face pointing
 * inward — visible as a hollow-looking preview and wrong normals in the STL.
 * Rewriting the points avoids the mirrored transform entirely.
 *
 * Flattening here also satisfies requirements §5.6, which calls for curves to
 * be reduced to line segments before triangulation.
 */
function flattenAndFlip(shape: THREE.Shape, divisions: number): THREE.Shape {
  const { shape: outline, holes } = shape.extractPoints(divisions);

  const flipped = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, -p.y)));
  for (const hole of holes) {
    flipped.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, -p.y))));
  }
  return flipped;
}

function boundsOf(layers: SvgLayer[]): THREE.Box2 {
  const box = new THREE.Box2();
  for (const layer of layers) {
    for (const shape of layer.shapes) {
      for (const point of shape.getPoints(1)) box.expandByPoint(point);
      for (const hole of shape.holes) {
        for (const point of hole.getPoints(1)) box.expandByPoint(point);
      }
    }
  }
  return box;
}

export class SvgParseError extends Error {}

function toHex(r: number, g: number, b: number): string {
  const channel = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Resolves a `fill` attribute to `#rrggbb`.
 *
 * three's Color.setStyle matches percentage rgb with `(\d+)%`, which accepts
 * only whole numbers. Real-world SVGs — anything exported through Cairo, which
 * covers most Inkscape and PDF-derived output — write
 * `rgb(75.72937%, 87.400818%, 96.116638%)`. Those silently fail to parse and
 * fall back to white, collapsing every layer into one.
 *
 * So percentage and numeric forms are handled here, and only hex and named
 * colors are delegated to three.
 */
export function resolveFill(raw: string | undefined, fallback: THREE.Color): string {
  const value = raw?.trim().toLowerCase();
  if (!value || value === 'none' || value === 'transparent') {
    return `#${fallback.getHexString()}`;
  }

  const percent = value.match(
    /^rgba?\(\s*([\d.]+)%[\s,]+([\d.]+)%[\s,]+([\d.]+)%/,
  );
  if (percent) {
    return toHex(
      (Number(percent[1]) / 100) * 255,
      (Number(percent[2]) / 100) * 255,
      (Number(percent[3]) / 100) * 255,
    );
  }

  const numeric = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (numeric) {
    return toHex(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));
  }

  // Hex and named colors: three parses these correctly.
  const parsed = new THREE.Color();
  try {
    parsed.setStyle(value);
    return `#${parsed.getHexString()}`;
  } catch {
    return `#${fallback.getHexString()}`;
  }
}

/**
 * Groups an SVG's filled regions by fill color, one layer per distinct color.
 *
 * Layer order is document order, so the first painted region becomes the
 * lowest layer — the v1 assumption recorded in requirements §11.
 */
export function parseSvgLayers(svgText: string, curveDivisions = 24): ParsedSvg {
  let paths;
  try {
    paths = new SVGLoader().parse(svgText).paths;
  } catch (cause) {
    // `new Error(msg, { cause })` needs the ES2022 lib; this project targets
    // ES2020, so surface the underlying failure through the console instead.
    console.error('SVGLoader could not parse the file', cause);
    throw new SvgParseError('That file could not be read as SVG.');
  }

  const byColor = new Map<string, THREE.Shape[]>();

  for (const path of paths) {
    const style = path.userData?.style;

    // Stroke-only or fully transparent geometry has nothing to extrude.
    if (style?.fill === 'none') continue;
    if (style?.fillOpacity !== undefined && Number(style.fillOpacity) === 0) continue;

    const shapes = SVGLoader.createShapes(path);
    if (shapes.length === 0) continue;

    // Read the raw attribute rather than trusting path.color, which is the
    // result of the parse that fails on decimal percentages.
    const color = resolveFill(style?.fill, path.color);
    const existing = byColor.get(color);
    /*
     * Repaired at parse time, not at mesh time, so every consumer sees simple
     * polygons: the on-screen preview, the crop, the offsetting flat mode does,
     * and the extrusion. Fixing it later would leave the previews disagreeing
     * with the mesh about what the artwork is.
     */
    const flattened = repairShapes(
      shapes.map((shape) => flattenAndFlip(shape, curveDivisions)),
    );

    if (existing) existing.push(...flattened);
    else byColor.set(color, flattened);
  }

  const layers: SvgLayer[] = [...byColor].map(([color, shapes]) => ({ color, shapes }));

  if (layers.length === 0) {
    throw new SvgParseError(
      'No filled shapes found. This SVG may be strokes or text only — convert strokes and text to filled paths and try again.',
    );
  }

  const bounds = boundsOf(layers);
  const size = bounds.getSize(new THREE.Vector2());
  if (size.x <= 0 || size.y <= 0) {
    throw new SvgParseError('The artwork in this SVG has no measurable size.');
  }

  return { layers, width: size.x, height: size.y, bounds };
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Perceptual-ish distance between two colors, 0–255.
 *
 * Weighted toward green because the eye is most sensitive there; this is the
 * cheap "redmean"-style approximation rather than a full Lab conversion, which
 * is more precision than deciding "are these the same filament?" needs.
 */
export function colorDistance(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const dr = x.r - y.r;
  const dg = x.g - y.g;
  const db = x.b - y.b;
  return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
}

/** Mean of several colors, used when merging layers into one. */
export function averageColor(colors: string[]): string {
  if (colors.length === 0) return '#000000';
  const sum = colors.reduce(
    (acc, hex) => {
      const { r, g, b } = hexToRgb(hex);
      return { r: acc.r + r, g: acc.g + g, b: acc.b + b };
    },
    { r: 0, g: 0, b: 0 },
  );
  return rgbToHex({
    r: sum.r / colors.length,
    g: sum.g / colors.length,
    b: sum.b / colors.length,
  });
}

export interface LayerGroup extends SvgLayer {
  /** Indices of the source layers folded into this group. */
  sourceIndices: number[];
}

/**
 * Folds layers together by their assigned color, preserving first-appearance
 * order so z-order stays stable as colors are reassigned.
 *
 * This is the merge rule from requirements §5.4: two layers set to the same
 * color become one mesh layer at one height. Merging in the UI is therefore
 * just "assign these layers a shared color" — there's no second mechanism.
 */
export function groupLayersByColor(layers: SvgLayer[], assigned: string[]): LayerGroup[] {
  const groups = new Map<string, LayerGroup>();

  layers.forEach((layer, index) => {
    const color = (assigned[index] ?? layer.color).toLowerCase();
    const existing = groups.get(color);
    if (existing) {
      existing.shapes.push(...layer.shapes);
      existing.sourceIndices.push(index);
    } else {
      groups.set(color, {
        color,
        shapes: [...layer.shapes],
        sourceIndices: [index],
      });
    }
  });

  return [...groups.values()];
}

/**
 * Print order as source-layer indices, lowest first.
 *
 * Order is kept as a permutation rather than by reordering the parsed layers
 * themselves, because every other piece of per-layer state — assigned colours,
 * deletions — is keyed by source index. Shuffling the layers would mean
 * remapping all of it in step, and any missed remap silently recolours or
 * deletes the wrong region.
 */
export function documentOrder(layerCount: number): number[] {
  return Array.from({ length: layerCount }, (_, i) => i);
}

/**
 * Print order after moving one merged group to another position in the stack.
 *
 * `stack` is the printed groups, each given as the source-layer indices behind
 * it — whole groups move, not individual layers, because a merged group prints
 * as one layer at one height and its members have to travel together.
 *
 * Deleted layers belong to no group, so they are passed in `trailing` and
 * parked at the end. They have no height while deleted, and restoring them is
 * Reset, which returns the whole stack to document order anyway.
 */
export function moveGroup(
  stack: number[][],
  from: number,
  to: number,
  trailing: number[] = [],
): number[] {
  const sequence = stack.map((group) => [...group]);

  if (from >= 0 && to >= 0 && from < sequence.length && to < sequence.length && from !== to) {
    const [moved] = sequence.splice(from, 1);
    sequence.splice(to, 0, moved);
  }

  return [...sequence.flat(), ...trailing];
}

/**
 * Print order restored from a saved project, matched by original colour.
 *
 * By colour rather than by position, for the same reason assignments are: the
 * SVG is re-parsed on open, and a parser change that reorders layers would
 * otherwise apply the saved stacking to the wrong ones. Colours a save does not
 * mention keep their document position at the top, which is where a layer the
 * artwork gained would have sat anyway.
 */
export function orderFromColors(layers: SvgLayer[], savedColors: string[]): number[] {
  const placed = new Set<number>();
  const order: number[] = [];

  for (const color of savedColors) {
    const index = layers.findIndex((layer, i) => !placed.has(i) && layer.color === color);
    if (index >= 0) {
      order.push(index);
      placed.add(index);
    }
  }

  for (let i = 0; i < layers.length; i++) if (!placed.has(i)) order.push(i);

  return order;
}

/**
 * Serializes a flattened shape to SVG path data, negating Y to return it to
 * SVG's Y-down convention for on-screen display.
 *
 * The shapes are already polylines, so one division per curve is exact.
 */
export function shapeToPathData(shape: THREE.Shape): string {
  const { shape: outline, holes } = shape.extractPoints(1);

  const ring = (points: THREE.Vector2[]) =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)} ${(-p.y).toFixed(3)}`)
      .join(' ') + ' Z';

  return [ring(outline), ...holes.map(ring)].join(' ');
}
