import type { EventBus } from '../core/eventBus.ts';

/**
 * Vibration feedback (navigator.vibrate) for touch play. Silent where the API is missing (iOS
 * Safari, desktop) or when the player turned Haptics off in Settings.
 */
export type HapticKind =
  | 'tap'
  | 'place'
  | 'upgrade'
  | 'sell'
  | 'leak'
  | 'wave'
  | 'longPress'
  | 'win'
  | 'lose';

export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  place: 18,
  upgrade: [12, 40, 22],
  sell: 12,
  leak: 30,
  wave: 14,
  longPress: 20,
  win: [20, 60, 20, 60, 40],
  lose: [60, 50, 90],
};

/** Minimum gap (ms) between two pulses of the same kind, so event storms do not buzz constantly. */
const MIN_GAP_MS: Record<HapticKind, number> = {
  tap: 40,
  place: 80,
  upgrade: 80,
  sell: 80,
  leak: 500,
  wave: 300,
  longPress: 200,
  win: 1000,
  lose: 1000,
};

type VibrateFn = (pattern: number | number[]) => boolean;

export class Haptics {
  private enabled = true;
  private readonly lastAt = new Map<HapticKind, number>();
  private readonly vibrateFn: VibrateFn | null;
  private readonly now: () => number;

  constructor(vibrateFn: VibrateFn | null, now: () => number = () => performance.now()) {
    this.vibrateFn = vibrateFn;
    this.now = now;
  }

  get supported(): boolean {
    return this.vibrateFn !== null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  pulse(kind: HapticKind): boolean {
    if (!this.enabled || !this.vibrateFn) return false;
    const t = this.now();
    const prev = this.lastAt.get(kind);
    if (prev !== undefined && t - prev < MIN_GAP_MS[kind]) return false;
    this.lastAt.set(kind, t);
    try {
      return this.vibrateFn(HAPTIC_PATTERNS[kind]);
    } catch {
      return false;
    }
  }
}

function browserVibrate(): VibrateFn | null {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
  return (p) => navigator.vibrate(p);
}

/** Shared instance used by the game session and the input layer. */
export const haptics = new Haptics(browserVibrate());

/** Subscribes to sim events that deserve a buzz. Returns an unsubscribe function. */
export function bindHaptics(bus: EventBus, h: Haptics = haptics): () => void {
  const unsubs = [
    bus.on('towerBuilt', () => h.pulse('place')),
    bus.on('towerUpgraded', () => h.pulse('upgrade')),
    bus.on('towerSold', () => h.pulse('sell')),
    bus.on('enemyLeaked', () => h.pulse('leak')),
    bus.on('waveStarted', () => h.pulse('wave')),
    bus.on('gameWon', () => h.pulse('win')),
    bus.on('gameLost', () => h.pulse('lose')),
  ];
  return () => {
    for (let i = 0; i < unsubs.length; i++) unsubs[i]();
  };
}
