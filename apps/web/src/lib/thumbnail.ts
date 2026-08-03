import { shapeToPathData, type ParsedSvg } from './svgLayers';

/** Long edge of the stored thumbnail, per requirements §6. */
export const THUMBNAIL_PX = 320;
/** JPEG quality — the document budget matters more than fidelity at this size. */
const THUMBNAIL_QUALITY = 0.7;

/**
 * Serializes the parsed artwork to standalone SVG markup.
 *
 * Drawn from the parsed geometry and the assigned colours rather than the
 * uploaded file, so the thumbnail shows what will actually print — including
 * merges and recolours — instead of what was originally uploaded.
 */
export function artworkToSvg(parsed: ParsedSvg, colors: string[]): string {
  const { min, max } = parsed.bounds;
  const viewBox = [min.x, -max.y, parsed.width, parsed.height].join(' ');

  const groups = parsed.layers
    .map((layer, i) => {
      const paths = layer.shapes
        .map((shape) => `<path d="${shapeToPathData(shape)}" fill-rule="evenodd"/>`)
        .join('');
      return `<g fill="${colors[i] ?? layer.color}">${paths}</g>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${groups}</svg>`;
}

/**
 * Rasterizes the artwork to a compressed JPEG data URI.
 *
 * JPEG rather than PNG, and small, because this string is stored inline on the
 * Firestore document alongside the SVG and everything must fit under 1 MiB
 * (§6). A full-resolution PNG would eat that budget on its own.
 */
export async function renderThumbnail(
  parsed: ParsedSvg,
  colors: string[],
  maxPx: number = THUMBNAIL_PX,
): Promise<string> {
  const svg = artworkToSvg(parsed, colors);
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Could not rasterize the artwork.'));
    element.src = source;
  });

  const scale = Math.min(1, maxPx / Math.max(parsed.width, parsed.height));
  const width = Math.max(1, Math.round(parsed.width * scale));
  const height = Math.max(1, Math.round(parsed.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser would not provide a 2D canvas.');

  // JPEG has no alpha, so transparent artwork would encode as black without
  // something behind it.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
}
