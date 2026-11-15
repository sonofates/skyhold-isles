import { BALANCE } from '../data/balance.ts';
import { parseLevelGrid, type LevelDef } from '../data/levels/index.ts';
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

export class MapGrid {
  readonly cols: number;
  readonly rows: number;
  readonly tiles: TileType[][];
  private occupiedTowerIds: Int32Array;

  constructor(level: LevelDef) {
    this.cols = level.cols;
    this.rows = level.rows;
    this.tiles = parseLevelGrid(level);
    this.occupiedTowerIds = new Int32Array(this.cols * this.rows);
    this.occupiedTowerIds.fill(-1);
  }

  getTile(col: number, row: number): TileType {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
      return 'empty';
    }
    return this.tiles[row][col];
  }

  isInside(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  getTowerIdAt(col: number, row: number): number {
    if (!this.isInside(col, row)) return -1;
    return this.occupiedTowerIds[row * this.cols + col];
  }

  canPlaceTower(col: number, row: number): boolean {
    if (!this.isInside(col, row)) return false;
    if (this.tiles[row][col] !== 'grass') return false;
    return this.occupiedTowerIds[row * this.cols + col] === -1;
  }

  setTowerAt(col: number, row: number, towerId: number): void {
    if (!this.isInside(col, row)) return;
    this.occupiedTowerIds[row * this.cols + col] = towerId;
  }

  clearTowerAt(col: number, row: number): void {
    if (!this.isInside(col, row)) return;
    this.occupiedTowerIds[row * this.cols + col] = -1;
  }

  resetOccupancy(): void {
    this.occupiedTowerIds.fill(-1);
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
