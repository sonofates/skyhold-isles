/**
 * Rolling frame statistics for the bench route (pure; fixed-size ring buffer, no per-frame
 * allocation). `record(ms, nowMs)` once per frame; `snapshot()` is computed on demand.
 */
export interface FrameStatsSnapshot {
  /** Frames per second over the last `windowMs` (default 5 s). */
  readonly fps: number;
  readonly p50: number;
  readonly p95: number;
  readonly samples: number;
}

export class FrameStats {
  private readonly times: Float64Array;
  private readonly deltas: Float64Array;
  private readonly scratch: Float64Array;
  private head = 0;
  private count = 0;

  private readonly windowMs: number;

  constructor(capacity = 1200, windowMs = 5000) {
    this.windowMs = windowMs;
    this.times = new Float64Array(capacity);
    this.deltas = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  record(frameMs: number, nowMs: number): void {
    this.times[this.head] = nowMs;
    this.deltas[this.head] = frameMs;
    this.head = (this.head + 1) % this.times.length;
    if (this.count < this.times.length) this.count++;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
  }

  snapshot(nowMs: number): FrameStatsSnapshot {
    const cap = this.times.length;
    let n = 0;
    let oldest = nowMs;
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - 1 - i + cap) % cap;
      const t = this.times[idx];
      if (nowMs - t > this.windowMs) break;
      this.scratch[n++] = this.deltas[idx];
      oldest = t;
    }
    if (n === 0) return { fps: 0, p50: 0, p95: 0, samples: 0 };
    const span = Math.max(1, nowMs - oldest + this.scratch[n - 1]);
    const sorted = this.scratch.subarray(0, n).sort();
    const pick = (q: number): number => sorted[Math.min(n - 1, Math.floor(q * (n - 1) + 0.5))];
    return { fps: (n * 1000) / span, p50: pick(0.5), p95: pick(0.95), samples: n };
  }
}
