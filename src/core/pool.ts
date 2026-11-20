/**
 * Pre-allocated fixed-capacity object pool for zero-GC hot loops.
 */
export class ObjectPool<T extends { active: boolean }> {
  readonly items: T[];
  private activeIndices: number[];
  private freeIndices: number[];

  constructor(capacity: number, factory: (id: number) => T) {
    const safeCap = Number.isFinite(capacity) ? Math.max(0, Math.floor(capacity)) : 0;
    this.items = new Array<T>(safeCap);
    this.activeIndices = [];
    this.freeIndices = new Array<number>(safeCap);

    for (let i = 0; i < safeCap; i++) {
      this.items[i] = factory(i);
      this.items[i].active = false;
      // Pop from end gives lowest index first
      this.freeIndices[i] = safeCap - 1 - i;
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
      this.items[this.activeIndices[i]].active = false;
    }
    this.activeIndices.length = 0;
    const cap = this.items.length;
    this.freeIndices.length = cap;
    for (let i = 0; i < cap; i++) {
      this.freeIndices[i] = cap - 1 - i;
    }
  }
}
