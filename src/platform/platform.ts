/**
 * Platform abstraction for desktop (Steam / Electron) vs browser builds.
 *
 * Renderer code talks exclusively to `PlatformAdapter` (`getPlatform()`):
 *  - `isSteam`: true only when running inside the Electron shell with an initialised Steamworks client
 *  - `overlayActive`: live Steam Shift+Tab overlay state (false on web)
 *  - `achievements.unlock(id)`: unlocks a Steam achievement (safe async no-op on web / Steam offline)
 *  - `cloudSave.read/write(slot, json)`: Steam Remote Storage when `isSteam`, `localStorage` fallback otherwise
 *
 * Pure simulation layers (`src/sim`, `src/data`, `src/core`) must never import this module.
 */

export interface SteamBridge {
  readonly isSteam: boolean;
  readonly appId?: number;
  unlockAchievement(id: string): Promise<boolean>;
  cloudRead(slot: string): Promise<string | null>;
  cloudWrite(slot: string, json: string): Promise<boolean>;
  getOverlayActive?(): boolean;
  onOverlayChange?(listener: (active: boolean) => void): () => void;
}

export interface PlatformAchievements {
  unlock(id: string): Promise<boolean>;
}

export interface PlatformCloudSave {
  read(slot: string): Promise<string | null>;
  write(slot: string, json: string): Promise<boolean>;
}

export interface PlatformAdapter {
  readonly isSteam: boolean;
  readonly overlayActive: boolean;
  readonly achievements: PlatformAchievements;
  readonly cloudSave: PlatformCloudSave;
  /** Registers a callback for Steam overlay open/close transitions; returns an unsubscribe function. */
  onOverlayChange(listener: (active: boolean) => void): () => void;
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
  readonly storage?: CloudStorageLike | null;
}

export function createPlatformAdapter(options: CreatePlatformOptions = {}): PlatformAdapter {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const bridge = options.bridge === undefined ? detectSteamBridge() : (options.bridge ?? undefined);
  const steamActive = Boolean(bridge && bridge.isSteam === true);

  if (!steamActive || !bridge) {
    return {
      isSteam: false,
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
      onOverlayChange(): () => void {
        return () => undefined;
      },
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
        for (const fn of listeners) {
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

  return {
    get isSteam(): boolean {
      return true;
    },
    get overlayActive(): boolean {
      return overlayNow;
    },
    achievements: {
      async unlock(id: string): Promise<boolean> {
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
        try {
          const remote = await bridge.cloudRead(safe);
          if (typeof remote === 'string' && remote.length > 0) {
            writeLocalSlot(storage, safe, remote);
            return remote;
          }
        } catch {
          // fall back to local copy when Steam Remote Storage fails
        }
        return readLocalSlot(storage, safe);
      },
      async write(slot: string, json: string): Promise<boolean> {
        const safe = sanitizeCloudSlot(slot);
        if (!safe) return false;
        writeLocalSlot(storage, safe, json);
        try {
          return Boolean(await bridge.cloudWrite(safe, json));
        } catch {
          return false;
        }
      },
    },
    onOverlayChange(listener: (active: boolean) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
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
