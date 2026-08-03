/**
 * A source colour and the colour the user assigned to it.
 *
 * Requirements §6 also lists `id`, `order` and `mergedWith`. They are omitted
 * deliberately: order is the array index, and merging is expressed by two
 * layers sharing an `assignedColor` — the rule §5.4 already defines. Storing
 * either separately would be duplicate state that can disagree with itself.
 */
export interface LayerConfig {
  /** Fill colour as it appeared in the source SVG, as `#rrggbb`. */
  originalColor: string;
  /** Colour to print this layer in. Layers sharing one become a single layer. */
  assignedColor: string;
}

export interface ProjectConfig {
  /** Finished width of the sign; height follows from the artwork's aspect. */
  widthMm: number;
  /** Thickness of the lowest layer (requirements §5.3). */
  baseMm: number;
  /** Step added per layer above the lowest (requirements §5.3). */
  layerMm: number;
  layers: LayerConfig[];

  /*
   * Not stored, because not built: cropRect (§5.3), flatMode and flatGapMm
   * (§5.5). Height is not cached either — §6 suggests caching it, but it is
   * derived from the artwork's aspect, and a cached copy can only drift out of
   * agreement with the SVG it came from.
   */
}

/** A saved project. Stored whole on one Firestore document — no Storage (§6). */
export interface Project {
  id: string;
  ownerUid: string;
  name: string;
  /** Epoch milliseconds, converted from the Firestore timestamp on read. */
  createdAt: number;
  updatedAt: number;
  /** Full SVG markup, stored inline — no Firebase Storage is used (Spark plan only). */
  svg: string;
  /** Small base64 data: URI (JPEG, ~300px, quality-compressed) to stay under Firestore's 1 MiB document limit. */
  thumbnailDataUrl: string;
  config: ProjectConfig;
}

/** Row in the projects list; carries no SVG payload. */
export type ProjectSummary = Omit<Project, 'svg' | 'config'>;
