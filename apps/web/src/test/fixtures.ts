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

/**
 * One path whose outline doubles back across itself.
 *
 * This is what text converted to paths produces where a font's strokes overlap
 * at a join, and it renders correctly everywhere — a renderer just applies the
 * fill rule, so the file looks fine and gives no warning. Earcut has no fill
 * rule, and webs the crossings over with extra triangles: on a real sign that
 * arrived as a membrane stretched across the wide letters.
 *
 * As drawn the ring sweeps 5000 units² with 1200 of that covered twice.
 */
export const SELF_INTERSECTING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 50">
  <path fill="#010101" d="M 0 0 L 60 0 L 60 40 L 20 40 L 20 10 L 80 10 L 80 50 L 0 50 Z"/>
</svg>`;

/**
 * A stroked line with no fill. Printable: the stroke becomes the region it
 * paints, so this is one layer four units wide, not an empty sign.
 */
export const STROKE_ONLY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M 10 10 L 90 90" fill="none" stroke="#000000" stroke-width="4"/>
</svg>`;

/**
 * A sign whose border is a stroke rather than a filled ring, which is how a
 * design tool draws one unless the stroke is expanded on the way out.
 *
 * The fill and the stroke are different colours, so the border is a layer of
 * its own — and it went missing entirely before strokes were printed.
 */
export const STROKED_BORDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">
  <rect x="10" y="10" width="100" height="60" fill="#e5dac5" stroke="#102132" stroke-width="6"/>
</svg>`;

/** Nothing paintable at all — no fill, no stroke. */
export const EMPTY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M 10 10 L 90 90" fill="none" stroke="none"/>
</svg>`;

/**
 * A background, a panel on it, and a caption inside the panel.
 *
 * Merging the caption into the background puts it at the background's
 * position, under the panel, which covers it completely — the arrangement that
 * made a merged caption vanish.
 */
export const CAPTION_ON_PANEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect x="0" y="0" width="200" height="100" fill="#2f9d8f"/>
  <rect x="40" y="20" width="120" height="60" fill="#ad130f"/>
  <rect x="70" y="40" width="60" height="20" fill="#ffffff"/>
</svg>`;
