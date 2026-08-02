import ImageTracer, { type TracerOptions } from 'imagetracerjs';
import { quantize } from './quantize';

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
    // Ignored once `pal` is supplied, but kept consistent for clarity.
    colorsampling: 2,
    /*
     * Grain control. Antialiased edges in the source produce in-between pixels,
     * and the quantizer happily spends palette entries on them — which is what
     * turned clean artwork into speckle and inflated the layer count.
     *
     * The fringe of in-between colors along antialiased edges is removed in
     * quantize.ts, by discarding clusters that cover almost none of the image.
     * What is left here is smoothing the geometry:
     *
     * - blurradius takes the hard staircase off edges before they are traced.
     * - looser line and curve tolerance fits one long segment where a tight fit
     *   would chase every pixel of the staircase, which is what made straight
     *   edges come back jagged.
     * - pathomit drops the small stray paths that survive anyway.
     *
     * mincolorratio looks like the right knob for dropping rare colors, and is
     * a trap: the tracer implements it by replacing under-used palette entries
     * with `Math.random()`, injecting arbitrary colors and making the same
     * image trace differently each run.
     */
    blurradius: 1,
    blurdelta: 20,
    mincolorratio: 0,
    colorquantcycles: 5,
    pathomit: 16,
    ltres: 2,
    qtres: 2,
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

  /*
   * Our own k-means palette (§9.1) rather than the tracer's sampler, which
   * missed whole colors — see the note in quantize.ts.
   */
  const pal = quantize(data, clamped);

  let tracedata;
  try {
    tracedata = ImageTracer.imagedataToTracedata(data, { ...options, pal });
  } catch (cause) {
    console.error('Tracing failed', cause);
    throw new RasterError('This image could not be traced. Try fewer colors.');
  }

  const svg = ImageTracer.getsvgstring(tracedata, { ...options, pal });

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
