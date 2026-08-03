import type * as THREE from 'three';
import { partsFromGroup, type ExportPart } from './export3mf';

/** Slugifies a project name into something safe for a download filename. */
export function stlFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'sign'}.stl`;
}

/**
 * Writes binary STL from the same parts the 3MF export uses.
 *
 * Hand-rolled rather than three's STLExporter, which walks world matrices: once
 * the viewer parented the mesh under a pivot to tilt printer space into its own
 * Y-up world, the exporter baked that rotation in and the sign arrived in a
 * slicer standing on its edge. Sharing partsFromGroup means both formats come
 * out of one coordinate path, so they cannot disagree.
 *
 * STL carries no colour, so every part lands in one unnamed solid — which is
 * the reason to prefer the 3MF.
 */
export function buildStl(parts: ExportPart[]): ArrayBuffer {
  const triangles = parts.reduce((total, part) => total + part.positions.length / 9, 0);
  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);

  // 80-byte header is left zeroed; a leading "solid" would make some readers
  // treat the file as ASCII.
  view.setUint32(80, triangles, true);

  let offset = 84;
  for (const part of parts) {
    const p = part.positions;
    for (let i = 0; i < p.length; i += 9) {
      const ax = p[i], ay = p[i + 1], az = p[i + 2];
      const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
      const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];

      // Face normal from the winding, so it agrees with the geometry rather
      // than being left at zero for the reader to infer.
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length > 0) {
        nx /= length;
        ny /= length;
        nz /= length;
      }

      for (const value of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
      view.setUint16(offset, 0, true);
      offset += 2;
    }
  }

  return buffer;
}

export function downloadStl(group: THREE.Object3D, filename: string): void {
  const blob = new Blob([buildStl(partsFromGroup(group))], { type: 'model/stl' });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
