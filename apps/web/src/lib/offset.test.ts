import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { insetShapes, subtractShapes, unionShapes } from './offset';

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
