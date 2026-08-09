import * as THREE from 'three';
import type { ParsedSvg, SvgLayer } from './svgLayers';
import type { CropRect } from '@sign-mesh-maker/shared';
import {
  insetShapes,
  intersectShapes,
  normalizeShapes,
  rectShape,
  shapesArea,
  subtractShapes,
  unionShapes,
} from './offset';

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
 * on a separate slab, and each is then cut back to the part no taller layer
 * covers. The union of all regions is the backing, and nothing is duplicated
 * for a slicer to reconcile — the printed result is identical either way.
 */
export function layerHeight(index: number, config: MeshConfig): number {
  /*
   * Flat mode has exactly two heights: the lowest layer is the base the sign
   * is printed on, and every colour above it reaches one step higher. §5.5
   * describes that single step; treating the base as one more colour at that
   * step made the background a layer standing on itself.
   */
  if (config.flatMode) return index === 0 ? config.baseMm : config.baseMm + config.layerMm;
  return config.baseMm + index * config.layerMm;
}

/**
 * A layer counts as buried once this little of it is left showing, as a
 * fraction of its own area.
 *
 * Not zero: clipping a region out of the thing covering it leaves slivers a
 * few nanometres wide along shared edges, and artwork routinely has a colour
 * poking a rounding error past the shape drawn over it. Neither is something
 * anyone can see, let alone print.
 */
const BURIED_FRACTION = 0.005;

function boxOf(shapes: THREE.Shape[]): THREE.Box2 {
  const box = new THREE.Box2();
  for (const shape of shapes) {
    for (const point of shape.extractPoints(1).shape) box.expandByPoint(point);
  }
  return box;
}

/**
 * Cuts regions that nothing would show of out of whatever is burying them.
 *
 * Layer order is print height: the last layer is the tallest, so where two
 * overlap the higher one is what you see. Reordering or merging can therefore
 * hide a region completely — put a caption under the panel it sits on and the
 * panel swallows it, with the caption still printed, in colour, sealed inside
 * the sign where nobody will ever see it.
 *
 * Subtracting the buried region from everything above it opens a hole down to
 * that region's own height, so it reads as engraved into whatever was covering
 * it. That is the shape the artwork asked for, at the stacking the user asked
 * for.
 *
 * Judged per shape rather than per layer, which matters as soon as anything is
 * merged. Merging a caption into the background makes one layer whose area is
 * overwhelmingly background; the layer is plainly not covered, so a per-layer
 * test says nothing is wrong while the caption inside it disappears. Each
 * region has to answer for itself.
 *
 * Only regions that are *entirely* covered qualify, and that limit is the whole
 * reason this is safe. A background is underneath everything by definition and
 * overlaps all of it; cutting on any overlap would subtract it from every layer
 * above and erase the sign. A background still shows in its margins, so it is
 * never buried, and is never cut.
 */
export function revealBuriedLayers(layers: SvgLayer[]): SvgLayer[] {
  if (layers.length < 2) return layers;

  const result = layers.map((layer) => ({ ...layer, shapes: layer.shapes }));

  for (let i = 0; i < result.length - 1; i++) {
    const above = result.slice(i + 1).flatMap((layer) => layer.shapes);
    if (above.length === 0) continue;

    const cover = unionShapes(above);
    const coverBoxes = cover.map((shape) => boxOf([shape]));

    const buried = result[i].shapes.filter((shape) => {
      const own = shapesArea([shape]);
      if (own <= 0) return false;

      /*
       * Clip against only the parts of the cover this shape could possibly
       * touch. A ring whose box misses the shape cannot remove any of it, so
       * dropping it changes no answer — but it takes a glyph from being
       * clipped against every other region on the sign to being clipped
       * against the one panel it sits on, which is most of the cost of
       * generating a detailed sign.
       */
      const box = boxOf([shape]);
      const relevant = cover.filter((_, r) => coverBoxes[r].intersectsBox(box));
      if (relevant.length === 0) return false;

      return shapesArea(subtractShapes([shape], relevant)) <= own * BURIED_FRACTION;
    });

    if (buried.length === 0) continue;

    /*
     * Cut from the layers that actually overlap them. Passing an untouched
     * layer through the clipper would re-tessellate geometry for no reason.
     */
    const buriedBox = boxOf(buried);
    for (let j = i + 1; j < result.length; j++) {
      if (!boxOf(result[j].shapes).intersectsBox(buriedBox)) continue;
      result[j] = {
        ...result[j],
        shapes: subtractShapes(result[j].shapes, buried),
      };
    }
  }

  return result;
}

/**
 * Nudges every vertex by a deterministic, invisibly small amount so the
 * triangulator cannot hit an exact tie.
 *
 * Earcut — which caps every extrusion — bridges each hole to the outer ring by
 * casting a ray, and that goes wrong when rings are *exactly* collinear with
 * one another. Text on a panel does this constantly: cut a line of glyphs out
 * of the background and every one of them has its baseline on the same
 * horizontal line. The cap it returns then spans across several holes at once
 * instead of following their edges, so the cap and the walls disagree about
 * where the boundary is and the solid is left with a hole in it.
 *
 * That does not show in a plain STL, where every colour lands in one solid a
 * slicer will happily heal, but a 3MF hands each colour over as its own mesh:
 * an unclosed one slices into missing letters and floating-region warnings.
 *
 * The offset is hashed from the coordinates rather than the vertex's position
 * in its ring, so a point shared by two layers is moved the same way in both
 * and touching walls stay touching. It is applied only for triangulation, at
 * a scale — a ten-thousandth of a millimetre on a finished sign — far below
 * what a printer resolves or a float32 export even records.
 */
/**
 * Smallest region worth extruding, in square millimetres.
 *
 * A tenth of a millimetre square, which is a quarter the width of a common
 * nozzle in each direction — nothing at or below this can be printed. Boolean
 * operations leave slivers this size along the edges they cut, and they arrive
 * as a few hundred points enclosing almost no area, self-crossing, and
 * impossible to triangulate into anything closed. Printing them is not an
 * option, so the choice is between dropping them and exporting a broken mesh.
 */
const MIN_PRINTABLE_MM2 = 0.01;

function breakTriangulationTies(shapes: THREE.Shape[], epsilon: number): THREE.Shape[] {
  if (epsilon <= 0) return shapes;

  const hash = (x: number, y: number, salt: number) => {
    const h = Math.sin(x * 12.9898 + y * 78.233 + salt) * 43758.5453;
    return (h - Math.floor(h) - 0.5) * epsilon;
  };

  const move = (points: THREE.Vector2[]) =>
    points.map(
      (p) => new THREE.Vector2(p.x + hash(p.x, p.y, 0), p.y + hash(p.x, p.y, 1.618)),
    );

  return shapes.map((shape) => {
    const { shape: outline, holes } = shape.extractPoints(1);
    const next = new THREE.Shape(move(outline));
    for (const hole of holes) next.holes.push(new THREE.Path(move(hole)));
    return next;
  });
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
  const cropped = cropParsed(source, config.crop);

  /*
   * Then open a hole for anything the stack would otherwise bury. This runs
   * ahead of flat mode's own subtraction on purpose: that one cuts a layer
   * back to what no later layer covers, which for a buried layer is nothing at
   * all. Revealing first leaves it a hole to survive in.
   */
  const parsed: ParsedSvg = { ...cropped, layers: revealBuriedLayers(cropped.layers) };

  const scale = config.widthMm / parsed.width;
  const group = new THREE.Group();
  let triangles = 0;

  /*
   * Relative to the artwork, so it means the same thing whatever units the
   * file was drawn in. A ten-millionth of the sign's longest edge is a
   * ten-thousandth of a millimetre at any size anyone prints.
   */
  const tieBreak = Math.max(parsed.width, parsed.height) * 1e-7;

  /** Clipping debris, in the shapes' own units. */
  const minArea = scale > 0 ? MIN_PRINTABLE_MM2 / (scale * scale) : 0;

  const addMesh = (shapes: THREE.Shape[], depth: number, color: string, zOffset = 0) => {
    const printable = shapes.filter((shape) => shapesArea([shape]) > minArea);
    if (printable.length === 0) return;

    const geometry = new THREE.ExtrudeGeometry(breakTriangulationTies(printable, tieBreak), {
      depth,
      bevelEnabled: false,
    });
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

  /*
   * What every layer above each one covers, accumulated top-down so each union
   * folds a single layer into the result already computed rather than starting
   * over from every shape above it. Rebuilding it per layer made generating a
   * two-hundred-shape sign four times slower on its own.
   */
  const coverAbove: THREE.Shape[][] = new Array(parsed.layers.length).fill(null);
  coverAbove[parsed.layers.length - 1] = [];
  for (let i = parsed.layers.length - 2; i >= 0; i--) {
    coverAbove[i] = unionShapes([...parsed.layers[i + 1].shapes, ...coverAbove[i + 1]]);
  }

  parsed.layers.forEach((layer, index) => {
    /*
     * Cut every layer back to the part no taller layer covers.
     *
     * Layers each run solid from the bed to their own height, so wherever two
     * overlap they occupy the same volume twice. Where they also share an
     * outline — a background and the border drawn around its edge, which is
     * most signs — that puts two outward-facing walls in exactly the same
     * plane, and the preview z-fights along the whole edge of the sign. It
     * hands a slicer two solids claiming one volume as well.
     *
     * Nothing is lost by removing it. The taller layer already fills the
     * overlap from the bed up past where the shorter one ends, so the union —
     * which is the printed object — is identical either way.
     *
     * Flat mode needs the same cut for a different reason: at a single height
     * the overlap is two colours sharing one top face rather than one hiding
     * inside the other.
     */
    /*
     * Normalized when there is nothing above to cut against, because the
     * clipping is what would otherwise have done it. The topmost layer never
     * gets cut, and merging concatenates the shapes of every layer folded into
     * it — two of which can overlap. Two overlapping solids in one mesh is
     * what a slicer calls non-manifold.
     */
    const exclusive =
      coverAbove[index].length > 0
        ? subtractShapes(layer.shapes, coverAbove[index])
        : normalizeShapes(layer.shapes);

    const shapes = insetUnits > 0 ? insetShapes(exclusive, insetUnits) : exclusive;

    if (config.flatMode) {
      /*
       * The lowest layer *is* the base. The slab above already carries its
       * colour and its thickness, so giving it a tile as well would stack the
       * background on top of itself — a step of its own colour standing proud
       * of the sign, with the artwork drawn on it at the same height.
       *
       * That leaves flat mode with the two layers it should have: the base the
       * sign is printed on, and everything else one step above it. Folding a
       * colour into the base is merging it with the lowest layer, which needs
       * no separate mechanism — merged layers already share a colour and a
       * height (§5.4).
       */
      if (index === 0) return;

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
