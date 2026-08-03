import * as THREE from 'three';
import type { ParsedSvg } from './svgLayers';
import type { CropRect } from '@sign-mesh-maker/shared';
import { insetShapes, intersectShapes, rectShape, subtractShapes, unionShapes } from './offset';

export interface MeshConfig {
  /** Finished width of the sign; height follows from the artwork's aspect. */
  widthMm: number;
  /** Thickness of the lowest layer — the sign's backing (requirements §5.3). */
  baseMm: number;
  /** Step added per layer above the lowest (requirements §5.3). */
  layerMm: number;
  /**
   * Flat mesh mode (requirements §5.5). Every colour sits at one height on a
   * solid backing, separated by milled channels instead of height steps.
   */
  flatMode?: boolean;
  /** Width of the channel between adjacent colours, in mm. */
  flatGapMm?: number;
  /** Crop window as fractions of the artwork (§5.3); absent means all of it. */
  crop?: CropRect;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

export function isFullCrop(crop: CropRect | undefined): boolean {
  if (!crop) return true;
  return (
    crop.x <= 0.0001 && crop.y <= 0.0001 && crop.width >= 0.9999 && crop.height >= 0.9999
  );
}

/**
 * Converts a normalized crop to the shapes' own coordinate space.
 *
 * Shapes are stored Y-up while the crop is expressed from the top-left of what
 * the user sees, so the vertical axis flips here — the top of the crop is the
 * *maximum* y of the artwork.
 */
export function cropBounds(parsed: ParsedSvg, crop: CropRect) {
  const { min, max } = parsed.bounds;
  return {
    minX: min.x + crop.x * parsed.width,
    maxX: min.x + (crop.x + crop.width) * parsed.width,
    minY: max.y - (crop.y + crop.height) * parsed.height,
    maxY: max.y - crop.y * parsed.height,
  };
}

/** Default channel width from requirements §5.5. */
export const DEFAULT_FLAT_GAP_MM = 0.08;

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
  // Flat mode puts every colour on one plane; §5.5 defines that as the base
  // plus a single step, whatever the layer's position in the stack.
  if (config.flatMode) return config.baseMm + config.layerMm;
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
export function buildMesh(source: ParsedSvg, config: MeshConfig): BuiltMesh {
  /*
   * Crop first, so everything after it — scale, extents, flat-mode unions —
   * describes the sign that will actually be printed rather than the artwork
   * it was cut from.
   */
  const parsed = cropParsed(source, config.crop);

  const scale = config.widthMm / parsed.width;
  const group = new THREE.Group();
  let triangles = 0;

  const addMesh = (shapes: THREE.Shape[], depth: number, color: string, zOffset = 0) => {
    if (shapes.length === 0) return;

    const geometry = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false });
    geometry.scale(scale, scale, 1);
    if (zOffset !== 0) geometry.translate(0, 0, zOffset);

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.62,
        metalness: 0.0,
      }),
    );
    mesh.name = color;
    group.add(mesh);
    triangles += geometry.getAttribute('position').count / 3;
  };

  /*
   * Flat mode needs a solid backing under everything (§5.5).
   *
   * Each colour is inset to open a channel to its neighbours, so without a slab
   * beneath, those channels would be gaps straight through to the print bed
   * rather than grooves in a sign. The slab carries the lowest layer's colour,
   * which is the background the artwork was drawn on.
   */
  if (config.flatMode && parsed.layers.length > 0) {
    addMesh(
      unionShapes(parsed.layers.flatMap((layer) => layer.shapes)),
      config.baseMm,
      parsed.layers[0].color,
    );
  }

  /*
   * The inset is half the gap, applied to both neighbours, so the finished
   * channel between two colours is the full gap. Shapes are in SVG units, so
   * the millimetre gap converts back through the same scale.
   */
  const insetUnits =
    config.flatMode && scale > 0 ? (config.flatGapMm ?? DEFAULT_FLAT_GAP_MM) / 2 / scale : 0;

  parsed.layers.forEach((layer, index) => {
    /*
     * In flat mode, cut away anything a later layer covers before insetting.
     *
     * Layers are painted in document order, so a background reaches under
     * everything drawn on it. At a single height that leaves two colours
     * sharing one top face — z-fighting on screen, and two materials claiming
     * one volume in the STL. Stepped mode does not need this: the heights
     * differ, so the upper layer simply sits above.
     */
    const exclusive =
      config.flatMode && index < parsed.layers.length - 1
        ? subtractShapes(
            layer.shapes,
            unionShapes(parsed.layers.slice(index + 1).flatMap((l) => l.shapes)),
          )
        : layer.shapes;

    const shapes = insetUnits > 0 ? insetShapes(exclusive, insetUnits) : exclusive;

    if (config.flatMode) {
      /*
       * Sit the colour on the slab rather than running it down to the bed.
       * Extruding from zero would put the tile and the slab in the same volume
       * for the base's whole thickness, and the coplanar faces z-fight into
       * visible streaks across the preview. It is also duplicate solid for a
       * slicer to reconcile.
       */
      addMesh(shapes, config.layerMm, layer.color, config.baseMm);
      return;
    }

    addMesh(shapes, layerHeight(index, config), layer.color);
  });

  // Center on the bed so orbiting feels anchored.
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  for (const child of group.children) {
    child.position.x -= center.x;
    child.position.y -= center.y;
  }

  /*
   * The group is left in printer space: X and Y span the artwork, +Z is
   * thickness, and the sign rests on z=0. That is what STL and 3MF consumers
   * expect, and rotating here baked the preview's orientation into every
   * export — the sign arrived in a slicer standing on its edge, because
   * three.js wants Y up and a print bed wants Z up. The viewer applies that
   * rotation itself, where it belongs.
   */
  const size = box.getSize(new THREE.Vector3());
  return {
    group,
    sizeMm: { width: size.x, height: size.y, depth: size.z },
    triangles,
  };
}

/** Restricts artwork to the crop window, leaving it untouched when there is none. */
export function cropParsed(parsed: ParsedSvg, crop: CropRect | undefined): ParsedSvg {
  if (isFullCrop(crop) || !crop) return parsed;

  const { minX, minY, maxX, maxY } = cropBounds(parsed, crop);
  const window = [rectShape(minX, minY, maxX, maxY)];

  const layers = parsed.layers.map((layer) => ({
    ...layer,
    shapes: intersectShapes(layer.shapes, window),
  }));

  return {
    ...parsed,
    layers,
    // Extents come from the crop, not the surviving geometry: a sign cropped
    // to a region with empty margins keeps those margins.
    width: maxX - minX,
    height: maxY - minY,
    bounds: new THREE.Box2(new THREE.Vector2(minX, minY), new THREE.Vector2(maxX, maxY)),
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
