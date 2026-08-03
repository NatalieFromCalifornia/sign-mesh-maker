import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildMesh, layerAssignments, layerHeight, type MeshConfig } from './buildMesh';
import { parseSvgLayers } from './svgLayers';
import { HEX_SIGN_SVG } from '../test/fixtures';

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
    // Group is rotated so extrusion runs along +Y; nothing may dip below z=0.
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(2.8, 3);
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

  it('puts every layer at one height instead of stepping', () => {
    expect(layerHeight(0, FLAT)).toBeCloseTo(2.4, 6);
    expect(layerHeight(3, FLAT)).toBeCloseTo(2.4, 6);
    expect(layerHeight(9, FLAT)).toBeCloseTo(2.4, 6);
  });

  it('reports the same height for every layer in the sidebar', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const heights = layerAssignments(parsed, FLAT).map((l) => l.heightMm);
    expect(new Set(heights).size).toBe(1);
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

    // One extra mesh: the slab beneath the inset colours.
    expect(flat.group.children.length).toBe(stepped.group.children.length + 1);
  });

  it('still sits on the bed', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const { group } = buildMesh(parsed, FLAT);
    group.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeCloseTo(0, 3);
  });

  it('insets colours so they no longer touch', () => {
    const parsed = parseSvgLayers(HEX_SIGN_SVG);
    const wide: MeshConfig = { ...FLAT, flatGapMm: 4 };

    // A wide channel must remove noticeably more geometry than a hairline one.
    const hairline = buildMesh(parsed, { ...FLAT, flatGapMm: 0.02 }).triangles;
    expect(buildMesh(parsed, wide).triangles).toBeLessThanOrEqual(hairline);
  });
});
