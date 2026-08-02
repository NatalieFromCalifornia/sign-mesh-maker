/** A plain three-color sign: hex fills, no nesting, no surprises. */
export const HEX_SIGN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect x="0" y="0" width="200" height="100" fill="#2f9d8f"/>
  <rect x="20" y="20" width="60" height="60" fill="#f2681c"/>
  <rect x="120" y="20" width="60" height="60" fill="#ffffff"/>
</svg>`;

/**
 * Percentage fills carrying decimals — the exact shape Cairo emits, which
 * covers most Inkscape and PDF-derived SVGs.
 *
 * This is the file class that shipped broken: three's Color.setStyle matches
 * percentages with `(\d+)%`, so every one of these failed to parse, fell back
 * to white, and collapsed the artwork into a single layer.
 */
export const CAIRO_PERCENT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path fill="rgb(75.72937%, 87.400818%, 96.116638%)" d="M 0 0 L 100 0 L 100 100 L 0 100 Z"/>
  <path fill="rgb(94.996643%, 56.086731%, 38.415527%)" d="M 10 10 L 40 10 L 40 40 L 10 40 Z"/>
  <path fill="rgb(17.643738%, 16.757202%, 17.834473%)" d="M 60 60 L 90 60 L 90 90 L 60 90 Z"/>
</svg>`;

/** Two overlapping circles sharing one fill — the fill-rule cancellation case. */
export const OVERLAPPING_SAME_COLOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
  <circle cx="35" cy="30" r="25" fill="#ffffff"/>
  <circle cx="65" cy="30" r="25" fill="#ffffff"/>
</svg>`;

/** Strokes only — nothing fillable, so parsing must fail with a clear message. */
export const STROKE_ONLY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M 10 10 L 90 90" fill="none" stroke="#000000" stroke-width="4"/>
</svg>`;
