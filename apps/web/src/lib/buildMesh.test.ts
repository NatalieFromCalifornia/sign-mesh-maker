import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FULL_CROP,
  buildMesh,
  cropParsed,
  isFullCrop,
  layerAssignments,
  layerHeight,
  revealBuriedLayers,
  type MeshConfig,
} from './buildMesh';
import { shapesArea } from './offset';
import { parseSvgLayers } from './svgLayers';
import { HEX_SIGN_SVG, TEXT_ON_PANEL_SVG } from '../test/fixtures';

const CONFIG: MeshConfig = { widthMm: 120, baseMm: 2, layerMm: 0.4 };

describe('layerHeight', () => {
  it('follows base + n × step from requirements §5.4', () => {
    expect(layerHeight(0, CONFIG)).toBeCloseTo(2.0, 6);
    expect(layerHeight(1, CONFIG)).toBeCloseTo(2.4, 6);
    expect(layerHeight(5, CONFIG)).toBeCloseTo(4.0, 6);
  });

  it('gives every layer a distinct height so colours are physically separable', () => {
    const heights = Array.from({ length: 10 }, (_, i) => layerHeight(i, CONFIG));
    expect(new Set(heights).size).toBe(10);
  });
});

describe('layerAssignments', () => {
  it('pairs each colour with its computed height, lowest first', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    expect(layerAssignments(parsed, CONFIG)).toEqual([
      { color: '#2f9d8f', heightMm: 2.0 },
      { color: '#f2681c', heightMm: 2.4 },
      { color: '#ffffff', heightMm: 2.8 },
    ]);
  });
});

describe('buildMesh', () => {
  it('produces one mesh per colour layer', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const { group } = buildMesh(parsed, CONFIG);
    expect(group.children).toHaveLength(3);
    expect(group.children.map((c) => c.name)).toEqual(['#2f9d8f', '#f2681c', '#ffffff']);
  });

  it('scales artwork to the requested width and preserves aspect', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const { sizeMm } = buildMesh(parsed, CONFIG);

    expect(sizeMm.width).toBeCloseTo(120, 3);
    // Fixture is 200×100, so height must land at half the width.
    expect(sizeMm.height).toBeCloseTo(60, 3);
  });

  it('makes the tallest layer as thick as the last assigned height', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const { sizeMm } = buildMesh(parsed, CONFIG);
    expect(sizeMm.depth).toBeCloseTo(layerHeight(parsed.layers.length - 1, CONFIG), 5);
  });

  it('sits the sign on the bed with thickness pointing up', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const { group } = buildMesh(parsed, CONFIG);
    group.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(group);
    // Printer space: +Z is thickness and the sign rests on the bed at z=0.
    expect(box.min.z).toBeCloseTo(0, 3);
    expect(box.max.z).toBeCloseTo(2.8, 3);
  });

  it('produces geometry with no NaN positions', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const { group } = buildMesh(parsed, CONFIG);

    for (const child of group.children) {
      const positions = (child as THREE.Mesh).geometry.getAttribute('position');
      for (let i = 0; i < positions.count * 3; i++) {
        expect(Number.isFinite(positions.array[i])).toBe(true);
      }
    }
  });
});

describe('flat mode (§5.5)', () => {
  const FLAT: MeshConfig = { ...CONFIG, flatMode: true, flatGapMm: 0.4 };

  /*
   * Two heights, not one and not a staircase: the lowest layer is the base the
   * sign is printed on, and every colour above it reaches the same single step.
   * Treating the base as one more colour at that step stacked the background on
   * top of itself.
   */
  it('puts the base at the bottom and every colour above it at one height', () => {
    expect(layerHeight(0, FLAT)).toBeCloseTo(2, 6);
    expect(layerHeight(1, FLAT)).toBeCloseTo(2.4, 6);
    expect(layerHeight(3, FLAT)).toBeCloseTo(2.4, 6);
    expect(layerHeight(9, FLAT)).toBeCloseTo(2.4, 6);
  });

  it('reports exactly two heights in the sidebar', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const heights = layerAssignments(parsed, FLAT).map((l) => l.heightMm);

    expect(heights[0]).toBeCloseTo(FLAT.baseMm, 6);
    expect(new Set(heights.slice(1)).size).toBe(1);
    expect(new Set(heights).size).toBe(2);
  });

  it('does not give the base a tile standing on itself', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const { group } = buildMesh(parsed, FLAT);

    // The slab carries the lowest layer's colour; a second mesh in that colour
    // would be the background printed on top of the background.
    const background = parsed.layers[0].color;
    const inThatColor = group.children.filter((child) => child.name === background);
    expect(inThatColor).toHaveLength(1);
  });

  it('is no taller than one step above the base', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const stepped = buildMesh(parsed, CONFIG).sizeMm.depth;
    const flat = buildMesh(parsed, FLAT).sizeMm.depth;

    expect(flat).toBeCloseTo(CONFIG.baseMm + CONFIG.layerMm, 5);
    expect(flat).toBeLessThan(stepped);
  });

  it('adds a backing slab so channels are grooves, not holes to the bed', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const stepped = buildMesh(parsed, CONFIG);
    const flat = buildMesh(parsed, FLAT);

    /*
     * Same count, not one more: flat mode gains the slab but loses the lowest
     * layer's tile, because the slab is that layer.
     */
    expect(flat.group.children.length).toBe(stepped.group.children.length);

    // And the slab really is underneath — it starts at the bed.
    const box = new THREE.Box3().setFromObject(flat.group);
    expect(box.min.z).toBeCloseTo(0, 5);
  });

  it('still sits on the bed', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const { group } = buildMesh(parsed, FLAT);
    group.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.z).toBeCloseTo(0, 3);
  });

  it('insets colours so they no longer touch', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const wide: MeshConfig = { ...FLAT, flatGapMm: 4 };

    // A wide channel must remove noticeably more geometry than a hairline one.
    const hairline = buildMesh(parsed, { ...FLAT, flatGapMm: 0.02 }).triangles;
    expect(buildMesh(parsed, wide).triangles).toBeLessThanOrEqual(hairline);
  });
});

describe('crop (§5.3)', () => {
  const HALF: MeshConfig = {
    ...CONFIG,
    crop: { x: 0, y: 0, width: 0.5, height: 1 },
  };

  it('treats an absent or whole-artwork crop as no crop', () => {
    expect(isFullCrop(undefined)).toBe(true);
    expect(isFullCrop(FULL_CROP)).toBe(true);
    expect(isFullCrop({ x: 0, y: 0, width: 0.5, height: 1 })).toBe(false);
  });

  it('leaves artwork untouched when the crop covers everything', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    expect(cropParsed(parsed, FULL_CROP)).toBe(parsed);
  });

  it('reduces the artwork extents to the crop window', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const cropped = cropParsed(parsed, HALF.crop);

    // Fixture is 200×100; the left half is 100×100.
    expect(cropped.width).toBeCloseTo(100, 3);
    expect(cropped.height).toBeCloseTo(100, 3);
  });

  it('measures the crop from the top-left of what the user sees', () => {
    // Shapes are stored Y-up while the crop is top-down, so the vertical axis
    // flips. Cropping the top half must keep the artwork's larger y values.
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const topHalf = cropParsed(parsed, { x: 0, y: 0, width: 1, height: 0.5 });

    expect(topHalf.bounds.max.y).toBeCloseTo(parsed.bounds.max.y, 3);
    expect(topHalf.bounds.min.y).toBeCloseTo(parsed.bounds.max.y - parsed.height / 2, 3);
  });

  it('drops layers that fall entirely outside the window', () => {
    // The fixture's white square sits in the right half only.
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const left = cropParsed(parsed, HALF.crop);

    const white = left.layers.find((l) => l.color === '#ffffff');
    expect(white?.shapes ?? []).toHaveLength(0);
  });

  it('builds a mesh scaled to the cropped region, not the original', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const { sizeMm } = buildMesh(parsed, HALF);

    // 100×100 artwork at 120mm wide is 120mm tall, where uncropped it was 60.
    expect(sizeMm.width).toBeCloseTo(120, 2);
    expect(sizeMm.height).toBeCloseTo(120, 2);
  });

  it('keeps the sign on the bed after cropping', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const { group } = buildMesh(parsed, HALF);
    group.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(group).min.z).toBeCloseTo(0, 3);
  });
});

describe('revealBuriedLayers', () => {
  const rect = (x: number, y: number, w: number, h: number) =>
    new THREE.Shape([
      new THREE.Vector2(x, y),
      new THREE.Vector2(x + w, y),
      new THREE.Vector2(x + w, y + h),
      new THREE.Vector2(x, y + h),
    ]);

  const layer = (color: string, ...shapes: THREE.Shape[]) => ({ color, shapes });

  const area = (shapes: THREE.Shape[]) => shapesArea(shapes);

  /*
   * The case that prompted this: a caption ordered below the panel it sits on.
   * Nothing of it shows, so the panel is cut to let it through and it reads as
   * engraved rather than being printed sealed inside the sign.
   */
  it('cuts a wholly covered layer out of the layer burying it', () => {
    const caption = layer('#ffffff', rect(20, 20, 20, 10));
    const panel = layer('#ad130f', rect(0, 0, 100, 50));

    const [revealed, cut] = revealBuriedLayers([caption, panel]);

    // The caption itself is untouched — it is what shows through the hole.
    expect(area(revealed.shapes)).toBeCloseTo(200, 3);
    // The panel loses exactly the caption's footprint.
    expect(area(cut.shapes)).toBeCloseTo(5000 - 200, 3);
    expect(cut.shapes[0].holes).toHaveLength(1);
  });

  /*
   * The limit that makes the rule safe. A background is underneath everything
   * and overlaps all of it, so cutting on any overlap at all would subtract it
   * from every layer above and leave nothing standing.
   */
  it('leaves a background alone, because its margins still show', () => {
    const background = layer('#efebe4', rect(0, 0, 100, 50));
    const text = layer('#010101', rect(20, 20, 20, 10));

    const [bg, above] = revealBuriedLayers([background, text]);

    expect(area(bg.shapes)).toBeCloseTo(5000, 3);
    expect(area(above.shapes)).toBeCloseTo(200, 3);
    expect(above.shapes[0].holes).toHaveLength(0);
  });

  it('leaves a partly covered layer alone', () => {
    // Half on the panel, half hanging off it.
    const straddling = layer('#ffffff', rect(80, 10, 40, 10));
    const panel = layer('#ad130f', rect(0, 0, 100, 50));

    const [, after] = revealBuriedLayers([straddling, panel]);
    expect(area(after.shapes)).toBeCloseTo(5000, 3);
  });

  it('only cuts the layers that actually overlap', () => {
    const buried = layer('#ffffff', rect(20, 20, 20, 10));
    const panel = layer('#ad130f', rect(0, 0, 100, 50));
    const elsewhere = layer('#2f9d8f', rect(200, 0, 10, 10));

    const [, cutPanel, untouched] = revealBuriedLayers([buried, panel, elsewhere]);

    expect(area(cutPanel.shapes)).toBeCloseTo(4800, 3);
    expect(untouched.shapes[0]).toBe(elsewhere.shapes[0]);
  });

  /*
   * The per-layer version of this rule missed the case that reported it. A
   * caption merged into the background makes one layer whose area is
   * overwhelmingly background — plainly not covered — so nothing was punched
   * and the caption simply disappeared. Each region has to answer for itself.
   */
  it('punches a buried shape out even when its layer is mostly visible', () => {
    // One layer holding a full-bleed background and a caption, the way a merge
    // with the background produces.
    const merged = layer('#efebe4', rect(0, 0, 200, 100), rect(40, 20, 20, 10));
    const panel = layer('#ad130f', rect(30, 10, 60, 30));

    const [base, cut] = revealBuriedLayers([merged, panel]);

    // The panel loses the caption's footprint, and only that.
    expect(area(cut.shapes)).toBeCloseTo(1800 - 200, 3);
    expect(cut.shapes[0].holes).toHaveLength(1);
    // The background itself is untouched: it still shows all around the panel.
    expect(area(base.shapes)).toBeCloseTo(20000 + 200, 3);
  });

  it('passes a single layer straight through', () => {
    const only = [layer('#ffffff', rect(0, 0, 10, 10))];
    expect(revealBuriedLayers(only)).toBe(only);
  });

  it('reaches the buried layer through every layer stacked over it', () => {
    const buried = layer('#ffffff', rect(20, 20, 20, 10));
    const first = layer('#ad130f', rect(0, 0, 100, 50));
    const second = layer('#010101', rect(10, 10, 60, 30));

    const [, a, b] = revealBuriedLayers([buried, first, second]);

    expect(a.shapes[0].holes).toHaveLength(1);
    expect(b.shapes[0].holes).toHaveLength(1);
  });

  it('opens the hole all the way down in the built mesh', () => {
    const parsed = {
      layers: [layer('#ffffff', rect(20, 20, 20, 10)), layer('#ad130f', rect(0, 0, 100, 50))],
      width: 100,
      height: 50,
      bounds: new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(100, 50)),
    };

    const { group } = buildMesh(parsed, CONFIG);
    const panel = group.children.find((child) => child.name === '#ad130f') as THREE.Mesh;

    // The buried colour is shorter, so the hole has to run the panel's full
    // height for it to be visible from above.
    const box = new THREE.Box3().setFromObject(panel);
    expect(box.max.z).toBeCloseTo(layerHeight(1, CONFIG), 5);
  });
});


/*
 * Layers each run solid from the bed to their own height, so two that overlap
 * occupy one volume twice. Where they also share an outline — a background and
 * the border drawn around its edge — that puts two outward-facing walls in the
 * same plane, which z-fights along the whole edge of the sign.
 */
describe('overlapping volume', () => {
  const rect = (x: number, y: number, w: number, h: number) =>
    new THREE.Shape([
      new THREE.Vector2(x, y),
      new THREE.Vector2(x + w, y),
      new THREE.Vector2(x + w, y + h),
      new THREE.Vector2(x, y + h),
    ]);

  /** A background and a border ring sharing one outer boundary, as most signs have. */
  const framedSign = () => {
    const border = rect(0, 0, 100, 60);
    border.holes.push(
      new THREE.Path([
        new THREE.Vector2(4, 4),
        new THREE.Vector2(96, 4),
        new THREE.Vector2(96, 56),
        new THREE.Vector2(4, 56),
      ]),
    );

    return {
      layers: [
        { color: '#efebe4', shapes: [rect(0, 0, 100, 60)] },
        { color: '#000000', shapes: [border] },
      ],
      width: 100,
      height: 60,
      bounds: new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(100, 60)),
    };
  };

  const footprints = (group: THREE.Group) =>
    group.children.map((child) => {
      const box = new THREE.Box3().setFromObject(child);
      return { name: child.name, box };
    });

  it('does not extrude the background out to the border it shares an edge with', () => {
    const { group } = buildMesh(framedSign(), CONFIG);
    const background = footprints(group).find((f) => f.name === '#efebe4')!;
    const border = footprints(group).find((f) => f.name === '#000000')!;

    // The border still reaches the sign's outer edge.
    expect(border.box.max.x - border.box.min.x).toBeCloseTo(CONFIG.widthMm, 1);
    // The background has been cut back inside it, so the two outward-facing
    // walls are no longer in the same plane.
    expect(background.box.max.x - background.box.min.x).toBeLessThan(
      border.box.max.x - border.box.min.x,
    );
  });

  it('prints the same object: the union and the overall size are unchanged', () => {
    const { group, sizeMm } = buildMesh(framedSign(), CONFIG);

    // The taller layer already filled the overlap from the bed upward, so
    // removing the duplicate leaves the printed solid identical.
    expect(sizeMm.width).toBeCloseTo(CONFIG.widthMm, 3);
    expect(sizeMm.depth).toBeCloseTo(layerHeight(1, CONFIG), 5);

    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.z).toBeCloseTo(0, 5);
  });
});


/**
 * Every part is exported as its own mesh, so every part has to be closed.
 *
 * A plain STL escapes this — all the colours land in one solid a slicer will
 * heal — but a 3MF hands each colour over separately, and an unclosed one
 * slices into missing letters and floating-region warnings.
 */
describe('watertight parts', () => {
  /** Boundary edges: an edge used by one triangle is a hole in the surface. */
  function openEdges(geometry: THREE.BufferGeometry): number {
    const p = geometry.getAttribute('position').array as ArrayLike<number>;
    const counts = new Map<string, number>();

    for (let t = 0; t < p.length / 9; t++) {
      const i = t * 9;
      // Exact identity, not a rounded bucket: shared vertices are written from
      // the same coordinate, and rounding invents mismatches at bucket edges.
      const k = [0, 1, 2].map((n) => `${p[i + n * 3]},${p[i + n * 3 + 1]},${p[i + n * 3 + 2]}`);
      for (let e = 0; e < 3; e++) {
        const a = k[e];
        const b = k[(e + 1) % 3];
        if (a === b) continue;
        const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        counts.set(edge, (counts.get(edge) ?? 0) + 1);
      }
    }

    let open = 0;
    for (const [, n] of counts) if (n === 1) open++;
    return open;
  }

  const partsOf = (group: THREE.Group) =>
    group.children.map((child) => ({
      name: child.name,
      open: openEdges((child as THREE.Mesh).geometry),
    }));

  /*
   * Text on a panel is the case that broke it. Cutting the glyphs out of the
   * background leaves holes whose baselines are exactly collinear, and earcut
   * bridges those wrongly: the cap spans across several holes instead of
   * following their edges, so the cap and the walls disagree about where the
   * boundary is.
   */
  it('closes a background cut by glyphs sharing a baseline', () => {
    const parsed = parseSvgLayers(TEXT_ON_PANEL_SVG);

    for (const flatMode of [false, true]) {
      const { group } = buildMesh(parsed, { ...CONFIG, flatMode });
      for (const part of partsOf(group)) {
        expect(`${part.name} open=${part.open}`).toBe(`${part.name} open=0`);
      }
    }
  });

  it('closes every part of an ordinary sign', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);

    for (const flatMode of [false, true]) {
      const { group } = buildMesh(parsed, { ...CONFIG, flatMode });
      for (const part of partsOf(group)) {
        expect(`${part.name} open=${part.open}`).toBe(`${part.name} open=0`);
      }
    }
  });

  /*
   * Merging folds several layers into one, and nothing cuts the topmost layer
   * against anything, so its shapes can arrive overlapping. This is the shape
   * of the report: a flat sign merged down to three colours came back
   * non-manifold.
   */
  it('closes a merged top layer whose own shapes overlap', () => {
    const overlapping = {
      layers: [
        { color: '#2f9d8f', shapes: [rectShape2(0, 0, 100, 50)] },
        {
          color: '#ffffff',
          shapes: [rectShape2(10, 10, 40, 30), rectShape2(30, 20, 40, 20)],
        },
      ],
      width: 100,
      height: 50,
      bounds: new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(100, 50)),
    };

    for (const flatMode of [false, true]) {
      const { group } = buildMesh(overlapping, { ...CONFIG, flatMode, flatGapMm: 0.4 });
      for (const part of partsOf(group)) {
        expect(`${part.name} open=${part.open}`).toBe(`${part.name} open=0`);
      }
    }
  });

  it('leaves a region too small to print out of the mesh entirely', () => {
    const speck = {
      layers: [
        { color: '#2f9d8f', shapes: [rectShape2(0, 0, 100, 50)] },
        // 0.02 x 0.02 mm once scaled: a twentieth of a nozzle across.
        { color: '#ffffff', shapes: [rectShape2(10, 10, 0.02, 0.02)] },
      ],
      width: 100,
      height: 50,
      bounds: new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(100, 50)),
    };

    const { group } = buildMesh(speck, CONFIG);
    expect(group.children.map((c) => c.name)).toEqual(['#2f9d8f']);
  });
});

function rectShape2(x: number, y: number, w: number, h: number) {
  return new THREE.Shape([
    new THREE.Vector2(x, y),
    new THREE.Vector2(x + w, y),
    new THREE.Vector2(x + w, y + h),
    new THREE.Vector2(x, y + h),
  ]);
}
