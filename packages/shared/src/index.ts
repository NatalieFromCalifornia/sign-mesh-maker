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
  svgStoragePath: string;
  thumbnailStoragePath: string;
  config: ProjectConfig;
}
