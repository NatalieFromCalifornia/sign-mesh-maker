import { useMemo } from 'react';
import { shapeToPathData, type ParsedSvg } from '../lib/svgLayers';
import { cn } from '../lib/cn';

interface ArtworkPreviewProps {
  parsed: ParsedSvg;
  /** Hex per layer, index-aligned with `parsed.layers`. Defaults to the SVG's own fills. */
  colors?: string[];
  /** Dims every layer except this one, to isolate what a row refers to. */
  highlightIndex?: number | null;
  className?: string;
}

/**
 * Flat preview of the parsed artwork, drawn from the same shapes that get
 * extruded — not the uploaded file.
 *
 * That distinction matters: rendering the original SVG would show strokes and
 * text that the mesh silently drops. Drawing the parsed geometry means what you
 * see here is exactly what will be printed, so a missing region is visible
 * before generating rather than after.
 *
 * Layers paint in document order, so later ones sit on top — the same z-order
 * the extrusion heights follow (requirements §11).
 */
export function ArtworkPreview({
  parsed,
  colors,
  highlightIndex = null,
  className,
}: ArtworkPreviewProps) {
  const { viewBox, paths } = useMemo(() => {
    const { min, max } = parsed.bounds;
    // Shapes are Y-up; SVG is Y-down, so the display box flips across Y.
    const box = [min.x, -max.y, parsed.width, parsed.height].join(' ');

    return {
      viewBox: box,
      paths: parsed.layers.map((layer) => layer.shapes.map(shapeToPathData).join(' ')),
    };
  }, [parsed]);

  return (
    <svg
      viewBox={viewBox}
      className={cn('size-full', className)}
      role="img"
      aria-label={`Artwork preview, ${parsed.layers.length} color layers`}
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill={colors?.[i] ?? parsed.layers[i].color}
          fillRule="evenodd"
          opacity={highlightIndex === null || highlightIndex === i ? 1 : 0.15}
          style={{ transition: 'opacity 120ms' }}
        />
      ))}
    </svg>
  );
}
