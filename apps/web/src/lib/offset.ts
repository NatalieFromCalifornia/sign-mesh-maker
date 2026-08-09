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

/**
 * Turns a stroked line into the filled region the stroke paints.
 *
 * A printed sign has no strokes — every colour is a solid region of a certain
 * thickness — so a stroke has to become a fill before it can be extruded, and
 * a stroke is geometrically just the line offset by half its width to either
 * side. Clipper offsets an open or closed line directly, which is the same
 * machinery flat mode's channels already use.
 *
 * Without this a stroked outline is not printed and nothing says so: the file
 * looks complete, every fill in it comes through, and only the border is
 * quietly missing from the mesh.
 */
export function strokeToShapes(
  points: THREE.Vector2[],
  width: number,
  closed: boolean,
): THREE.Shape[] {
  if (points.length < 2 || width <= 0) return [];

  const scaled = [toPath(points)];
  JS.ScaleUpPaths(scaled, SCALE);

  const offsetter = new ClipperOffset(2, 0.25);
  /*
   * etClosedLine walks both sides of a closed line and yields the ring the
   * stroke covers — an outer boundary and the inner one that becomes its hole.
   * etOpenButt does the same for a line with two ends. Rounding the joins
   * rather than mitring them: a stroke's corners are drawn by stroke-linejoin,
   * which is round or bevelled far more often than it is a spike.
   */
  offsetter.AddPaths(
    scaled,
    JoinType.jtRound,
    closed ? EndType.etClosedLine : EndType.etOpenButt,
  );

  const solution: IntPoint[][] = [];
  offsetter.Execute(solution, (width / 2) * SCALE);
  if (solution.length === 0) return [];

  /*
   * Back through a union to nest the rings. The offset hands back the outer
   * and inner boundaries as separate paths; without resolving which contains
   * which, the hole down the middle of the stroke is extruded as solid and the
   * border comes out as a filled slab.
   */
  const clipper = new Clipper();
  clipper.AddPaths(solution, PolyType.ptSubject, true);

  const tree = new PolyTree();
  if (!clipper.Execute(ClipType.ctUnion, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero)) {
    return [];
  }

  return shapesFromTree(tree);
}

/**
 * Removes the near-duplicate and near-collinear vertices a boolean operation
 * leaves behind.
 *
 * Every cut along a shared edge deposits points a fraction of an integer
 * apart. They describe no shape, but earcut — which triangulates the caps of
 * every extrusion — is only reliable on a polygon without them, and when it
 * gives up it returns a partial triangulation. The walls are built from the
 * outline directly and so are always complete, which leaves the cap not
 * meeting them: a solid with a hole in it.
 *
 * That does not show in a plain STL, where every colour lands in one solid a
 * slicer can heal, but a 3MF hands each colour over as its own mesh and an
 * unclosed one slices into missing letters and floating-region warnings.
 */
function clean(ring: IntPoint[]): IntPoint[] {
  return Clipper.CleanPolygon(ring, CLEAN_DISTANCE);
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
 * Resolves self-intersections in each shape, returning clean rings.
 *
 * Earcut — which three uses for every extrusion cap — is only defined on simple
 * polygons. Hand it an outline that crosses itself and it does not fail; it
 * emits overlapping triangles that bridge the crossings, which shows up as a
 * thin membrane webbed across a glyph's concave notches. Wide letters are the
 * usual victims because their diagonals are where a font's strokes overlap.
 *
 * Self-crossing outlines are not malformed art. A renderer fills them by the
 * fill rule and they look correct in every browser and design tool, so the file
 * gives no hint that anything is wrong until the mesh is built. Real exports
 * carry them routinely: text converted to paths overlaps its own strokes at the
 * joins.
 *
 * Clipper's nonZero union rewrites such a ring as the region the fill rule says
 * it covers, which is both what the artwork looked like and something earcut
 * can triangulate. Only the doubly-covered slivers are lost — a fraction of a
 * percent of the area, and area that was never really there twice.
 */
export function repairShapes(shapes: THREE.Shape[]): THREE.Shape[] {
  const result: THREE.Shape[] = [];

  for (const shape of shapes) {
    const { shape: outline, holes } = shape.extractPoints(1);
    if (outline.length < 3) {
      result.push(shape);
      continue;
    }

    /*
     * Absolute winding, not winding relative to the outline: a self-crossing
     * ring's signed area is the difference of its lobes and can be near zero,
     * so it cannot be trusted to orient anything else. Forcing outers positive
     * and holes negative keeps the nonZero rule meaningful either way.
     */
    const paths = [orient(toPath(outline), true), ...holes.map((h) => orient(toPath(h), false))];
    JS.ScaleUpPaths(paths, SCALE);

    const clipper = new Clipper();
    clipper.AddPaths(paths, PolyType.ptSubject, true);

    const tree = new PolyTree();
    if (
      !clipper.Execute(ClipType.ctUnion, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero)
    ) {
      result.push(shape);
      continue;
    }

    // A shape that resolves to nothing is likelier to be a Clipper edge case
    // than genuinely empty artwork, so the original survives.
    const fixed = shapesFromTree(tree);
    result.push(...(fixed.length > 0 ? fixed : [shape]));
  }

  return result;
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

/**
 * How close a vertex may sit to the edge through its neighbours before it is
 * dropped, in scaled clipper units.
 *
 * 1.415 is Clipper's own default — just over one integer diagonal, so it only
 * removes points that carry no shape at the resolution the arithmetic runs at.
 * At SCALE that is a bit over a thousandth of an SVG unit, which is nanometres
 * on a printed sign.
 */
const CLEAN_DISTANCE = 1.415;

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

      const outer = [clean(child.Contour())];
      JS.ScaleDownPaths(outer, SCALE);
      if (outer[0].length >= 3) {
        const shape = new THREE.Shape(outer[0].map((p) => new THREE.Vector2(p.X, p.Y)));
        for (const hole of child.Childs()) {
          if (!hole.IsHole()) continue;
          const ring = [clean(hole.Contour())];
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

/**
 * Total area a set of shapes covers, holes discounted.
 *
 * Used to ask whether anything of a layer survives being covered. Shapes are
 * assumed already disjoint, which is what the clipping functions here return.
 */
export function shapesArea(shapes: THREE.Shape[]): number {
  let total = 0;

  for (const shape of shapes) {
    const { shape: outline, holes } = shape.extractPoints(1);
    total +=
      Math.abs(areaOf(toPath(outline))) -
      holes.reduce((sum, hole) => sum + Math.abs(areaOf(toPath(hole))), 0);
  }

  return total;
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
