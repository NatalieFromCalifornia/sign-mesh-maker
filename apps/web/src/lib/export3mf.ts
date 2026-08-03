import * as THREE from 'three';
import { strToU8, zipSync } from 'fflate';

/**
 * 3MF export.
 *
 * Preferred over a zip of per-colour STLs. Those carry no colour at all, and
 * their alignment survives only if the slicer is asked to load them as one
 * object with several parts — drag them in one at a time and each gets centred
 * on the plate independently, scattering the sign. A 3MF holds every part in
 * one coordinate system inside one file, so there is no import ritual to get
 * wrong, and it carries the colours.
 *
 * Core 3MF (the 2015/02 namespace) carries the geometry: one object per colour,
 * assembled through <components> so they stay a single build item, with a
 * <basematerials> entry per colour.
 *
 * Colour is carried by an <m:colorgroup> from the Materials & Properties
 * extension, not by core <basematerials>. Slicers read the former and ignore
 * the latter — a file carrying only basematerials opens uniformly grey, and
 * once it is bound to slots without colours it takes whatever the slots
 * happened to be set to. Orca matches a colorgroup's hex values onto filament
 * slots by nearest colour.
 *
 * `Metadata/model_settings.config` then binds each part to a slot by index.
 * Slots are finite, so the caller passes how many the printer has: a file
 * naming extruder 7 on a four-slot machine has its extra colours collapsed
 * silently, which is worse than being told to merge them first.
 */

const MODEL_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
/** Materials & Properties extension — where colour actually lives for slicers. */
const MATERIAL_NS = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02';
const MODEL_REL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="text/xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rel0" Target="/3D/3dmodel.model" Type="${MODEL_REL}"/>
</Relationships>`;

export interface ExportPart {
  /** `#rrggbb`; becomes the part's display colour. */
  color: string;
  name: string;
  /** World-space triangles, three vertices each. */
  positions: Float32Array;
}

/** Rounds to micrometres — finer than any printer resolves, and keeps files small. */
function num(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 3MF display colours are #RRGGBBAA. */
function displayColor(hex: string): string {
  const clean = hex.replace('#', '').toLowerCase();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return `#${full.toUpperCase()}FF`;
}

/**
 * Collects a built group's meshes as parts, in the group's own coordinates.
 *
 * Relative to the group, deliberately not world space. The viewer parents the
 * group under a pivot that tilts printer space into three.js's Y-up world, and
 * reading matrixWorld picks that rotation up — which is exactly how exports
 * ended up with thickness along Y, arriving in a slicer standing on edge.
 * Inverting the group's own world matrix removes whatever it happens to be
 * parented to.
 */
export function partsFromGroup(group: THREE.Object3D): ExportPart[] {
  const parts: ExportPart[] = [];
  group.updateMatrixWorld(true);

  const toGroupSpace = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const local = new THREE.Matrix4();

  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    const geometry = child.geometry as THREE.BufferGeometry;
    const source = geometry.getAttribute('position');
    if (!source) return;

    const positions = new Float32Array(source.count * 3);
    const vertex = new THREE.Vector3();

    local.multiplyMatrices(toGroupSpace, child.matrixWorld);

    for (let i = 0; i < source.count; i++) {
      vertex.fromBufferAttribute(source as THREE.BufferAttribute, i);
      vertex.applyMatrix4(local);
      positions[i * 3] = vertex.x;
      positions[i * 3 + 1] = vertex.y;
      positions[i * 3 + 2] = vertex.z;
    }

    const color =
      child.material instanceof THREE.MeshStandardMaterial
        ? `#${child.material.color.getHexString()}`
        : '#cccccc';

    parts.push({ color, name: child.name || color, positions });
  });

  return parts;
}

export function buildModelXml(parts: ExportPart[]): string {
  /*
   * 3MF expects the build volume in the positive octant. The mesh is centred on
   * the origin for the preview, so half of it sits at negative X and Y; shifting
   * to the corner avoids relying on each slicer to tolerate that.
   */
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const part of parts) {
    for (let i = 0; i < part.positions.length; i += 3) {
      box.expandByPoint(
        point.set(part.positions[i], part.positions[i + 1], part.positions[i + 2]),
      );
    }
  }
  const offset = box.isEmpty() ? new THREE.Vector3() : box.min.clone();

  const colors = parts
    .map((part) => `      <m:color color="${displayColor(part.color)}"/>`)
    .join('\n');

  const objects = parts
    .map((part, index) => {
      const vertices: string[] = [];
      const triangles: string[] = [];
      const count = part.positions.length / 3;

      for (let i = 0; i < count; i++) {
        vertices.push(
          `<vertex x="${num(part.positions[i * 3] - offset.x)}" y="${num(
            part.positions[i * 3 + 1] - offset.y,
          )}" z="${num(part.positions[i * 3 + 2] - offset.z)}"/>`,
        );
      }
      // Non-indexed geometry: every three vertices are one triangle, already
      // wound counter-clockwise as seen from outside.
      for (let i = 0; i < count; i += 3) {
        triangles.push(`<triangle v1="${i}" v2="${i + 1}" v3="${i + 2}"/>`);
      }

      return `    <object id="${index + 2}" type="model" pid="1" pindex="${index}">
      <mesh>
        <vertices>${vertices.join('')}</vertices>
        <triangles>${triangles.join('')}</triangles>
      </mesh>
    </object>`;
    })
    .join('\n');

  // One assembly object holding every colour, so the sign arrives as a single
  // build item rather than parts the user has to re-associate.
  const assemblyId = parts.length + 2;
  const components = parts
    .map((_, index) => `      <component objectid="${index + 2}"/>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${MODEL_NS}" xmlns:m="${MATERIAL_NS}">
  <resources>
    <m:colorgroup id="1">
${colors}
    </m:colorgroup>
${objects}
    <object id="${assemblyId}" type="model">
      <components>
${components}
      </components>
    </object>
  </resources>
  <build>
    <item objectid="${assemblyId}"/>
  </build>
</model>`;
}

/**
 * Orca/Bambu part settings: binds each part to a filament slot.
 *
 * The `object` id is the assembly, and each `part` id is one of its components
 * in 3dmodel.model, so the two files line up by construction. Extruders are
 * 1-based and assigned in layer order; a sign with more colours than the
 * printer has slots needs layers merged down first, which the editor does.
 */
export function buildModelSettings(parts: ExportPart[], slots = DEFAULT_SLOTS): string {
  const assemblyId = parts.length + 2;
  const usable = Math.max(1, Math.round(slots));

  const entries = parts
    .map((part, index) => {
      /*
       * Clamped, not wrapped. Naming a slot the printer does not have leaves
       * the slicer to collapse it however it likes; sending the overflow to
       * the last real slot is at least predictable, and the editor warns so
       * the colours get merged deliberately instead.
       */
      const extruder = Math.min(index + 1, usable);
      return `    <part id="${index + 2}" subtype="normal_part">
      <metadata key="name" value="${escapeXml(part.name)}"/>
      <metadata key="extruder" value="${extruder}"/>
    </part>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${assemblyId}">
    <metadata key="name" value="Sign"/>
${entries}
  </object>
</config>`;
}

/** Filament slots on a common multi-material setup. */
export const DEFAULT_SLOTS = 4;

export function build3mf(parts: ExportPart[], slots = DEFAULT_SLOTS): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(RELS),
      '3D/3dmodel.model': strToU8(buildModelXml(parts)),
      'Metadata/model_settings.config': strToU8(buildModelSettings(parts, slots)),
    },
    // Deflate: the XML is highly repetitive and compresses to a fraction.
    { level: 6 },
  );
}

export function download3mf(
  group: THREE.Object3D,
  filename: string,
  slots = DEFAULT_SLOTS,
): void {
  const blob = new Blob([build3mf(partsFromGroup(group), slots) as unknown as BlobPart], {
    type: 'model/3mf',
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Swaps an `.stl` name for `.3mf`. */
export function threeMfFilename(stlName: string): string {
  return stlName.replace(/\.stl$/i, '') + '.3mf';
}
