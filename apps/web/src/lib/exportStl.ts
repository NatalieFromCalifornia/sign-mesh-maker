import type * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

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
 * Exports the built group as a binary STL and hands it to the browser as a
 * download. STLs are never stored — they're fully re-derivable from the SVG
 * plus config (requirements §6).
 */
export function downloadStl(group: THREE.Object3D, filename: string): void {
  const result = new STLExporter().parse(group, { binary: true });
  const blob = new Blob([result as unknown as BlobPart], { type: 'model/stl' });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
