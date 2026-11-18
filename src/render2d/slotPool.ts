/**
 * Fixed-capacity slot allocator with counters (pure; the FX layers wrap Pixi sprites around the
 * slot indices). Nothing is allocated after construction; when full, `acquire` returns -1 and
 * counts a drop, so a burst of FX degrades by skipping the newest particles instead of growing.
 */
export class SlotPool {
  readonly capacity: number;
  private readonly free: Int32Array;
  private readonly positions: Int32Array;
  readonly activeSlots: Int32Array;
  private freeTop: number;
  /** Slots handed out so far (lifetime). */
  spawned = 0;
  /** Requests refused because the pool was full (lifetime). */
  dropped = 0;
  /** Highest number of simultaneously active slots. */
  peak = 0;
  active = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.free = new Int32Array(capacity);
    this.positions = new Int32Array(capacity).fill(-1);
    this.activeSlots = new Int32Array(capacity);
    this.freeTop = capacity;
    // Lowest index is handed out first.
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i;
  }

  acquire(limit = this.capacity): number {
    if (this.freeTop === 0 || this.active >= limit) {
      this.dropped++;
      return -1;
    }
    const i = this.free[--this.freeTop];
    this.positions[i] = this.active;
    this.activeSlots[this.active] = i;
    this.spawned++;
    this.active++;
    if (this.active > this.peak) this.peak = this.active;
    return i;
  }

  /** Returns a slot; releasing a slot that is not in use is a no-op (never double-frees). */
  release(i: number): void {
    if (!this.isUsed(i)) return;
    const last = this.activeSlots[this.active - 1];
    const pos = this.positions[i];
    this.activeSlots[pos] = last;
    this.positions[last] = pos;
    this.positions[i] = -1;
    this.free[this.freeTop++] = i;
    this.active--;
  }

  isUsed(i: number): boolean {
    return i >= 0 && i < this.capacity && this.positions[i] >= 0;
  }

  get freeCount(): number {
    return this.freeTop;
  }

  /** Frees every slot (a new run); lifetime counters keep counting. */
  releaseAll(): void {
    this.positions.fill(-1);
    this.freeTop = this.capacity;
    for (let i = 0; i < this.capacity; i++) this.free[i] = this.capacity - 1 - i;
    this.active = 0;
  }

  snapshot(): { capacity: number; active: number; peak: number; spawned: number; dropped: number } {
    return { capacity: this.capacity, active: this.active, peak: this.peak, spawned: this.spawned, dropped: this.dropped };
  }
}

/**
 * Allows at most `maxPerSec` events per second (token bucket on a caller-supplied clock, so it
 * works with the paused / sped-up sim time). Used for chatty events such as `shieldAbsorb`.
 */
export class RateCap {
  private tokens: number;
  private last = Number.NaN;
  allowed = 0;
  skipped = 0;
  private readonly maxPerSec: number;
  private readonly burst: number;

  constructor(maxPerSec: number, burst = maxPerSec) {
    this.maxPerSec = maxPerSec;
    this.burst = burst;
    this.tokens = burst;
  }

  tryTake(now: number): boolean {
    if (Number.isNaN(this.last)) this.last = now;
    const dt = Math.max(0, now - this.last);
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + dt * this.maxPerSec);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.allowed++;
      return true;
    }
    this.skipped++;
    return false;
  }
}
