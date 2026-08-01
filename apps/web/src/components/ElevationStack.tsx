import { cn } from '../lib/cn';

/*
 * The signature device: a side-view elevation of a finished sign — base slab
 * plus three colored strata, dimensioned in mm off a datum line.
 *
 * This is the product's thesis in one drawing. Flat art goes in; discrete
 * colored strata at measured heights come out. It reuses the real vocabulary
 * of the config step (base thickness, layer thickness, per-color height), so
 * it teaches the model a user is about to work in.
 */

const MM = 14; // px per mm
const DATUM = 158;
const at = (mm: number) => DATUM - mm * MM;

interface Stratum {
  x: number;
  width: number;
  /** Height of this region's underside — the surface it is printed onto. */
  fromMm: number;
  /** Finished height of this region, measured from the datum. */
  toMm: number;
  fill: string;
  label: string;
}

/*
 * Base 2.00 + n × 1.00, the defaults suggested in requirements §5.3.
 *
 * Each color occupies only the band it actually prints in — a layer at 3.00
 * is one millimetre of color sitting on the base, not a solid column down to
 * the bed. Drawing it any other way would misstate how the sign is built.
 */
const BASE_MM = 2;

const STRATA: Stratum[] = [
  { x: 24, width: 226, fromMm: 0, toMm: BASE_MM, fill: 'var(--color-bench-2)', label: 'base' },
  { x: 40, width: 72, fromMm: BASE_MM, toMm: 3, fill: 'var(--color-filament-3)', label: 'layer 1' },
  { x: 124, width: 62, fromMm: BASE_MM, toMm: 4, fill: 'var(--color-filament-2)', label: 'layer 2' },
  { x: 198, width: 38, fromMm: BASE_MM, toMm: 5, fill: 'var(--color-filament-1)', label: 'layer 3' },
];

const LEADER_X = 258;
const TOP_MM = Math.max(...STRATA.map((s) => s.toMm));

export function ElevationStack({ className }: { className?: string }) {
  return (
    // Cropped tight to the drawing's ink: a full-height box left roughly a
    // third of the frame empty above the stack, pushing the device away from
    // its own caption.
    <svg
      viewBox="0 64 320 116"
      className={cn('w-full', className)}
      role="img"
      aria-label="Side elevation of a printed sign: a 2 mm base with three colored layers stepping up to 5 mm."
    >
      {/* Datum line — everything is dimensioned from the print bed. */}
      <line
        x1="12"
        y1={DATUM}
        x2="300"
        y2={DATUM}
        stroke="var(--color-rule-strong)"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <text
        x="12"
        y={DATUM + 14}
        className="font-mono"
        fontSize="8"
        fill="var(--color-graphite)"
        letterSpacing="0.08em"
      >
        DATUM 0.00
      </text>

      {STRATA.map((s, i) => (
        <g key={s.label}>
          <rect
            className="stratum"
            style={{ animationDelay: `${i * 110}ms` }}
            x={s.x}
            y={at(s.toMm)}
            width={s.width}
            height={(s.toMm - s.fromMm) * MM}
            fill={s.fill}
            stroke="var(--color-mat)"
            strokeWidth="1"
            rx="1"
          />
          {/* Dimension leader from the stratum's top edge out to the callout. */}
          <line
            x1={s.x + s.width}
            y1={at(s.toMm)}
            x2={LEADER_X}
            y2={at(s.toMm)}
            stroke="var(--color-rule-strong)"
            strokeWidth="0.75"
          />
          <line
            x1={LEADER_X}
            y1={at(s.toMm) - 3}
            x2={LEADER_X}
            y2={at(s.toMm) + 3}
            stroke="var(--color-rule-strong)"
            strokeWidth="0.75"
          />
          <text
            x={LEADER_X + 6}
            y={at(s.toMm)}
            className="font-mono"
            fontSize="10"
            dominantBaseline="middle"
            fill={i === 0 ? 'var(--color-graphite)' : 'var(--color-chalk)'}
          >
            {s.toMm.toFixed(2)}
          </text>
        </g>
      ))}

      <text
        x={LEADER_X + 6}
        y={at(TOP_MM) - 14}
        className="font-mono"
        fontSize="8"
        fill="var(--color-graphite)"
        letterSpacing="0.08em"
      >
        MM
      </text>
    </svg>
  );
}
