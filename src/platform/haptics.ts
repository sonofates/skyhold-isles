import type { EventBus } from '../core/eventBus.ts';
import { getPlatform, type NativeHapticFeedback, type PlatformAdapter } from './platform.ts';

/**
 * Vibration & native haptic feedback for touch / mobile play.
 *
 * When running inside the native Capacitor shell (`platform.isMobile === true`), pulses route
 * through `platform.triggerHaptic(...)` (Capacitor Haptics Taptic Engine / Android actuator).
 * On browser builds, pulses fall back to `navigator.vibrate(...)` where supported, and remain
 * silent where missing (desktop, iOS Safari) or when the player turned Haptics off in Settings.
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

/** Native Capacitor Haptics mapping per gameplay event kind. */
export const NATIVE_HAPTIC_MAP: Record<HapticKind, NativeHapticFeedback> = {
  tap: { type: 'impact', style: 'LIGHT' },
  wave: { type: 'impact', style: 'LIGHT' },
  sell: { type: 'impact', style: 'LIGHT' },
  place: { type: 'impact', style: 'MEDIUM' },
  longPress: { type: 'impact', style: 'MEDIUM' },
  upgrade: { type: 'notification', style: 'SUCCESS' },
  leak: { type: 'impact', style: 'HEAVY' },
  win: { type: 'notification', style: 'SUCCESS' },
  lose: { type: 'notification', style: 'ERROR' },
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

export interface HapticDriver {
  readonly isSupported: () => boolean;
  readonly trigger: (kind: HapticKind) => boolean;
}

function browserVibrate(): VibrateFn | null {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
  return (p) => navigator.vibrate(p);
}

/** Creates a driver that routes through `PlatformAdapter` when native and `navigator.vibrate` on web. */
export function createPlatformHapticDriver(
  resolvePlatform: () => PlatformAdapter = getPlatform,
  resolveBrowserVibrate: () => VibrateFn | null = browserVibrate,
): HapticDriver {
  return {
    isSupported(): boolean {
      if (resolvePlatform().isMobile) return true;
      return resolveBrowserVibrate() !== null;
    },
    trigger(kind: HapticKind): boolean {
      const platform = resolvePlatform();
      if (platform.isMobile) {
        void platform.triggerHaptic(NATIVE_HAPTIC_MAP[kind]);
        return true;
      }
      const vib = resolveBrowserVibrate();
      if (!vib) return false;
      return vib(HAPTIC_PATTERNS[kind]);
    },
  };
}

export class Haptics {
  private enabled = true;
  private readonly lastAt = new Map<HapticKind, number>();
  private readonly driver: HapticDriver;
  private readonly now: () => number;

  constructor(
    vibrateOrDriver: VibrateFn | HapticDriver | null,
    now: () => number = () => performance.now(),
  ) {
    if (vibrateOrDriver === null) {
      this.driver = { isSupported: () => false, trigger: () => false };
    } else if (typeof vibrateOrDriver === 'function') {
      const fn = vibrateOrDriver;
      this.driver = {
        isSupported: () => true,
        trigger: (kind) => fn(HAPTIC_PATTERNS[kind]),
      };
    } else {
      this.driver = vibrateOrDriver;
    }
    this.now = now;
  }

  get supported(): boolean {
    return this.driver.isSupported();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  pulse(kind: HapticKind): boolean {
    if (!this.enabled || !this.driver.isSupported()) return false;
    const t = this.now();
    const prev = this.lastAt.get(kind);
    if (prev !== undefined && t - prev < MIN_GAP_MS[kind]) return false;
    this.lastAt.set(kind, t);
    try {
      return this.driver.trigger(kind);
    } catch {
      return false;
    }
  }
}

/** Shared instance used by the 2D game, 3D game session, and input layer. */
export const haptics = new Haptics(createPlatformHapticDriver());

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
