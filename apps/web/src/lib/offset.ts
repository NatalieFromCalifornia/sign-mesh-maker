import * as THREE from 'three';
import {
  ClipType,
  Clipper,
  ClipperOffset,
  EndType,
  JoinType,
  JS,
  PolyFillType,
  PolyTree,
  PolyType,
  type IntPoint,
  type PolyNode,
} from 'clipper-lib';

/**
 * Clipper works in integers, so coordinates are scaled up before offsetting and
 * back down after. 1000 gives sub-micron precision at sign scale, well inside
 * what a printer can resolve.
 */
const SCALE = 1000;

/** Below this area a ring has collapsed to nothing and is dropped. */
const MIN_RING_AREA = 1e-7;

function toPath(points: THREE.Vector2[]): IntPoint[] {
  return points.map((p) => ({ X: p.x, Y: p.y }));
}

/**
 * Shrinks each shape inward by `amount`, in the shapes' own units.
 *
 * Requirements §5.5 asks for exactly this: insetting each colour region by half
 * the gap so a physical channel opens between neighbours, rather than relying
 * on height steps to separate colours.
 *
 * Clipper rather than a hand-rolled vertex offset because insetting is only
 * well-behaved while the offset stays smaller than the feature. A region
 * thinner than the gap should vanish, not fold through itself and emerge as a
 * self-intersecting outline that triangulates into a broken solid. Clipper
 * collapses those cleanly; the results are printed objects, so quietly wrong
 * geometry is the worst outcome available.
 */
export function insetShapes(shapes: THREE.Shape[], amount: number): THREE.Shape[] {
  if (amount <= 0) return shapes;

  const result: THREE.Shape[] = [];

  for (const shape of shapes) {
    const { shape: outline, holes } = shape.extractPoints(1);

    const outer = offsetRing(toPath(outline), -amount);
    if (outer.length === 0) continue;

    // Holes grow as the solid shrinks: the channel has to open on both sides
    // of an edge, and a hole's boundary is an edge of the solid.
    const grownHoles = holes.flatMap((hole) => offsetRing(toPath(hole), amount));

    for (const ring of outer) {
      const next = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.X, p.Y)));
      for (const hole of grownHoles) {
        next.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.X, p.Y))));
      }
      result.push(next);
    }
  }

  return result;
}

function offsetRing(path: IntPoint[], delta: number): IntPoint[][] {
  if (path.length < 3) return [];

  const scaled = [path.map((p) => ({ X: p.X, Y: p.Y }))];
  JS.ScaleUpPaths(scaled, SCALE);

  const offsetter = new ClipperOffset(2, 0.25);
  // jtMiter keeps corners sharp, which matters for the straight edges of
  // lettering; the miter limit stops spikes at very acute corners.
  offsetter.AddPaths(scaled, JoinType.jtMiter, EndType.etClosedPolygon);

  const solution: IntPoint[][] = [];
  offsetter.Execute(solution, delta * SCALE);
  JS.ScaleDownPaths(solution, SCALE);

  return solution.filter((ring) => ring.length >= 3 && Math.abs(areaOf(ring)) > MIN_RING_AREA);
}

/** Forces a ring counter-clockwise (positive area) or clockwise. */
function orient(ring: IntPoint[], counterClockwise: boolean): IntPoint[] {
  const positive = areaOf(ring) > 0;
  return positive === counterClockwise ? ring : [...ring].reverse();
}

function areaOf(ring: IntPoint[]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j].X + ring[i].X) * (ring[j].Y - ring[i].Y);
  }
  return area / 2;
}

/**
 * Unions overlapping shapes into non-overlapping outlines.
 *
 * The flat-mode backing slab is built from every colour's regions, and in real
 * artwork those overlap heavily — a background rectangle sits under everything
 * else. Extruding them as separate solids gives the slab several coplanar top
 * faces in the same place, which z-fight into streaks across the preview and
 * hand a slicer overlapping volumes to reconcile. One merged outline has
 * neither problem.
 */
export function unionShapes(shapes: THREE.Shape[]): THREE.Shape[] {
  if (shapes.length <= 1) return shapes;

  const clipper = new Clipper();

  for (const shape of shapes) {
    const { shape: outline, holes } = shape.extractPoints(1);
    /*
     * Winding has to be normalized before a nonZero union: outers wound one
     * way, holes the other. Three's shapes carry no such guarantee, and a hole
     * wound like its outer would simply fill in.
     *
     * evenOdd would sidestep the winding question but is the wrong rule here —
     * under it the overlap between two shapes cancels to a hole instead of
     * merging, which is the opposite of a union.
     */
    const paths = [orient(toPath(outline), true), ...holes.map((h) => orient(toPath(h), false))];
    JS.ScaleUpPaths(paths, SCALE);
    clipper.AddPaths(paths, PolyType.ptSubject, true);
  }

  const tree = new PolyTree();
  if (!clipper.Execute(ClipType.ctUnion, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero)) {
    return shapes;
  }

  const merged = shapesFromTree(tree);
  return merged.length > 0 ? merged : shapes;
}

/**
 * Removes `clip` from `subject`, returning what is left.
 *
 * Flat mode needs this because every colour reaches the same height, and
 * artwork is drawn in layers — a background sits underneath the shapes painted
 * on it. Left overlapping, two colours share one top face at the same z, which
 * z-fights in the preview and describes two different materials occupying one
 * volume in the STL. Cutting each layer back to the part no later layer covers
 * makes the tiles genuinely disjoint.
 */
export function subtractShapes(subject: THREE.Shape[], clip: THREE.Shape[]): THREE.Shape[] {
  if (subject.length === 0 || clip.length === 0) return subject;

  const clipper = new Clipper();
  addOriented(clipper, subject, PolyType.ptSubject);
  addOriented(clipper, clip, PolyType.ptClip);

  const tree = new PolyTree();
  if (
    !clipper.Execute(ClipType.ctDifference, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero)
  ) {
    return subject;
  }

  return shapesFromTree(tree);
}

function addOriented(clipper: Clipper, shapes: THREE.Shape[], polyType: PolyType): void {
  for (const shape of shapes) {
    const { shape: outline, holes } = shape.extractPoints(1);
    const paths = [orient(toPath(outline), true), ...holes.map((h) => orient(toPath(h), false))];
    JS.ScaleUpPaths(paths, SCALE);
    clipper.AddPaths(paths, polyType, true);
  }
}

/** Converts a Clipper PolyTree into shapes, attaching holes to their outlines. */
function shapesFromTree(tree: PolyTree): THREE.Shape[] {
  const result: THREE.Shape[] = [];

  const visit = (node: PolyNode) => {
    for (const child of node.Childs()) {
      if (child.IsHole()) {
        // Islands sitting inside a hole are outlines in their own right.
        visit(child);
        continue;
      }

      const outer = [child.Contour()];
      JS.ScaleDownPaths(outer, SCALE);
      if (outer[0].length >= 3) {
        const shape = new THREE.Shape(outer[0].map((p) => new THREE.Vector2(p.X, p.Y)));
        for (const hole of child.Childs()) {
          if (!hole.IsHole()) continue;
          const ring = [hole.Contour()];
          JS.ScaleDownPaths(ring, SCALE);
          if (ring[0].length >= 3) {
            shape.holes.push(new THREE.Path(ring[0].map((p) => new THREE.Vector2(p.X, p.Y))));
          }
        }
        result.push(shape);
      }
      visit(child);
    }
  };

  visit(tree);
  return result;
}

/** Keeps only the part of `subject` inside `clip`. */
export function intersectShapes(subject: THREE.Shape[], clip: THREE.Shape[]): THREE.Shape[] {
  if (subject.length === 0 || clip.length === 0) return [];

  const clipper = new Clipper();
  addOriented(clipper, subject, PolyType.ptSubject);
  addOriented(clipper, clip, PolyType.ptClip);

  const tree = new PolyTree();
  if (
    !clipper.Execute(
      ClipType.ctIntersection,
      tree,
      PolyFillType.pftNonZero,
      PolyFillType.pftNonZero,
    )
  ) {
    return subject;
  }

  return shapesFromTree(tree);
}

/** Axis-aligned rectangle as a shape, for clipping. */
export function rectShape(minX: number, minY: number, maxX: number, maxY: number): THREE.Shape {
  return new THREE.Shape([
    new THREE.Vector2(minX, minY),
    new THREE.Vector2(maxX, minY),
    new THREE.Vector2(maxX, maxY),
    new THREE.Vector2(minX, maxY),
  ]);
}
