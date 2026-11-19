import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { challengesForLevel } from '../../src/data/challenges.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import {
  createPlatformAdapter,
  earnedSteamAchievementIds,
  exportAchievementManifest,
  hydrateProgressFromCloud,
  sanitizeCloudSlot,
  setPlatformAdapter,
  STEAM_ACHIEVEMENTS,
  syncAchievementsFromProgress,
  type CloudStorageLike,
  type SteamAchievementMeta,
  type SteamBridge,
} from '../../src/platform/index.ts';
import { createDefaultProgress, saveProgress } from '../../src/platform/storage.ts';

const ROOT = resolve(import.meta.dirname, '../..');

function createMemStorage(): CloudStorageLike & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('platform adapter: web fallback & Steam offline fallback', () => {
  it('web fallback reports isSteam=false, overlayActive=false, no-op achievements, and localStorage cloud save', async () => {
    const storage = createMemStorage();
    const adapter = createPlatformAdapter({ bridge: null, storage });

    expect(adapter.isSteam).toBe(false);
    expect(adapter.overlayActive).toBe(false);
    expect(await adapter.achievements.unlock('FEAT_FIRST_LANDING')).toBe(false);

    expect(await adapter.cloudSave.read('progress')).toBeNull();
    expect(await adapter.cloudSave.write('progress', '{"version":2,"ok":true}')).toBe(true);
    expect(await adapter.cloudSave.read('progress')).toBe('{"version":2,"ok":true}');

    // Rejects unsafe slot names (path traversal / invalid chars).
    expect(sanitizeCloudSlot('../etc/passwd')).toBeNull();
    expect(sanitizeCloudSlot('')).toBeNull();
    expect(await adapter.cloudSave.write('../bad', '{}')).toBe(false);
    expect(await adapter.cloudSave.read('../bad')).toBeNull();
  });

  it('Electron bridge with Steam not running (bridge.isSteam=false) falls back cleanly without calling IPC', async () => {
    const storage = createMemStorage();
    const bridge: SteamBridge = {
      isSteam: false,
      unlockAchievement: vi.fn(async () => true),
      cloudRead: vi.fn(async () => 'should-not-read'),
      cloudWrite: vi.fn(async () => true),
    };
    const adapter = createPlatformAdapter({ bridge, storage });

    expect(adapter.isSteam).toBe(false);
    expect(adapter.overlayActive).toBe(false);
    expect(await adapter.achievements.unlock('FEAT_FIRST_LANDING')).toBe(false);
    expect(bridge.unlockAchievement).not.toHaveBeenCalled();

    expect(await adapter.cloudSave.write('progress', '{"v":2}')).toBe(true);
    expect(bridge.cloudWrite).not.toHaveBeenCalled();
    expect(await adapter.cloudSave.read('progress')).toBe('{"v":2}');
    expect(bridge.cloudRead).not.toHaveBeenCalled();
  });

  it('survives missing or throwing storage in private/restricted environments', async () => {
    const brokenStorage: CloudStorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const adapter = createPlatformAdapter({ bridge: null, storage: brokenStorage });
    expect(await adapter.cloudSave.read('progress')).toBeNull();
    expect(await adapter.cloudSave.write('progress', '{}')).toBe(false);
  });
});

describe('platform adapter: mocked Steam bridge', () => {
  it('routes achievement unlocks (with in-session deduplication and retry on failure)', async () => {
    const calls: string[] = [];
    let shouldSucceed = false;
    const bridge: SteamBridge = {
      isSteam: true,
      appId: 480,
      unlockAchievement: async (id) => {
        calls.push(id);
        return shouldSucceed;
      },
      cloudRead: async () => null,
      cloudWrite: async () => true,
    };
    const adapter = createPlatformAdapter({ bridge, storage: createMemStorage() });
    expect(adapter.isSteam).toBe(true);

    // First attempt fails → not cached, so a subsequent call retries.
    expect(await adapter.achievements.unlock('FEAT_FIRST_LANDING')).toBe(false);
    shouldSucceed = true;
    expect(await adapter.achievements.unlock('FEAT_FIRST_LANDING')).toBe(true);
    // Third call hits the session cache without invoking IPC again.
    expect(await adapter.achievements.unlock('FEAT_FIRST_LANDING')).toBe(true);
    expect(calls).toEqual(['FEAT_FIRST_LANDING', 'FEAT_FIRST_LANDING']);

    // Empty / oversized IDs are rejected before IPC.
    expect(await adapter.achievements.unlock('   ')).toBe(false);
    expect(await adapter.achievements.unlock('X'.repeat(80))).toBe(false);
  });

  it('reads and writes Steam Cloud saves, mirroring locally and falling back if remote fails', async () => {
    const storage = createMemStorage();
    const remoteFiles = new Map<string, string>();
    let remoteOnline = true;
    const bridge: SteamBridge = {
      isSteam: true,
      unlockAchievement: async () => true,
      cloudRead: async (slot) => {
        if (!remoteOnline) throw new Error('Steam Cloud offline');
        return remoteFiles.get(slot) ?? null;
      },
      cloudWrite: async (slot, json) => {
        if (!remoteOnline) throw new Error('Steam Cloud offline');
        remoteFiles.set(slot, json);
        return true;
      },
    };
    const adapter = createPlatformAdapter({ bridge, storage });

    expect(await adapter.cloudSave.write('progress', '{"stars":12}')).toBe(true);
    expect(remoteFiles.get('progress')).toBe('{"stars":12}');
    expect(await adapter.cloudSave.read('progress')).toBe('{"stars":12}');

    // Remote outage still returns the mirrored local copy.
    remoteOnline = false;
    expect(await adapter.cloudSave.read('progress')).toBe('{"stars":12}');
    expect(await adapter.cloudSave.write('progress', '{"stars":15}')).toBe(false);
    expect(await adapter.cloudSave.read('progress')).toBe('{"stars":15}');
  });

  it('tracks Steam overlay activation state and notifies subscribers', () => {
    let emitOverlay: ((active: boolean) => void) | null = null;
    const bridge: SteamBridge = {
      isSteam: true,
      unlockAchievement: async () => true,
      cloudRead: async () => null,
      cloudWrite: async () => true,
      getOverlayActive: () => false,
      onOverlayChange: (cb) => {
        emitOverlay = cb;
        return () => {
          emitOverlay = null;
        };
      },
    };
    const adapter = createPlatformAdapter({ bridge, storage: createMemStorage() });
    const events: boolean[] = [];
    const off = adapter.onOverlayChange((active) => events.push(active));

    expect(adapter.overlayActive).toBe(false);
    emitOverlay!(true);
    expect(adapter.overlayActive).toBe(true);
    emitOverlay!(true); // duplicate state ignored
    emitOverlay!(false);
    expect(adapter.overlayActive).toBe(false);
    expect(events).toEqual([true, false]);

    off();
    emitOverlay!(true);
    expect(adapter.overlayActive).toBe(true);
    expect(events).toEqual([true, false]);
  });
});

describe('Steam achievements map, cloud hydration, and desktop config invariants', () => {
  const localStore = new Map<string, string>();
  beforeEach(() => {
    localStore.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k) => localStore.get(k) ?? null,
      setItem: (k, v) => void localStore.set(k, v),
      removeItem: (k) => void localStore.delete(k),
      clear: () => localStore.clear(),
      key: () => null,
      length: 0,
    };
    setPlatformAdapter(null);
  });

  it('desktop/achievements.json matches exportAchievementManifest() 1-to-1 with unique valid IDs', () => {
    const jsonPath = resolve(ROOT, 'desktop/achievements.json');
    expect(existsSync(jsonPath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(jsonPath, 'utf8')) as SteamAchievementMeta[];
    const expected = exportAchievementManifest();
    expect(onDisk).toEqual(expected);
    expect(onDisk.length).toBeGreaterThanOrEqual(25);
    const ids = new Set(onDisk.map((a) => a.id));
    expect(ids.size).toBe(onDisk.length);
    for (const a of onDisk) {
      expect(a.id).toMatch(/^[A-Z0-9_]{3,64}$/);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(0);
    }
  });

  it('unlocks feat, star-sweep, and challenge achievements as progress advances', async () => {
    const unlocked: string[] = [];
    const adapter = createPlatformAdapter({
      storage: createMemStorage(),
      bridge: {
        isSteam: true,
        unlockAchievement: async (id) => {
          unlocked.push(id);
          return true;
        },
        cloudRead: async () => null,
        cloudWrite: async () => true,
      },
    });

    const p = createDefaultProgress(LEVELS.length);
    expect(earnedSteamAchievementIds(p, LEVELS)).toEqual([]);

    // Clear island 0 (Breezy) with 3 stars and Bowless challenge.
    p.clears[0] = 1;
    p.bestStars[0] = 3;
    p.challengeClears[0] = ['bowless'];
    await syncAchievementsFromProgress(p, adapter, LEVELS);
    expect(unlocked).toContain('FEAT_FIRST_LANDING');
    expect(unlocked).toContain('FEAT_STARCATCHER');
    expect(unlocked).toContain('STARS_BREEZY_SWEEP'); // L1 is the sole Breezy campaign island
    expect(unlocked).toContain('CHALLENGE_BOWLESS');
    expect(unlocked).not.toContain('CROWN_ALL_ISLANDS');

    // Master every island → unlocks the full achievement catalog except multi-day/30-win feats.
    for (let i = 0; i < LEVELS.length; i++) {
      p.clears[i] = 2;
      p.bestStars[i] = 3;
      p.challengeClears[i] = [...challengesForLevel(LEVELS[i])];
    }
    await syncAchievementsFromProgress(p, adapter, LEVELS);
    expect(unlocked).toContain('FEAT_FULL_FIRMAMENT');
    expect(unlocked).toContain('STARS_MASTER_SWEEP');
    expect(unlocked).toContain('CHALLENGE_ALL_BADGES');
    expect(unlocked).toContain('CROWN_ALL_ISLANDS');
    expect(STEAM_ACHIEVEMENTS.length).toBe(exportAchievementManifest().length);
  });

  it('saveProgress pushes to Steam Cloud and hydrateProgressFromCloud merges local + remote saves', async () => {
    let cloudBlob: string | null = null;
    const unlocked: string[] = [];
    const adapter = createPlatformAdapter({
      storage: createMemStorage(),
      bridge: {
        isSteam: true,
        unlockAchievement: async (id) => {
          unlocked.push(id);
          return true;
        },
        cloudRead: async () => cloudBlob,
        cloudWrite: async (_slot, json) => {
          cloudBlob = json;
          return true;
        },
      },
    });
    setPlatformAdapter(adapter);

    const remoteOnly = createDefaultProgress(LEVELS.length);
    remoteOnly.unlockedLevelIndex = 3;
    remoteOnly.bestStars[0] = 3;
    remoteOnly.clears[0] = 1;
    cloudBlob = JSON.stringify(remoteOnly);

    const localOnly = createDefaultProgress(LEVELS.length);
    localOnly.bestStars[1] = 2;
    localOnly.clears[1] = 1;

    const res = await hydrateProgressFromCloud(localOnly, LEVELS.length, adapter, LEVELS);
    expect(res.updated).toBe(true);
    expect(res.merged.unlockedLevelIndex).toBe(3);
    expect(res.merged.bestStars[0]).toBe(3);
    expect(res.merged.bestStars[1]).toBe(2);
    expect(unlocked).toContain('FEAT_FIRST_LANDING');

    // Subsequent saveProgress mirrors updated save blob to Steam Cloud.
    res.merged.bestStars[1] = 3;
    saveProgress(res.merged);
    await Promise.resolve();
    expect(JSON.parse(cloudBlob ?? '{}').bestStars[1]).toBe(3);
  });

  it('hydrateProgressFromCloud awaits explicit adapter cloud writes and guards corrupt cloud overwrites', async () => {
    let remoteBlob: string | null = '{corrupt-json';
    let writeCount = 0;
    const explicitAdapter = createPlatformAdapter({
      storage: createMemStorage(),
      bridge: {
        isSteam: true,
        unlockAchievement: async () => true,
        cloudRead: async () => remoteBlob,
        cloudWrite: async (_slot, json) => {
          await new Promise((r) => setTimeout(r, 5));
          writeCount++;
          remoteBlob = json;
          return true;
        },
      },
    });
    // Deliberately leave global singleton unset (web no-op) to prove explicit adapter is used.
    setPlatformAdapter(null);

    // Empty local save must NOT clobber a corrupt cloud slot.
    const emptyLocal = createDefaultProgress(LEVELS.length);
    await hydrateProgressFromCloud(emptyLocal, LEVELS.length, explicitAdapter, LEVELS);
    expect(writeCount).toBe(0);
    expect(remoteBlob).toBe('{corrupt-json');

    // Non-empty local save repairs the corrupt cloud slot and awaits completion.
    const realLocal = createDefaultProgress(LEVELS.length);
    realLocal.bestStars[0] = 2;
    realLocal.clears[0] = 1;
    await hydrateProgressFromCloud(realLocal, LEVELS.length, explicitAdapter, LEVELS);
    expect(writeCount).toBe(1);
    expect(JSON.parse(remoteBlob ?? '{}').bestStars[0]).toBe(2);

    // Merging newer local progress into an older valid cloud save writes merged result back via explicitAdapter.
    const olderRemote = createDefaultProgress(LEVELS.length);
    olderRemote.bestStars[0] = 1;
    olderRemote.clears[0] = 1;
    remoteBlob = JSON.stringify(olderRemote);
    realLocal.bestStars[2] = 3;
    realLocal.clears[2] = 1;
    const mergedRes = await hydrateProgressFromCloud(realLocal, LEVELS.length, explicitAdapter, LEVELS);
    expect(mergedRes.updated).toBe(false);
    expect(writeCount).toBe(2);
    expect(JSON.parse(remoteBlob ?? '{}').bestStars[2]).toBe(3);
  });

  it('enforces Electron security flags and keeps src/sim isolated from src/platform', () => {
    const mainSrc = readFileSync(resolve(ROOT, 'desktop/main.cjs'), 'utf8');
    const preloadSrc = readFileSync(resolve(ROOT, 'desktop/preload.cjs'), 'utf8');
    const builderCfg = JSON.parse(readFileSync(resolve(ROOT, 'desktop/electron-builder.json'), 'utf8')) as Record<string, unknown>;

    expect(mainSrc).toContain('contextIsolation: true');
    expect(mainSrc).toContain('nodeIntegration: false');
    expect(preloadSrc).toContain('contextBridge.exposeInMainWorld');
    expect(builderCfg.win).toBeDefined();
    expect(builderCfg.mac).toBeDefined();
    expect(builderCfg.linux).toBeDefined();

    // Nothing in src/sim may import src/platform.
    for (const file of readdirSync(resolve(ROOT, 'src/sim'))) {
      if (!file.endsWith('.ts')) continue;
      const content = readFileSync(resolve(ROOT, 'src/sim', file), 'utf8');
      expect(content, `${file} must not import platform`).not.toMatch(/platform\//);
    }
  });
});
