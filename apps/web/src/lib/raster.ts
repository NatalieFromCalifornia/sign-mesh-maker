import ImageTracer, { type TracerOptions } from 'imagetracerjs';

/**
 * Longest edge the tracer sees. Tracing cost grows with pixel count, and a sign
 * is printed at a few hundred millimetres from art that is usually flat color —
 * detail beyond this resolution becomes path noise, not fidelity.
 */
export const MAX_TRACE_EDGE = 700;

export const DEFAULT_COLOR_COUNT = 8;
export const MIN_COLOR_COUNT = 2;
/** Requirements §11 warns that mesh complexity gets impractical past ~12 colors. */
export const MAX_COLOR_COUNT = 16;

export class RasterError extends Error {}

/**
 * Decodes an image file and downsamples it for tracing.
 *
 * Uses createImageBitmap where available so decoding happens off the main
 * thread; the canvas draw that follows is the only blocking part.
 */
export async function fileToImageData(
  file: File,
  maxEdge: number = MAX_TRACE_EDGE,
): Promise<ImageData> {
  let bitmap: ImageBitmap | HTMLImageElement;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Safari and older browsers: fall back to an <img> and an object URL.
    bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new RasterError('That image could not be decoded.'));
      };
      image.src = url;
    });
  }

  const sourceWidth = 'width' in bitmap ? bitmap.width : 0;
  const sourceHeight = 'height' in bitmap ? bitmap.height : 0;
  if (!sourceWidth || !sourceHeight) {
    throw new RasterError('That image has no dimensions.');
  }

  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new RasterError('This browser would not provide a 2D canvas.');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);

  if ('close' in bitmap) bitmap.close();

  return context.getImageData(0, 0, width, height);
}

export interface TraceResult {
  /** SVG markup with one filled path group per quantized color. */
  svg: string;
  /** Detected palette as `#rrggbb`, fully transparent entries dropped. */
  palette: string[];
}

function traceOptions(colorCount: number): Partial<TracerOptions> {
  return {
    numberofcolors: colorCount,
    // Deterministic sampling: the same image and count must trace identically,
    // or nudging the color count would reshuffle unrelated regions.
    colorsampling: 2,
    /*
     * Grain control. Antialiased edges in the source produce in-between pixels,
     * and the quantizer happily spends palette entries on them — which is what
     * turned clean artwork into speckle and inflated the layer count.
     *
     * - blurradius smooths those edge pixels before quantizing.
     * - more quant cycles converge the remaining colors onto real ones.
     * - a larger pathomit drops the small stray paths that survive anyway.
     *
     * mincolorratio looks like the right knob for dropping rare colors, but the
     * tracer implements it by replacing under-used palette entries with
     * `Math.random()` — injecting arbitrary colors and making the same image
     * trace differently each run. Near-identical colors are folded afterwards
     * by mergeSimilarColors instead, which is deterministic.
     */
    blurradius: 1,
    blurdelta: 20,
    mincolorratio: 0,
    colorquantcycles: 5,
    pathomit: 16,
    // Looser line/curve tolerance: fewer, longer segments instead of a jagged
    // fit to antialiasing noise.
    ltres: 1.5,
    qtres: 1.5,
    rightangleenhance: true,
    // Strokes would be traced as separate hairline geometry; signs are fills.
    strokewidth: 0,
    linefilter: true,
    roundcoords: 2,
    viewbox: true,
  };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const channel = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Quantizes to `colorCount` colors and traces each to filled paths.
 *
 * Deliberately synchronous and blocking. Requirements §9.1 treats this as the
 * fast, near-live loop the user tunes — distinct from mesh generation, which is
 * explicitly button-triggered (§5.6). Callers should debounce it and paint a
 * busy state first.
 */
export function traceImageData(data: ImageData, colorCount: number): TraceResult {
  const clamped = Math.max(MIN_COLOR_COUNT, Math.min(MAX_COLOR_COUNT, Math.round(colorCount)));
  const options = traceOptions(clamped);

  let tracedata;
  try {
    tracedata = ImageTracer.imagedataToTracedata(data, options);
  } catch (cause) {
    console.error('Tracing failed', cause);
    throw new RasterError('This image could not be traced. Try fewer colors.');
  }

  const svg = ImageTracer.getsvgstring(tracedata, options);

  /*
   * Deduplicated, because the quantizer targets the requested count but
   * converges on fewer distinct colors for flat artwork — asking for 8 on a
   * four-color graphic yields repeats. Showing every raw entry would promise
   * eight printed colors and deliver four. Transparent entries print nothing.
   */
  const palette = [
    ...new Set(tracedata.palette.filter((entry) => entry.a > 0).map(toHex)),
  ];

  return { svg, palette };
}

export function isRasterFile(file: File): boolean {
  return /^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}
