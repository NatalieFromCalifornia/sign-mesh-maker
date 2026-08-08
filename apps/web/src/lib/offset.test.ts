import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  insetShapes,
  repairShapes,
  shapesArea,
  strokeToShapes,
  subtractShapes,
  unionShapes,
} from './offset';

function square(size: number, x = 0, y = 0): THREE.Shape {
  return new THREE.Shape([
    new THREE.Vector2(x, y),
    new THREE.Vector2(x + size, y),
    new THREE.Vector2(x + size, y + size),
    new THREE.Vector2(x, y + size),
  ]);
}

/** Signed area of a shape's outline, for comparing before and after. */
function area(shape: THREE.Shape): number {
  const points = shape.extractPoints(1).shape;
  let total = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    total += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return Math.abs(total / 2);
}

function boundsOf(shape: THREE.Shape) {
  const box = new THREE.Box2();
  for (const p of shape.extractPoints(1).shape) box.expandByPoint(p);
  return box;
}

describe('insetShapes', () => {
  it('shrinks a square by the requested amount on every side', () => {
    const [inset] = insetShapes([square(10)], 1);
    const box = boundsOf(inset);

    expect(box.min.x).toBeCloseTo(1, 2);
    expect(box.min.y).toBeCloseTo(1, 2);
    expect(box.max.x).toBeCloseTo(9, 2);
    expect(box.max.y).toBeCloseTo(9, 2);
  });

  it('reduces area without moving the centre', () => {
    const original = square(10);
    const [inset] = insetShapes([original], 0.5);

    expect(area(inset)).toBeLessThan(area(original));
    const box = boundsOf(inset);
    expect(box.getCenter(new THREE.Vector2()).x).toBeCloseTo(5, 2);
  });

  it('opens a channel of the full gap between two touching regions', () => {
    // Two squares sharing an edge at x=10. Insetting both by half the gap is
    // what makes the finished channel the whole gap (§5.5).
    const gap = 0.4;
    const [left] = insetShapes([square(10, 0, 0)], gap / 2);
    const [right] = insetShapes([square(10, 10, 0)], gap / 2);

    const between = boundsOf(right).min.x - boundsOf(left).max.x;
    expect(between).toBeCloseTo(gap, 3);
  });

  it('drops a region thinner than the inset instead of folding it inside out', () => {
    /*
     * A naive per-vertex offset turns this into a self-intersecting outline,
     * which triangulates into a broken solid. Vanishing is the correct
     * outcome: a feature narrower than the channel cannot be printed as one.
     */
    const sliver = new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(10, 0),
      new THREE.Vector2(10, 0.2),
      new THREE.Vector2(0, 0.2),
    ]);

    expect(insetShapes([sliver], 0.5)).toHaveLength(0);
  });

  it('grows holes as the solid shrinks', () => {
    // A hole's boundary is an edge of the solid, so the channel has to open on
    // that side too — the hole gets larger, not smaller.
    const ring = square(20);
    ring.holes.push(
      new THREE.Path([
        new THREE.Vector2(8, 8),
        new THREE.Vector2(12, 8),
        new THREE.Vector2(12, 12),
        new THREE.Vector2(8, 12),
      ]),
    );

    const [inset] = insetShapes([ring], 1);
    const hole = inset.holes[0];
    expect(hole).toBeDefined();

    const box = new THREE.Box2();
    for (const p of hole.getPoints(1)) box.expandByPoint(p);
    expect(box.min.x).toBeLessThan(8);
    expect(box.max.x).toBeGreaterThan(12);
  });

  it('returns the shapes untouched for a zero or negative inset', () => {
    const shapes = [square(10)];
    expect(insetShapes(shapes, 0)).toBe(shapes);
    expect(insetShapes(shapes, -1)).toBe(shapes);
  });

  it('handles several shapes at once', () => {
    const result = insetShapes([square(10), square(10, 20, 0)], 0.5);
    expect(result).toHaveLength(2);
  });
});

describe('unionShapes', () => {
  it('merges two overlapping squares into one outline', () => {
    // Stacked as separate solids these share a coplanar top face, which
    // z-fights into streaks and hands a slicer overlapping volumes.
    const merged = unionShapes([square(10), square(10, 5, 0)]);

    expect(merged).toHaveLength(1);
    const box = boundsOf(merged[0]);
    expect(box.min.x).toBeCloseTo(0, 3);
    expect(box.max.x).toBeCloseTo(15, 3);
  });

  it('keeps disjoint shapes separate', () => {
    expect(unionShapes([square(10), square(10, 40, 0)])).toHaveLength(2);
  });

  it('preserves a hole that no other shape fills', () => {
    const ring = square(20);
    ring.holes.push(
      new THREE.Path([
        new THREE.Vector2(8, 8),
        new THREE.Vector2(12, 8),
        new THREE.Vector2(12, 12),
        new THREE.Vector2(8, 12),
      ]),
    );

    const [merged] = unionShapes([ring, square(4, 30, 0)]);
    expect(merged.holes.length).toBeGreaterThan(0);
  });

  it('closes a hole that another shape covers', () => {
    // A background with a window, plus a patch filling it, is one solid slab.
    const ring = square(20);
    ring.holes.push(
      new THREE.Path([
        new THREE.Vector2(8, 8),
        new THREE.Vector2(12, 8),
        new THREE.Vector2(12, 12),
        new THREE.Vector2(8, 12),
      ]),
    );

    const merged = unionShapes([ring, square(4, 8, 8)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].holes).toHaveLength(0);
  });

  it('returns a single shape untouched', () => {
    const shapes = [square(10)];
    expect(unionShapes(shapes)).toBe(shapes);
  });
});

describe('subtractShapes', () => {
  it('cuts the clip region out of the subject', () => {
    // A background with a shape painted on it keeps only the uncovered part.
    const result = subtractShapes([square(20)], [square(20, 10, 0)]);

    expect(result).toHaveLength(1);
    const box = boundsOf(result[0]);
    expect(box.min.x).toBeCloseTo(0, 3);
    expect(box.max.x).toBeCloseTo(10, 3);
  });

  it('leaves a hole when the clip sits wholly inside', () => {
    const result = subtractShapes([square(20)], [square(4, 8, 8)]);
    expect(result).toHaveLength(1);
    expect(result[0].holes).toHaveLength(1);
  });

  it('returns nothing when the clip covers everything', () => {
    expect(subtractShapes([square(10, 2, 2)], [square(40)])).toHaveLength(0);
  });

  it('leaves the subject alone when they do not touch', () => {
    const result = subtractShapes([square(10)], [square(10, 50, 0)]);
    expect(result).toHaveLength(1);
    expect(boundsOf(result[0]).max.x).toBeCloseTo(10, 3);
  });

  it('short-circuits an empty clip', () => {
    const shapes = [square(10)];
    expect(subtractShapes(shapes, [])).toBe(shapes);
  });
});

/**
 * Area actually covered by the triangles three would extrude, versus the area
 * the outline encloses.
 *
 * Earcut is only defined on simple polygons. Given a self-crossing one it does
 * not throw — it emits overlapping triangles that bridge the crossings, so the
 * covered area exceeds the enclosed area. That ratio is the membrane, measured.
 */
function triangulatedRatio(shapes: THREE.Shape[]): number {
  let enclosed = 0;
  let covered = 0;

  for (const shape of shapes) {
    const { shape: outline, holes } = shape.extractPoints(1);
    enclosed += area(shape) - holes.reduce((total, hole) => {
      const ring = new THREE.Shape(hole);
      return total + area(ring);
    }, 0);

    const faces = THREE.ShapeUtils.triangulateShape(outline, holes as THREE.Vector2[][]);
    const points = [...outline, ...holes.flat()];
    for (const [a, b, c] of faces) {
      const p = points[a];
      const q = points[b];
      const r = points[c];
      covered += Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2;
    }
  }

  return covered / enclosed;
}

describe('repairShapes', () => {
  /*
   * A bowtie is the cleanest statement of the problem: its lobes wind opposite
   * ways, so the ring encloses a signed area of zero while plainly covering
   * two triangles. Earcut divides by that nothing and produces geometry with
   * no relation to the outline.
   */
  it('splits a bowtie into its two lobes', () => {
    const bowtie = new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(100, 60),
      new THREE.Vector2(100, 0),
      new THREE.Vector2(0, 60),
    ]);

    const repaired = repairShapes([bowtie]);

    expect(repaired).toHaveLength(2);
    // Each lobe is a triangle of base 100 and height 30.
    const total = repaired.reduce((sum, shape) => sum + area(shape), 0);
    expect(total).toBeCloseTo(3000, 1);
    expect(triangulatedRatio(repaired)).toBeCloseTo(1, 3);
  });

  it('counts a doubled-back outline once instead of twice', () => {
    const overlapping = new THREE.Shape(
      [
        [0, 0],
        [60, 0],
        [60, 40],
        [20, 40],
        [20, 10],
        [80, 10],
        [80, 50],
        [0, 50],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
    );

    expect(triangulatedRatio([overlapping])).toBeGreaterThan(1.01);

    const repaired = repairShapes([overlapping]);
    expect(triangulatedRatio(repaired)).toBeCloseTo(1, 3);
    // The sliver crossed twice is real area, but only once.
    expect(repaired.reduce((sum, shape) => sum + area(shape), 0)).toBeLessThan(5000);
  });

  it('leaves a clean shape and its hole alone', () => {
    const withHole = square(20);
    withHole.holes.push(
      new THREE.Path([
        new THREE.Vector2(5, 5),
        new THREE.Vector2(15, 5),
        new THREE.Vector2(15, 15),
        new THREE.Vector2(5, 15),
      ]),
    );

    const [repaired] = repairShapes([withHole]);

    expect(repaired.holes).toHaveLength(1);
    expect(area(repaired)).toBeCloseTo(400, 3);
    expect(boundsOf(repaired).max.x).toBeCloseTo(20, 3);
  });

  it('keeps a degenerate outline rather than dropping the layer', () => {
    const sliver = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1, 1)]);
    expect(repairShapes([sliver])).toHaveLength(1);
  });
});


describe('strokeToShapes', () => {
  const squareLine = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(100, 0),
    new THREE.Vector2(100, 100),
    new THREE.Vector2(0, 100),
  ];

  /*
   * A printed sign has no strokes, so a stroked border has to become the region
   * it paints or it is not printed at all — which is how a sign arrived with
   * its only border missing and nothing to say why.
   */
  it('turns a closed line into the ring the stroke covers', () => {
    const [ring] = strokeToShapes(squareLine, 10, true);

    // Straddles the line, so it reaches 5 outside and 5 inside.
    const box = boundsOf(ring);
    expect(box.min.x).toBeCloseTo(-5, 1);
    expect(box.max.x).toBeCloseTo(105, 1);

    // A ring, not a slab: the hole is what lets the artwork inside show.
    expect(ring.holes).toHaveLength(1);
    // Perimeter by width, plus the corners.
    expect(shapesArea([ring])).toBeGreaterThan(400 * 10 * 0.95);
    expect(shapesArea([ring])).toBeLessThan(400 * 10 * 1.15);
  });

  it('turns an open line into a band with two ends', () => {
    const [band] = strokeToShapes(
      [new THREE.Vector2(0, 0), new THREE.Vector2(100, 0)],
      10,
      false,
    );

    expect(band.holes).toHaveLength(0);
    expect(shapesArea([band])).toBeCloseTo(1000, -2);

    const box = boundsOf(band);
    expect(box.min.y).toBeCloseTo(-5, 1);
    expect(box.max.y).toBeCloseTo(5, 1);
  });

  it('has nothing to draw for a zero width or a single point', () => {
    expect(strokeToShapes(squareLine, 0, true)).toHaveLength(0);
    expect(strokeToShapes([new THREE.Vector2(0, 0)], 10, false)).toHaveLength(0);
  });
});
