declare module 'clipper-lib' {
  export interface IntPoint {
    X: number;
    Y: number;
  }

  export enum JoinType {
    jtSquare = 0,
    jtRound = 1,
    jtMiter = 2,
  }

  export enum EndType {
    etOpenSquare = 0,
    etOpenRound = 1,
    etOpenButt = 2,
    etClosedLine = 3,
    etClosedPolygon = 4,
  }

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: IntPoint[], joinType: JoinType, endType: EndType): void;
    AddPaths(paths: IntPoint[][], joinType: JoinType, endType: EndType): void;
    /** Negative deltas inset; positive deltas grow. */
    Execute(solution: IntPoint[][], delta: number): void;
    Clear(): void;
  }

  export const JS: {
    /** Clipper works in integers; coordinates must be scaled before use. */
    ScaleUpPaths(paths: IntPoint[][], scale: number): void;
    ScaleDownPaths(paths: IntPoint[][], scale: number): void;
    AreaOfPolygon(poly: IntPoint[], scale?: number): number;
  };

  export enum ClipType {
    ctIntersection = 0,
    ctUnion = 1,
    ctDifference = 2,
    ctXor = 3,
  }

  export enum PolyType {
    ptSubject = 0,
    ptClip = 1,
  }

  export enum PolyFillType {
    pftEvenOdd = 0,
    pftNonZero = 1,
    pftPositive = 2,
    pftNegative = 3,
  }

  export class PolyNode {
    Contour(): IntPoint[];
    Childs(): PolyNode[];
    IsHole(): boolean;
  }

  export class PolyTree extends PolyNode {
    Clear(): void;
  }

  export class Clipper {
    constructor(initOptions?: number);
    AddPaths(paths: IntPoint[][], polyType: PolyType, closed: boolean): boolean;
    Execute(
      clipType: ClipType,
      solution: PolyTree | IntPoint[][],
      subjFillType?: PolyFillType,
      clipFillType?: PolyFillType,
    ): boolean;
    Clear(): void;

    /**
     * Drops vertices that sit within `distance` of the edge through their
     * neighbours — the near-duplicate and near-collinear points a boolean
     * operation leaves along a shared edge.
     */
    static CleanPolygon(path: IntPoint[], distance?: number): IntPoint[];
  }
}
