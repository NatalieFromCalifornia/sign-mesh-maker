import * as THREE from 'three';
import type { ParsedSvg } from './svgLayers';

export interface MeshConfig {
  /** Finished width of the sign; height follows from the artwork's aspect. */
  widthMm: number;
  /** Thickness of the lowest layer — the sign's backing (requirements §5.3). */
  baseMm: number;
  /** Step added per layer above the lowest (requirements §5.3). */
  layerMm: number;
}

export interface LayerAssignment {
  color: string;
  /** Finished height from the bed, in mm. */
  heightMm: number;
}

/**
 * Height of layer `index` in a stepped stack: base + n × step, exactly as
 * requirements §5.4 defines it.
 *
 * Every region is solid from the bed up to its own height rather than sitting
 * on a separate slab. The union of all regions is the backing, so there's no
 * duplicated overlapping geometry to confuse a slicer — and the printed result
 * is identical.
 */
export function layerHeight(index: number, config: MeshConfig): number {
  return config.baseMm + index * config.layerMm;
}

export function layerAssignments(parsed: ParsedSvg, config: MeshConfig): LayerAssignment[] {
  return parsed.layers.map((layer, i) => ({
    color: layer.color,
    heightMm: layerHeight(i, config),
  }));
}

export interface BuiltMesh {
  group: THREE.Group;
  /** Finished size in mm, for display. */
  sizeMm: { width: number; height: number; depth: number };
  triangles: number;
}

/**
 * Extrudes each color layer and returns them as one group, one mesh per color
 * so the preview can color them and a future per-color STL export can split
 * them (requirements §5.7).
 */
export function buildMesh(parsed: ParsedSvg, config: MeshConfig): BuiltMesh {
  const scale = config.widthMm / parsed.width;
  const group = new THREE.Group();
  let triangles = 0;

  parsed.layers.forEach((layer, index) => {
    const depth = layerHeight(index, config);

    const geometry = new THREE.ExtrudeGeometry(layer.shapes, {
      depth,
      bevelEnabled: false,
    });

    // Artwork is scaled to millimetres; depth is already in millimetres.
    geometry.scale(scale, scale, 1);

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(layer.color),
      roughness: 0.62,
      metalness: 0.0,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = layer.color;
    group.add(mesh);

    triangles += geometry.getAttribute('position').count / 3;
  });

  // Center on the bed so orbiting feels anchored.
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  for (const child of group.children) {
    child.position.x -= center.x;
    child.position.y -= center.y;
  }

  // Extrusion runs along +Z; lay the sign flat so thickness points up.
  group.rotation.x = -Math.PI / 2;

  const size = box.getSize(new THREE.Vector3());
  return {
    group,
    sizeMm: { width: size.x, height: size.y, depth: size.z },
    triangles,
  };
}

export function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
  });
}
