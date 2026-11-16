import type { QualityLevel } from '../core/types.ts';

export type QualityTier = 0 | 1 | 2 | 3 | 4 | 5;
export type N8aoMode = 'off' | 'half' | 'full';

export interface QualityPreset {
  readonly tier: QualityTier;
  readonly label: string;
  readonly desktopDprCap: number;
  readonly desktopDprScale: number;
  readonly touchDprCap: number;
  readonly shadows: boolean;
  readonly composer: boolean;
  readonly n8ao: N8aoMode;
  readonly outline: boolean;
  readonly bloom: boolean;
  readonly smaa: boolean;
  readonly decorLow: boolean;
}

export interface StartupTimingMetrics {
  readonly assetsMs: number;
  readonly sceneSetupMs: number;
  readonly warmupMs: number;
  readonly timeToMenuMs: number;
}

export interface TierTransition {
  readonly fromTier: QualityTier;
  readonly toTier: QualityTier;
  readonly direction: 'down' | 'up';
  readonly reason: string;
  readonly avgMs: number;
  readonly p95Ms: number;
}

export interface FrameStatsSnapshot {
  readonly sampleCount: number;
  readonly avgMs: number;
  readonly p95Ms: number;
  readonly fps: number;
}

/**
 * Quality tiers ordered from lowest GPU cost (0) to full desktop fidelity (5).
 * Desktop Auto starts at Tier 5 (preserving original desktop visuals);
 * Touch Auto starts at Tier 4 (half-res N8AO, capped DPR <= 1.5, no SMAA).
 */
export const QUALITY_PRESETS: readonly QualityPreset[] = [
  {
    tier: 0,
    label: 'Low',
    desktopDprCap: 1.0,
    desktopDprScale: 0.8,
    touchDprCap: 0.85,
    shadows: false,
    composer: false,
    n8ao: 'off',
    outline: false,
    bloom: false,
    smaa: false,
    decorLow: true,
  },
  {
    tier: 1,
    label: 'Direct+Sh',
    desktopDprCap: 1.25,
    desktopDprScale: 0.85,
    touchDprCap: 1.0,
    shadows: true,
    composer: false,
    n8ao: 'off',
    outline: false,
    bloom: false,
    smaa: false,
    decorLow: false,
  },
  {
    tier: 2,
    label: 'Lite',
    desktopDprCap: 1.4,
    desktopDprScale: 0.9,
    touchDprCap: 1.15,
    shadows: true,
    composer: true,
    n8ao: 'off',
    outline: true,
    bloom: false,
    smaa: false,
    decorLow: false,
  },
  {
    tier: 3,
    label: 'Medium',
    desktopDprCap: 1.5,
    desktopDprScale: 1.0,
    touchDprCap: 1.35,
    shadows: true,
    composer: true,
    n8ao: 'off',
    outline: true,
    bloom: true,
    smaa: false,
    decorLow: false,
  },
  {
    tier: 4,
    label: 'High-Bal',
    desktopDprCap: 1.75,
    desktopDprScale: 1.0,
    touchDprCap: 1.5,
    shadows: true,
    composer: true,
    n8ao: 'half',
    outline: true,
    bloom: true,
    smaa: false,
    decorLow: false,
  },
  {
    tier: 5,
    label: 'Ultra',
    desktopDprCap: 2.0,
    desktopDprScale: 1.0,
    touchDprCap: 2.0,
    shadows: true,
    composer: true,
    n8ao: 'full',
    outline: true,
    bloom: true,
    smaa: true,
    decorLow: false,
  },
] as const;

export const GOVERNOR_THRESHOLDS = {
  windowSize: 90,
  minSamples: 20,
  evalIntervalSec: 0.5,
  warmupSec: 1.2,
  maxValidFrameMs: 250,
  mildDowngradeAvgMs: 21.0,
  mildDowngradeP95Ms: 26.5,
  mildDowngradeHoldSec: 2.0,
  severeDowngradeAvgMs: 32.0,
  severeDowngradeP95Ms: 42.0,
  severeDowngradeHoldSec: 1.0,
  doubleStepAvgMs: 36.0,
  downgradeCooldownSec: 2.0,
  upgradeMaxAvgMs: 17.6,
  upgradeMaxP95Ms: 20.0,
  baseUpgradeHoldSec: 12.0,
  maxUpgradeHoldSec: 48.0,
  bounceWindowSec: 25.0,
  maxBouncesBeforeLock: 2,
} as const;

/**
 * Computes the effective devicePixelRatio for a quality mode, tier, and device class.
 * Touch devices are capped at <= 2.0 and scale down further under GPU pressure.
 */
export function computeTargetDpr(
  nativeDpr: number,
  tier: QualityTier,
  isTouch: boolean,
  mode: QualityLevel,
): number {
  const safeNative = Number.isFinite(nativeDpr) && nativeDpr > 0 ? nativeDpr : 1;
  let raw: number;
  if (mode === 'high') {
    raw = Math.min(safeNative, 2);
  } else if (mode === 'low') {
    raw = Math.min(safeNative, 1);
  } else {
    const preset = QUALITY_PRESETS[tier];
    if (isTouch) {
      raw = Math.min(safeNative, preset.touchDprCap);
    } else {
      raw = Math.min(safeNative * preset.desktopDprScale, preset.desktopDprCap);
    }
  }
  return Math.max(0.5, Math.round(raw * 100) / 100);
}

/**
 * Computes the 95th percentile from the first `count` elements of `values` using
 * a caller-provided scratch TypedArray so hot loops allocate zero heap memory.
 */
export function computeP95(
  values: Float64Array,
  count: number,
  scratch: Float64Array,
): number {
  const n = Math.min(count, values.length, scratch.length);
  if (n <= 0) return 0;
  for (let i = 0; i < n; i++) {
    scratch[i] = values[i];
  }
  const slice = scratch.subarray(0, n);
  slice.sort();
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(n * 0.95) - 1));
  return slice[idx];
}

/**
 * Fixed-capacity, allocation-free rolling window of frame timings (ms).
 */
export class RollingFrameMetrics {
  readonly capacity: number;
  private readonly buffer: Float64Array;
  private readonly scratch: Float64Array;
  private head = 0;
  private count = 0;
  private sum = 0;
  private cachedP95 = 0;
  private p95Dirty = false;

  constructor(capacity = GOVERNOR_THRESHOLDS.windowSize) {
    this.capacity = Math.max(1, capacity);
    this.buffer = new Float64Array(this.capacity);
    this.scratch = new Float64Array(this.capacity);
  }

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    if (this.count === this.capacity) {
      this.sum -= this.buffer[this.head];
    } else {
      this.count++;
    }
    this.buffer[this.head] = ms;
    this.sum += ms;
    this.head = (this.head + 1) % this.capacity;
    this.p95Dirty = true;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.sum = 0;
    this.cachedP95 = 0;
    this.p95Dirty = false;
  }

  getSnapshot(): FrameStatsSnapshot {
    if (this.count === 0) {
      return { sampleCount: 0, avgMs: 0, p95Ms: 0, fps: 0 };
    }
    const avgMs = this.sum / this.count;
    if (this.p95Dirty) {
      this.cachedP95 = computeP95(this.buffer, this.count, this.scratch);
      this.p95Dirty = false;
    }
    const fps = avgMs > 0 ? 1000 / avgMs : 0;
    return {
      sampleCount: this.count,
      avgMs,
      p95Ms: this.cachedP95,
      fps,
    };
  }
}

/**
 * Pure adaptive quality state machine with asymmetric hysteresis and bounce lock
 * so mid-range phones scale down smoothly under load without ever flip-flopping.
 */
export class PerfGovernor {
  private mode: QualityLevel;
  private isTouch: boolean;
  private tier: QualityTier;
  private lockedCeilingTier: QualityTier;
  private readonly rolling = new RollingFrameMetrics(GOVERNOR_THRESHOLDS.windowSize);

  private warmupRemainingSec: number = GOVERNOR_THRESHOLDS.warmupSec;
  private evalAccumSec = 0;
  private slowAccumSec = 0;
  private fastAccumSec = 0;
  private clockSec = 0;
  private lastChangeSec = -Infinity;
  private lastUpgradeSec = -Infinity;
  private lastUpgradeToTier: QualityTier | null = null;
  private upgradeHoldSec: number = GOVERNOR_THRESHOLDS.baseUpgradeHoldSec;
  private readonly bounceCounts = new Int32Array(QUALITY_PRESETS.length);

  constructor(options?: { mode?: QualityLevel; isTouch?: boolean }) {
    this.mode = options?.mode ?? 'auto';
    this.isTouch = options?.isTouch ?? false;
    this.lockedCeilingTier = this.getDefaultMaxTier();
    this.tier = this.getInitialTierForMode();
  }

  private getDefaultMaxTier(): QualityTier {
    return this.isTouch ? 4 : 5;
  }

  private getInitialTierForMode(): QualityTier {
    if (this.mode === 'high') return 5;
    if (this.mode === 'low') return 0;
    return this.getDefaultMaxTier();
  }

  getMode(): QualityLevel {
    return this.mode;
  }

  getTier(): QualityTier {
    return this.tier;
  }

  getPreset(): QualityPreset {
    return QUALITY_PRESETS[this.tier];
  }

  getLockedCeilingTier(): QualityTier {
    return this.lockedCeilingTier;
  }

  getStats(): FrameStatsSnapshot {
    return this.rolling.getSnapshot();
  }

  setMode(mode: QualityLevel): boolean {
    const prevTier = this.tier;
    const prevMode = this.mode;
    this.mode = mode;
    this.bounceCounts.fill(0);
    this.upgradeHoldSec = GOVERNOR_THRESHOLDS.baseUpgradeHoldSec;
    this.lockedCeilingTier = this.getDefaultMaxTier();
    this.lastUpgradeToTier = null;
    this.lastUpgradeSec = -Infinity;
    this.tier = this.getInitialTierForMode();
    this.resetWarmup();
    return prevTier !== this.tier || prevMode !== this.mode;
  }

  setTouch(isTouch: boolean): boolean {
    if (this.isTouch === isTouch) return false;
    this.isTouch = isTouch;
    const maxTier = this.getDefaultMaxTier();
    if (this.lockedCeilingTier > maxTier) {
      this.lockedCeilingTier = maxTier;
    }
    const prevTier = this.tier;
    if (this.mode === 'auto' && this.tier > this.lockedCeilingTier) {
      this.tier = this.lockedCeilingTier;
    }
    this.resetWarmup();
    return prevTier !== this.tier;
  }

  resetWarmup(durationSec: number = GOVERNOR_THRESHOLDS.warmupSec): void {
    this.warmupRemainingSec = Math.max(0, durationSec);
    this.evalAccumSec = 0;
    this.slowAccumSec = 0;
    this.fastAccumSec = 0;
    this.rolling.reset();
  }

  recordFrame(
    frameDtMs: number,
    options?: { throttled?: boolean; hidden?: boolean },
  ): TierTransition | null {
    if (options?.hidden || options?.throttled) {
      return null;
    }
    if (!Number.isFinite(frameDtMs) || frameDtMs <= 0 || frameDtMs > GOVERNOR_THRESHOLDS.maxValidFrameMs) {
      return null;
    }

    const dtSec = frameDtMs / 1000;
    this.clockSec += dtSec;

    if (this.warmupRemainingSec > 0) {
      this.warmupRemainingSec = Math.max(0, this.warmupRemainingSec - dtSec);
      return null;
    }

    this.rolling.record(frameDtMs);
    if (this.mode !== 'auto') {
      return null;
    }

    this.evalAccumSec += dtSec;
    if (this.evalAccumSec < GOVERNOR_THRESHOLDS.evalIntervalSec) {
      return null;
    }
    const evalDt = this.evalAccumSec;
    this.evalAccumSec = 0;

    const stats = this.rolling.getSnapshot();
    if (stats.sampleCount < GOVERNOR_THRESHOLDS.minSamples) {
      return null;
    }

    const severeSlow =
      stats.avgMs >= GOVERNOR_THRESHOLDS.severeDowngradeAvgMs ||
      stats.p95Ms >= GOVERNOR_THRESHOLDS.severeDowngradeP95Ms;
    const mildSlow =
      stats.avgMs >= GOVERNOR_THRESHOLDS.mildDowngradeAvgMs ||
      stats.p95Ms >= GOVERNOR_THRESHOLDS.mildDowngradeP95Ms;
    const clearlyFast =
      stats.avgMs <= GOVERNOR_THRESHOLDS.upgradeMaxAvgMs &&
      stats.p95Ms <= GOVERNOR_THRESHOLDS.upgradeMaxP95Ms;

    if (severeSlow || mildSlow) {
      this.slowAccumSec += evalDt;
      this.fastAccumSec = 0;

      const canDowngrade =
        this.tier > 0 &&
        this.clockSec - this.lastChangeSec >= GOVERNOR_THRESHOLDS.downgradeCooldownSec &&
        ((severeSlow && this.slowAccumSec >= GOVERNOR_THRESHOLDS.severeDowngradeHoldSec) ||
          (mildSlow && this.slowAccumSec >= GOVERNOR_THRESHOLDS.mildDowngradeHoldSec));

      if (canDowngrade) {
        const step =
          severeSlow && stats.avgMs >= GOVERNOR_THRESHOLDS.doubleStepAvgMs && this.tier >= 2 ? 2 : 1;
        const nextTier = Math.max(0, this.tier - step) as QualityTier;
        return this.applyDowngrade(nextTier, severeSlow ? 'severe_frame_time' : 'sustained_slow', stats);
      }
      return null;
    }

    // Decaying slowAccumSec gently prevents brief single-wave bursts from losing state,
    // while clearly fast frames allow gradual recovery after the hold window.
    this.slowAccumSec = Math.max(0, this.slowAccumSec - evalDt * 0.5);

    if (clearlyFast && this.tier < this.lockedCeilingTier) {
      this.fastAccumSec += evalDt;
      if (this.fastAccumSec >= this.upgradeHoldSec) {
        const nextTier = Math.min(this.lockedCeilingTier, this.tier + 1) as QualityTier;
        if (nextTier > this.tier) {
          return this.applyUpgrade(nextTier, stats);
        }
      }
    } else {
      this.fastAccumSec = 0;
    }

    return null;
  }

  private applyDowngrade(
    nextTier: QualityTier,
    reason: string,
    stats: FrameStatsSnapshot,
  ): TierTransition {
    const prevTier = this.tier;
    if (
      this.lastUpgradeToTier !== null &&
      this.clockSec - this.lastUpgradeSec <= GOVERNOR_THRESHOLDS.bounceWindowSec
    ) {
      const bouncedFrom = this.lastUpgradeToTier;
      this.bounceCounts[bouncedFrom]++;
      this.upgradeHoldSec = Math.min(
        GOVERNOR_THRESHOLDS.maxUpgradeHoldSec,
        this.upgradeHoldSec * 2,
      );
      if (this.bounceCounts[bouncedFrom] >= GOVERNOR_THRESHOLDS.maxBouncesBeforeLock) {
        this.lockedCeilingTier = Math.min(this.lockedCeilingTier, Math.max(0, bouncedFrom - 1)) as QualityTier;
      }
      this.lastUpgradeToTier = null;
    }

    this.tier = nextTier;
    this.lastChangeSec = this.clockSec;
    this.resetWarmup();
    return {
      fromTier: prevTier,
      toTier: nextTier,
      direction: 'down',
      reason,
      avgMs: stats.avgMs,
      p95Ms: stats.p95Ms,
    };
  }

  private applyUpgrade(nextTier: QualityTier, stats: FrameStatsSnapshot): TierTransition {
    const prevTier = this.tier;
    this.tier = nextTier;
    this.lastChangeSec = this.clockSec;
    this.lastUpgradeSec = this.clockSec;
    this.lastUpgradeToTier = nextTier;
    this.resetWarmup();
    return {
      fromTier: prevTier,
      toTier: nextTier,
      direction: 'up',
      reason: 'sustained_headroom',
      avgMs: stats.avgMs,
      p95Ms: stats.p95Ms,
    };
  }
}
