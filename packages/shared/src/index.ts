export interface LayerConfig {
  id: string;
  originalColor: string;
  assignedColor: string;
  order: number;
  mergedWith?: string[];
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProjectConfig {
  cropRect: CropRect;
  dimensionMm: { width: number; height: number };
  baseThicknessMm: number;
  layerThicknessMm: number;
  flatMode: boolean;
  flatGapMm: number;
  layers: LayerConfig[];
}

export interface Project {
  id: string;
  ownerUid: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Full SVG markup, stored inline — no Firebase Storage is used (Spark plan only). */
  svg: string;
  /** Small base64 data: URI (JPEG, ~300px, quality-compressed) to stay under Firestore's 1 MiB document limit. */
  thumbnailDataUrl: string;
  config: ProjectConfig;
}
