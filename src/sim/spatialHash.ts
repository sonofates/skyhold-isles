import { BALANCE } from '../data/balance.ts';

/**
 * Fixed-cell zero-allocation spatial hash grid for fast local enemy queries.
 */
export class SpatialHashGrid {
  private readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly gridCols: number;
  private readonly gridRows: number;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly head: Int32Array;
  private readonly next: Int32Array;

  constructor(worldWidth: number, worldDepth: number, maxEntities: number) {
    this.cellSize = BALANCE.spatialHashCellSize;
    this.invCellSize = 1 / this.cellSize;
    const pad = this.cellSize * 2;
    this.gridCols = Math.max(4, Math.ceil((worldWidth + pad * 2) * this.invCellSize));
    this.gridRows = Math.max(4, Math.ceil((worldDepth + pad * 2) * this.invCellSize));
    this.originX = -(this.gridCols * this.cellSize) * 0.5;
    this.originZ = -(this.gridRows * this.cellSize) * 0.5;

    this.head = new Int32Array(this.gridCols * this.gridRows);
    this.next = new Int32Array(maxEntities);
    this.clear();
  }

  clear(): void {
    this.head.fill(-1);
  }

  private cellCoordX(x: number): number {
    const cx = Math.floor((x - this.originX) * this.invCellSize);
    return cx < 0 ? 0 : cx >= this.gridCols ? this.gridCols - 1 : cx;
  }

  private cellCoordZ(z: number): number {
    const cz = Math.floor((z - this.originZ) * this.invCellSize);
    return cz < 0 ? 0 : cz >= this.gridRows ? this.gridRows - 1 : cz;
  }

  insert(entityIdx: number, x: number, z: number): void {
    if (entityIdx < 0 || entityIdx >= this.next.length || !Number.isFinite(x) || !Number.isFinite(z)) {
      return;
    }
    const cx = this.cellCoordX(x);
    const cz = this.cellCoordZ(z);
    const bucket = cz * this.gridCols + cx;
    this.next[entityIdx] = this.head[bucket];
    this.head[bucket] = entityIdx;
  }

  /**
   * Appends candidate entity indices inside the bounding cells of (x, z, radius) to `out`.
   * Caller checks exact distance squared. Zero allocations.
   */
  query(x: number, z: number, radius: number, out: number[]): void {
    out.length = 0;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(radius >= 0)) {
      return;
    }
    const minCx = this.cellCoordX(x - radius);
    const maxCx = this.cellCoordX(x + radius);
    const minCz = this.cellCoordZ(z - radius);
    const maxCz = this.cellCoordZ(z + radius);

    for (let cz = minCz; cz <= maxCz; cz++) {
      const rowBase = cz * this.gridCols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        let idx = this.head[rowBase + cx];
        while (idx !== -1) {
          out.push(idx);
          idx = this.next[idx];
        }
      }
    }
  }
}
