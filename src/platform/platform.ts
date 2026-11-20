/**
 * Platform abstraction for desktop (Steam / Electron), mobile (Capacitor iOS / Android),
 * and standard browser builds.
 *
 * Renderer code talks exclusively to `PlatformAdapter` (`getPlatform()`):
 *  - `isSteam`: true only when running inside the Electron shell with an initialised Steamworks client
 *  - `isMobile`: true only when running inside the native Capacitor iOS or Android shell
 *  - `mobilePlatform`: `'ios' | 'android' | 'web'`
 *  - `overlayActive`: live Steam Shift+Tab overlay state (false on web / mobile)
 *  - `achievements.unlock(id)`: unlocks a Steam achievement (safe async no-op on web / mobile / Steam offline)
 *  - `cloudSave.read/write(slot, json)`: Steam Remote Storage when `isSteam`, `localStorage` fallback otherwise
 *  - `triggerHaptic(feedback)`: native Capacitor Haptics when `isMobile`, false otherwise
 *  - `onPause(cb)` / `onResume(cb)`: native app background / foreground lifecycle hooks
 *
 * Pure simulation layers (`src/sim`, `src/data`, `src/core`) must never import this module.
 */
import { Capacitor } from '@capacitor/core';

export interface SteamBridge {
  readonly isSteam: boolean;
  readonly appId?: number;
  unlockAchievement(id: string): Promise<boolean>;
  cloudRead(slot: string): Promise<string | null>;
  cloudWrite(slot: string, json: string): Promise<boolean>;
  getOverlayActive?(): boolean;
  onOverlayChange?(listener: (active: boolean) => void): () => void;
}

export type MobilePlatformName = 'ios' | 'android' | 'web';

export type NativeHapticFeedback =
  | { readonly type: 'impact'; readonly style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }
  | { readonly type: 'notification'; readonly style: 'SUCCESS' | 'WARNING' | 'ERROR' };

export interface MobileBridge {
  /** True only when running inside a native Capacitor iOS or Android container. */
  readonly isNative: boolean;
  readonly platform: MobilePlatformName;
  /** Triggers native Taptic Engine / Android haptic actuator feedback. */
  triggerHaptic(feedback: NativeHapticFeedback): Promise<boolean>;
  /**
   * Subscribes to native app active/background transitions (`App.addListener('appStateChange')`).
   * Calls `listener(false)` when paused/backgrounded and `listener(true)` when resumed/foregrounded.
   */
  onAppStateChange(listener: (isActive: boolean) => void): () => void;
}

export interface PlatformAchievements {
  unlock(id: string): Promise<boolean>;
}

export interface PlatformCloudSave {
  read(slot: string): Promise<string | null>;
  write(slot: string, json: string): Promise<boolean>;
  /** True when the most recent `read(slot)` fell back locally because the remote Steam Cloud read threw. */
  didLastReadFail?(slot: string): boolean;
}

export interface PlatformAdapter {
  readonly isSteam: boolean;
  /** True when running inside the Electron desktop shell (connected to Steam or standalone). */
  readonly isDesktop?: boolean;
  /** True when running inside the native Capacitor mobile wrapper (Android or iOS). */
  readonly isMobile: boolean;
  /** Underlying Capacitor platform identifier (`'ios'`, `'android'`, or `'web'`). */
  readonly mobilePlatform: MobilePlatformName;
  readonly overlayActive: boolean;
  readonly achievements: PlatformAchievements;
  readonly cloudSave: PlatformCloudSave;
  /** Triggers native mobile haptic feedback; returns false on non-mobile platforms. */
  triggerHaptic(feedback: NativeHapticFeedback): Promise<boolean>;
  /** Registers a callback for Steam overlay open/close transitions; returns an unsubscribe function. */
  onOverlayChange(listener: (active: boolean) => void): () => void;
  /**
   * Registers a callback invoked when the app is paused / sent to the background on mobile.
   * Returns an unsubscribe function.
   *
   * Game2D one-line hookup (for the `render2d` owner):
   *   `getPlatform().onPause(() => { game.stepper.paused = true; });`
   */
  onPause(listener: () => void): () => void;
  /** Registers a callback invoked when the mobile app returns to the foreground; returns an unsubscribe function. */
  onResume(listener: () => void): () => void;
}

export interface CloudStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

declare global {
  interface Window {
    skyholdSteam?: SteamBridge;
  }
}

const CLOUD_KEY_PREFIX = 'skyhold_isles_cloud_';
const LEGACY_PROGRESS_KEY = 'skyhold_isles_progress_v1';

/** Restricts slot identifiers to safe ASCII tokens (prevents path traversal and malformed keys). */
export function sanitizeCloudSlot(slot: string): string | null {
  if (typeof slot !== 'string') return null;
  const trimmed = slot.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

function defaultStorage(): CloudStorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function detectSteamBridge(): SteamBridge | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.skyholdSteam;
  } catch {
    return undefined;
  }
}

/** Builds the live Capacitor bridge when running inside a native iOS or Android container. */
function detectMobileBridge(): MobileBridge | undefined {
  try {
    if (!Capacitor.isNativePlatform()) return undefined;
    const rawPlatform = Capacitor.getPlatform();
    if (rawPlatform !== 'ios' && rawPlatform !== 'android') return undefined;

    // Best-effort immersive status-bar hide alongside the native Activity / Info.plist config.
    void import('@capacitor/status-bar')
      .then(({ StatusBar }) => StatusBar.hide())
      .catch(() => undefined);

    return {
      isNative: true,
      platform: rawPlatform,
      async triggerHaptic(feedback: NativeHapticFeedback): Promise<boolean> {
        try {
          const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
          if (feedback.type === 'impact') {
            const style =
              feedback.style === 'LIGHT'
                ? ImpactStyle.Light
                : feedback.style === 'MEDIUM'
                  ? ImpactStyle.Medium
                  : ImpactStyle.Heavy;
            await Haptics.impact({ style });
          } else {
            const type =
              feedback.style === 'SUCCESS'
                ? NotificationType.Success
                : feedback.style === 'WARNING'
                  ? NotificationType.Warning
                  : NotificationType.Error;
            await Haptics.notification({ type });
          }
          return true;
        } catch {
          return false;
        }
      },
      onAppStateChange(listener: (isActive: boolean) => void): () => void {
        let disposed = false;
        let removeHandle: (() => Promise<void>) | null = null;
        void import('@capacitor/app')
          .then(({ App }) =>
            App.addListener('appStateChange', (state) => {
              if (!disposed) listener(Boolean(state.isActive));
            }),
          )
          .then((handle) => {
            if (disposed) {
              void handle.remove().catch(() => undefined);
            } else {
              removeHandle = () => handle.remove();
            }
          })
          .catch(() => undefined);
        return () => {
          disposed = true;
          if (removeHandle) {
            void removeHandle().catch(() => undefined);
            removeHandle = null;
          }
        };
      },
    };
  } catch {
    return undefined;
  }
}

function readLocalSlot(storage: CloudStorageLike | null, safeSlot: string): string | null {
  if (!storage) return null;
  try {
    const direct = storage.getItem(CLOUD_KEY_PREFIX + safeSlot);
    if (direct !== null) return direct;
    if (safeSlot === 'progress') return storage.getItem(LEGACY_PROGRESS_KEY);
    return null;
  } catch {
    return null;
  }
}

function writeLocalSlot(storage: CloudStorageLike | null, safeSlot: string, json: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CLOUD_KEY_PREFIX + safeSlot, json);
    return true;
  } catch {
    return false;
  }
}

export interface CreatePlatformOptions {
  readonly bridge?: SteamBridge | null;
  readonly mobile?: MobileBridge | null;
  readonly storage?: CloudStorageLike | null;
}

export function createPlatformAdapter(options: CreatePlatformOptions = {}): PlatformAdapter {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const bridge = options.bridge === undefined ? detectSteamBridge() : (options.bridge ?? undefined);
  const steamActive = Boolean(bridge && bridge.isSteam === true);
  const desktopBundleHost =
    options.bridge === undefined &&
    options.mobile === undefined &&
    (() => {
      try {
        return typeof location !== 'undefined' && location.hostname === 'skyhold.local';
      } catch {
        return false;
      }
    })();
  const desktopActive = steamActive || Boolean(bridge) || desktopBundleHost;

  const mobileBridge = desktopActive
    ? undefined
    : options.mobile === undefined
      ? detectMobileBridge()
      : (options.mobile ?? undefined);
  const mobileActive = Boolean(
    mobileBridge &&
      mobileBridge.isNative === true &&
      (mobileBridge.platform === 'ios' || mobileBridge.platform === 'android'),
  );
  const mobilePlatform: MobilePlatformName =
    mobileActive && mobileBridge ? mobileBridge.platform : 'web';

  const pauseListeners = new Set<() => void>();
  const resumeListeners = new Set<() => void>();
  if (mobileActive && mobileBridge) {
    let appActive = true;
    try {
      mobileBridge.onAppStateChange((nextActive) => {
        const active = Boolean(nextActive);
        if (active === appActive) return;
        appActive = active;
        const targets = active ? resumeListeners : pauseListeners;
        for (const fn of [...targets]) {
          if (!targets.has(fn)) continue;
          try {
            fn();
          } catch {
            // listener errors must never break the lifecycle bridge
          }
        }
      });
    } catch {
      // ignore lifecycle subscription errors
    }
  }

  const triggerHaptic = async (feedback: NativeHapticFeedback): Promise<boolean> => {
    if (!mobileActive || !mobileBridge) return false;
    try {
      return Boolean(await mobileBridge.triggerHaptic(feedback));
    } catch {
      return false;
    }
  };

  const onPause = (listener: () => void): (() => void) => {
    if (!mobileActive) return () => undefined;
    pauseListeners.add(listener);
    return () => {
      pauseListeners.delete(listener);
    };
  };

  const onResume = (listener: () => void): (() => void) => {
    if (!mobileActive) return () => undefined;
    resumeListeners.add(listener);
    return () => {
      resumeListeners.delete(listener);
    };
  };

  if (!steamActive || !bridge) {
    return {
      isSteam: false,
      isDesktop: desktopActive,
      isMobile: mobileActive,
      mobilePlatform,
      overlayActive: false,
      achievements: {
        async unlock(): Promise<boolean> {
          return false;
        },
      },
      cloudSave: {
        async read(slot: string): Promise<string | null> {
          const safe = sanitizeCloudSlot(slot);
          if (!safe) return null;
          return readLocalSlot(storage, safe);
        },
        async write(slot: string, json: string): Promise<boolean> {
          const safe = sanitizeCloudSlot(slot);
          if (!safe) return false;
          return writeLocalSlot(storage, safe, json);
        },
      },
      triggerHaptic,
      onOverlayChange(): () => void {
        return () => undefined;
      },
      onPause,
      onResume,
    };
  }

  let overlayNow = false;
  try {
    overlayNow = Boolean(bridge.getOverlayActive?.());
  } catch {
    overlayNow = false;
  }
  const listeners = new Set<(active: boolean) => void>();
  if (typeof bridge.onOverlayChange === 'function') {
    try {
      bridge.onOverlayChange((active) => {
        const next = Boolean(active);
        if (next === overlayNow) return;
        overlayNow = next;
        for (const fn of [...listeners]) {
          if (!listeners.has(fn)) continue;
          try {
            fn(overlayNow);
          } catch {
            // listener errors must never break the bridge
          }
        }
      });
    } catch {
      // ignore bridge subscription errors
    }
  }

  const unlockedInSession = new Set<string>();
  const writeSeqBySlot = new Map<string, number>();
  const lastReadFailedBySlot = new Map<string, boolean>();

  return {
    get isSteam(): boolean {
      return true;
    },
    get isDesktop(): boolean {
      return true;
    },
    get isMobile(): boolean {
      return false;
    },
    get mobilePlatform(): MobilePlatformName {
      return 'web';
    },
    get overlayActive(): boolean {
      return overlayNow;
    },
    achievements: {
      async unlock(id: string): Promise<boolean> {
        if (typeof id !== 'string') return false;
        const clean = id.trim();
        if (!clean || clean.length > 64) return false;
        if (unlockedInSession.has(clean)) return true;
        try {
          const ok = await bridge.unlockAchievement(clean);
          if (ok) unlockedInSession.add(clean);
          return Boolean(ok);
        } catch {
          return false;
        }
      },
    },
    cloudSave: {
      async read(slot: string): Promise<string | null> {
        const safe = sanitizeCloudSlot(slot);
        if (!safe) return null;
        const seqAtStart = writeSeqBySlot.get(safe) ?? 0;
        try {
          const remote = await bridge.cloudRead(safe);
          lastReadFailedBySlot.set(safe, false);
          if (typeof remote === 'string' && remote.length > 0) {
            if ((writeSeqBySlot.get(safe) ?? 0) === seqAtStart) {
              writeLocalSlot(storage, safe, remote);
            }
            return remote;
          }
        } catch {
          // fall back to local copy when Steam Remote Storage fails
          lastReadFailedBySlot.set(safe, true);
        }
        return readLocalSlot(storage, safe);
      },
      async write(slot: string, json: string): Promise<boolean> {
        const safe = sanitizeCloudSlot(slot);
        if (!safe) return false;
        writeSeqBySlot.set(safe, (writeSeqBySlot.get(safe) ?? 0) + 1);
        writeLocalSlot(storage, safe, json);
        try {
          return Boolean(await bridge.cloudWrite(safe, json));
        } catch {
          return false;
        }
      },
      didLastReadFail(slot: string): boolean {
        const safe = sanitizeCloudSlot(slot);
        return safe !== null && lastReadFailedBySlot.get(safe) === true;
      },
    },
    triggerHaptic,
    onOverlayChange(listener: (active: boolean) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onPause,
    onResume,
  };
}

let activePlatform: PlatformAdapter | null = null;

/** Process-wide platform adapter (lazily initialised so tests can inject globals or overrides). */
export function getPlatform(): PlatformAdapter {
  if (!activePlatform) activePlatform = createPlatformAdapter();
  return activePlatform;
}

/** Replaces or resets (`null`) the singleton platform adapter (for unit tests). */
export function setPlatformAdapter(adapter: PlatformAdapter | null): void {
  activePlatform = adapter;
}
