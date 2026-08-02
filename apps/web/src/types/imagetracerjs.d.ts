declare module 'imagetracerjs' {
  export interface TracerOptions {
    /** Palette size the quantizer targets. */
    numberofcolors: number;
    /** 0 = generate, 1 = random sample, 2 = deterministic sample. */
    colorsampling: 0 | 1 | 2;
    colorquantcycles: number;
    mincolorratio: number;
    /** Drops paths shorter than this, which removes speckle. */
    pathomit: number;
    ltres: number;
    qtres: number;
    rightangleenhance: boolean;
    linefilter: boolean;
    strokewidth: number;
    roundcoords: number;
    viewbox: boolean;
    desc: boolean;
    scale: number;
    blurradius: number;
    blurdelta: number;
    layering: 0 | 1;
    /** Fixed palette. When present the tracer skips its own colour selection. */
    pal: { r: number; g: number; b: number; a: number }[];
  }

  export interface PaletteEntry {
    r: number;
    g: number;
    b: number;
    a: number;
  }

  export interface TraceData {
    palette: PaletteEntry[];
    width: number;
    height: number;
    layers: unknown[];
  }

  export function imagedataToTracedata(
    imgd: ImageData,
    options?: Partial<TracerOptions>,
  ): TraceData;

  export function getsvgstring(tracedata: TraceData, options?: Partial<TracerOptions>): string;

  export function imagedataToSVG(imgd: ImageData, options?: Partial<TracerOptions>): string;

  const ImageTracer: {
    imagedataToTracedata: typeof imagedataToTracedata;
    getsvgstring: typeof getsvgstring;
    imagedataToSVG: typeof imagedataToSVG;
    optionpresets: Record<string, Partial<TracerOptions>>;
  };

  export default ImageTracer;
}
