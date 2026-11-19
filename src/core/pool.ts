/**
 * Pre-allocated fixed-capacity object pool for zero-GC hot loops.
 */
export class ObjectPool<T extends { active: boolean }> {
  readonly items: T[];
  private activeIndices: number[];
  private freeIndices: number[];

  constructor(capacity: number, factory: (id: number) => T) {
    this.items = new Array<T>(capacity);
    this.activeIndices = [];
    this.freeIndices = new Array<number>(capacity);

    for (let i = 0; i < capacity; i++) {
      this.items[i] = factory(i);
      this.items[i].active = false;
      // Pop from end gives lowest index first
      this.freeIndices[i] = capacity - 1 - i;
    }
  }

  acquire(): T | null {
    if (this.freeIndices.length === 0) {
      return null;
    }
    const idx = this.freeIndices.pop()!;
    const item = this.items[idx];
    item.active = true;
    this.activeIndices.push(idx);
    return item;
  }

  /** Swap-remove deactivation at index inside activeIndices array. */
  releaseAtActivePos(activePos: number): void {
    if (!Number.isInteger(activePos) || activePos < 0 || activePos >= this.activeIndices.length) return;
    const idx = this.activeIndices[activePos];
    if (!this.items[idx].active) return;
    this.items[idx].active = false;
    this.freeIndices.push(idx);

    const lastPos = this.activeIndices.length - 1;
    if (activePos !== lastPos) {
      this.activeIndices[activePos] = this.activeIndices[lastPos];
    }
    this.activeIndices.pop();
  }

  getActiveCount(): number {
    return this.activeIndices.length;
  }

  getActiveIndex(pos: number): number {
    return this.activeIndices[pos];
  }

  clear(): void {
    for (let i = 0; i < this.activeIndices.length; i++) {
      const idx = this.activeIndices[i];
      this.items[idx].active = false;
      this.freeIndices.push(idx);
    }
    this.activeIndices.length = 0;
  }
}
