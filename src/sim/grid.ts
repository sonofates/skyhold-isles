import { BALANCE } from '../data/balance.ts';
import { parseLevelGrid, type LevelDef, type WorldPoint } from '../data/levels/index.ts';
import type { GridCoord, TileType } from '../core/types.ts';

export function gridToWorldX(col: number, cols: number): number {
  return (col - (cols - 1) * 0.5) * BALANCE.tileSize;
}

export function gridToWorldZ(row: number, rows: number): number {
  return (row - (rows - 1) * 0.5) * BALANCE.tileSize;
}

export function worldToGridCoord(x: number, z: number, cols: number, rows: number): GridCoord | null {
  const col = Math.round(x / BALANCE.tileSize + (cols - 1) * 0.5);
  const row = Math.round(z / BALANCE.tileSize + (rows - 1) * 0.5);
  if (col < 0 || col >= cols || row < 0 || row >= rows) {
    return null;
  }
  return { col, row };
}

/**
 * Build-site board. Tile levels: one site per grass tile (col, row). Plot levels (`layout2d`):
 * one site per painted plot, addressed as (col = plot index, row = 0) so build scripts, the
 * balance sim and `SimWorld.placeTower` use the same surface for both kinds of map.
 */
export class MapGrid {
  readonly cols: number;
  readonly rows: number;
  readonly tiles: TileType[][];
  /** Plot centres (world units) on plot levels, otherwise null. */
  readonly plots: readonly WorldPoint[] | null;
  readonly plotRadius: number;
  private occupiedTowerIds: Int32Array;
  private readonly plotTowerIds: Int32Array;

  constructor(level: LevelDef) {
    this.cols = level.cols;
    this.rows = level.rows;
    this.tiles = parseLevelGrid(level);
    this.occupiedTowerIds = new Int32Array(this.cols * this.rows);
    this.occupiedTowerIds.fill(-1);
    this.plots = level.layout2d ? level.layout2d.plots : null;
    this.plotRadius = level.layout2d ? level.layout2d.plotRadius : 0;
    this.plotTowerIds = new Int32Array(this.plots ? this.plots.length : 0);
    this.plotTowerIds.fill(-1);
  }

  /** True when towers can only be built on plots. */
  get isPlotMode(): boolean {
    return this.plots !== null;
  }

  get plotCount(): number {
    return this.plots ? this.plots.length : 0;
  }

  private isPlotSite(col: number, row: number): boolean {
    return this.plots !== null && row === 0 && col >= 0 && col < this.plots.length && Number.isInteger(col);
  }

  /**
   * Index of the plot whose centre is within `plotRadius * slack` of (x, z), nearest first;
   * -1 if none (or on tile levels).
   */
  findPlotAt(x: number, z: number, slack = 1): number {
    if (!this.plots) return -1;
    const r = this.plotRadius * slack;
    let best = -1;
    let bestSq = r * r;
    for (let i = 0; i < this.plots.length; i++) {
      const dx = this.plots[i].x - x;
      const dz = this.plots[i].z - z;
      const dSq = dx * dx + dz * dz;
      if (dSq <= bestSq) {
        bestSq = dSq;
        best = i;
      }
    }
    return best;
  }

  /** World X of a build site (tile centre, or plot centre on plot levels). */
  siteWorldX(col: number, row: number): number {
    if (this.plots) return this.isPlotSite(col, row) ? this.plots[col].x : 0;
    return gridToWorldX(col, this.cols);
  }

  /** World Z of a build site (tile centre, or plot centre on plot levels). */
  siteWorldZ(col: number, row: number): number {
    if (this.plots) return this.isPlotSite(col, row) ? this.plots[col].z : 0;
    return gridToWorldZ(row, this.rows);
  }

  getTile(col: number, row: number): TileType {
    if (!this.isInside(col, row)) {
      return 'empty';
    }
    return this.tiles[row][col];
  }

  isInside(col: number, row: number): boolean {
    return (
      Number.isInteger(col) &&
      Number.isInteger(row) &&
      col >= 0 &&
      col < this.cols &&
      row >= 0 &&
      row < this.rows
    );
  }

  getTowerIdAt(col: number, row: number): number {
    if (this.plots) return this.isPlotSite(col, row) ? this.plotTowerIds[col] : -1;
    if (!this.isInside(col, row)) return -1;
    return this.occupiedTowerIds[row * this.cols + col];
  }

  canPlaceTower(col: number, row: number): boolean {
    if (this.plots) return this.isPlotSite(col, row) && this.plotTowerIds[col] === -1;
    if (!this.isInside(col, row)) return false;
    if (this.tiles[row][col] !== 'grass') return false;
    return this.occupiedTowerIds[row * this.cols + col] === -1;
  }

  setTowerAt(col: number, row: number, towerId: number): void {
    if (this.plots) {
      if (this.isPlotSite(col, row)) this.plotTowerIds[col] = towerId;
      return;
    }
    if (!this.isInside(col, row)) return;
    this.occupiedTowerIds[row * this.cols + col] = towerId;
  }

  clearTowerAt(col: number, row: number): void {
    if (this.plots) {
      if (this.isPlotSite(col, row)) this.plotTowerIds[col] = -1;
      return;
    }
    if (!this.isInside(col, row)) return;
    this.occupiedTowerIds[row * this.cols + col] = -1;
  }

  resetOccupancy(): void {
    this.occupiedTowerIds.fill(-1);
    this.plotTowerIds.fill(-1);
  }

  gridToWorldX(col: number): number {
    return gridToWorldX(col, this.cols);
  }

  gridToWorldZ(row: number): number {
    return gridToWorldZ(row, this.rows);
  }

  worldToGrid(x: number, z: number): GridCoord | null {
    return worldToGridCoord(x, z, this.cols, this.rows);
  }
}
