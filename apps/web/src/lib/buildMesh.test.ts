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
