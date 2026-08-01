import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

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
    const flattened = shapes.map((shape) => flattenAndFlip(shape, curveDivisions));

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
