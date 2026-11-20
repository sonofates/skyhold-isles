import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { challengesForLevel } from '../../src/data/challenges.ts';
import { HERO_IDS, HERO_LEVEL_XP } from '../../src/data/heroes.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { createFreshHeroSaveData } from '../../src/render2d/heroes2d.ts';
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
import {
  CLOUD_PROGRESS_2D_SLOT,
  hydrateProgress2DFromCloud,
  loadProgress2D,
  PROGRESS_2D_KEY,
  PROGRESS_2D_RESET_BACKUP_KEY,
  recordRunResult2D,
  resetProgress2D,
  saveProgress2D,
} from '../../src/render2d/ui/progress2d.ts';

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

  it('saveProgress2D, resetProgress2D, and hydrateProgress2DFromCloud sync 2D Steam Cloud and Steam achievements cleanly', async () => {
    const cloudSlots = new Map<string, string>();
    const unlockedIds: string[] = [];
    const steamAdapter = createPlatformAdapter({
      storage: createMemStorage(),
      bridge: {
        isSteam: true,
        unlockAchievement: async (id) => {
          if (!unlockedIds.includes(id)) unlockedIds.push(id);
          return true;
        },
        cloudRead: async (slot) => cloudSlots.get(slot) ?? null,
        cloudWrite: async (slot, json) => {
          cloudSlots.set(slot, json);
          return true;
        },
      },
    });
    setPlatformAdapter(steamAdapter);

    // Recording a 3★ 2D win on l1c writes to 'progress2d' (leaving 3D 'progress' untouched) and unlocks Steam feats.
    recordRunResult2D({
      levelId: 'l1c',
      won: true,
      stars: 3,
      livesRemaining: 20,
      waveReached: LEVELS_2D[0].waves.length,
      heroId: 'bran',
      heroXpEarned: 180,
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(cloudSlots.has('progress')).toBe(false);
    expect(cloudSlots.has(CLOUD_PROGRESS_2D_SLOT)).toBe(true);
    expect(unlockedIds).toContain('FEAT_FIRST_LANDING');
    expect(unlockedIds).toContain('FEAT_STARCATCHER');

    // Mock QA islands (?mockislands=N) never write to Steam Cloud or unlock achievements.
    const rawLocalBeforeMock = localStorage.getItem(PROGRESS_2D_KEY)!;
    const cloudBeforeMock = cloudSlots.get(CLOUD_PROGRESS_2D_SLOT);
    const mockRoster = [...LEVELS_2D, { ...LEVELS_2D[0], id: 'mock-1' }];
    const mockSave = loadProgress2D(mockRoster);
    mockSave.bestStars[mockRoster.length - 1] = 3;
    saveProgress2D(mockSave, mockRoster);
    await new Promise((r) => setTimeout(r, 10));
    expect(cloudSlots.get(CLOUD_PROGRESS_2D_SLOT)).toBe(cloudBeforeMock);
    localStorage.setItem(PROGRESS_2D_KEY, rawLocalBeforeMock);

    // Cross-device Steam Cloud merge: remote 'progress2d' carries reordered subset IDs + Wren selected & leveled.
    const remoteSubset = [LEVELS_2D[1], LEVELS_2D[2]]; // i01, i02 cleared -> combined with local l1c = 3 cleared (unlocks Wren @ 2!)
    const remoteProg = createDefaultProgress(2);
    remoteProg.bestStars[0] = 3;
    remoteProg.clears[0] = 1;
    remoteProg.bestStars[1] = 2;
    remoteProg.clears[1] = 1;
    remoteProg.heroes = {
      selectedHero: 'wren',
      roster: {
        bran: { xp: 50, skills: [] },
        wren: { xp: 520, skills: ['wren_bow_1', 'wren_bow_2'] },
      },
    };
    cloudSlots.set(
      CLOUD_PROGRESS_2D_SLOT,
      JSON.stringify({ ids: remoteSubset.map((l) => l.id), progress: remoteProg }),
    );

    const hydrated = await hydrateProgress2DFromCloud(undefined, LEVELS_2D, steamAdapter);
    expect(hydrated.updated).toBe(true);
    expect(hydrated.merged.bestStars[0]).toBe(3); // l1c from local
    expect(hydrated.merged.bestStars[1]).toBe(3); // i01 from cloud
    expect(hydrated.merged.bestStars[2]).toBe(2); // i02 from cloud
    expect(hydrated.merged.heroes?.roster.bran?.xp).toBe(180); // monotonic max(180, 50)
    expect(hydrated.merged.heroes?.roster.wren?.xp).toBe(520);
    expect(hydrated.merged.heroes?.selectedHero).toBe('wren'); // preserved across remapped merge!
    expect(loadProgress2D().heroes?.selectedHero).toBe('wren');

    // Resetting 2D progress backs up local save and writes fresh state to 'progress2d' on Steam Cloud.
    resetProgress2D();
    await new Promise((r) => setTimeout(r, 10));
    expect(localStorage.getItem(PROGRESS_2D_KEY)).toBeNull();
    expect(localStorage.getItem(PROGRESS_2D_RESET_BACKUP_KEY)).not.toBeNull();
    const resetCloud = JSON.parse(cloudSlots.get(CLOUD_PROGRESS_2D_SLOT) ?? '{}') as { progress: { bestStars: number[] } };
    expect(resetCloud.progress.bestStars.every((s) => s === 0)).toBe(true);

    // Empty local boot when cloud slot is missing/offline must NOT write an empty save blob to Steam Cloud,
    // and hydrateProgress2DFromCloud skips Steam Cloud / achievement IPC on mock-* QA rosters.
    cloudSlots.clear();
    unlockedIds.length = 0;
    const empty2dHydrate = await hydrateProgress2DFromCloud(undefined, LEVELS_2D, steamAdapter);
    expect(empty2dHydrate.updated).toBe(false);
    expect(cloudSlots.has(CLOUD_PROGRESS_2D_SLOT)).toBe(false);
    const empty3dHydrate = await hydrateProgressFromCloud(createDefaultProgress(LEVELS.length), LEVELS.length, steamAdapter, LEVELS);
    expect(empty3dHydrate.updated).toBe(false);
    expect(cloudSlots.has('progress')).toBe(false);

    const mockHydrate = await hydrateProgress2DFromCloud(undefined, mockRoster, steamAdapter);
    expect(mockHydrate.unlockedAchievements).toEqual([]);
    expect(cloudSlots.has(CLOUD_PROGRESS_2D_SLOT)).toBe(false);
    setPlatformAdapter(null);
  });

  it('enforces Electron security flags and keeps src/sim isolated from src/platform', () => {
    const mainSrc = readFileSync(resolve(ROOT, 'desktop/main.cjs'), 'utf8');
    const preloadSrc = readFileSync(resolve(ROOT, 'desktop/preload.cjs'), 'utf8');
    const builderCfg = JSON.parse(readFileSync(resolve(ROOT, 'desktop/electron-builder.json'), 'utf8')) as Record<string, unknown>;

    expect(mainSrc).toContain('contextIsolation: true');
    expect(mainSrc).toContain('nodeIntegration: false');
    expect(mainSrc).toContain('sandbox: true');
    expect(mainSrc).toContain('ignore-gpu-blocklist');
    expect(mainSrc).toContain('unsafely-treat-insecure-origin-as-secure');
    expect(mainSrc).toContain('requestSingleInstanceLock');
    expect(mainSrc).toContain('setPermissionRequestHandler');
    expect(mainSrc).toContain("ses.protocol.handle('https'");
    expect(mainSrc).toContain("'.otf': 'font/otf'");
    expect(mainSrc).toContain('nativeImage.createFromBuffer');
    expect(mainSrc).toContain("scene: 'worldMap'");
    expect(mainSrc).toContain("scene: 'game'");
    expect(preloadSrc).toContain('contextBridge.exposeInMainWorld');
    expect(builderCfg.win).toBeDefined();
    expect(builderCfg.mac).toBeDefined();
    expect(builderCfg.linux).toBeDefined();
    expect(builderCfg.files).toEqual(
      expect.arrayContaining([
        'dist/**/*',
        '!dist/sw.js',
        'desktop/main.cjs',
        'desktop/preload.cjs',
        'desktop/achievements.json',
      ]),
    );

    // Every asset extension under public/ must have an explicit MIME entry in desktop/main.cjs.
    const collectExts = (dir: string, out = new Set<string>()): Set<string> => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) collectExts(full, out);
        else {
          const dot = entry.name.lastIndexOf('.');
          if (dot > 0) out.add(entry.name.slice(dot).toLowerCase());
        }
      }
      return out;
    };
    for (const ext of collectExts(resolve(ROOT, 'public'))) {
      expect(mainSrc, `desktop/main.cjs MIME_BY_EXT should cover ${ext}`).toContain(`'${ext}':`);
    }

    // Nothing in src/sim may import src/platform.
    for (const file of readdirSync(resolve(ROOT, 'src/sim'))) {
      if (!file.endsWith('.ts')) continue;
      const content = readFileSync(resolve(ROOT, 'src/sim', file), 'utf8');
      expect(content, `${file} must not import platform`).not.toMatch(/platform\//);
    }
  });

  it('preserves all 28 original Steam achievement IDs verbatim and covers Chapter 2, Heroes L10/L20, Hard wins, Boss i24, 25×3★, Endless & Daily streaks', () => {
    const legacy28 = [
      'FEAT_FIRST_LANDING',
      'FEAT_ISLAND_HOPPER',
      'FEAT_SKY_CHARTED',
      'FEAT_STARCATCHER',
      'FEAT_STARGAZER',
      'FEAT_FULL_FIRMAMENT',
      'FEAT_MASTER_STROKE',
      'FEAT_BADGE_HUNTER',
      'FEAT_CROWNED',
      'FEAT_STORM_CHASER',
      'FEAT_SQUALL_RIDER',
      'FEAT_STEADY_WINDS',
      'FEAT_VETERAN',
      'STARS_BREEZY_SWEEP',
      'STARS_CHALLENGING_SWEEP',
      'STARS_HEROIC_SWEEP',
      'STARS_MASTER_SWEEP',
      'CHALLENGE_THAW',
      'CHALLENGE_QUIET_GUNS',
      'CHALLENGE_BOWLESS',
      'CHALLENGE_STATIC_FREE',
      'CHALLENGE_GALE_FORCE',
      'CHALLENGE_IRON_TIDE',
      'CHALLENGE_THIN_PURSE',
      'CHALLENGE_GLASS_SANCTUARY',
      'CHALLENGE_SILENT_SKIES',
      'CHALLENGE_ALL_BADGES',
      'CROWN_ALL_ISLANDS',
    ];
    expect(STEAM_ACHIEVEMENTS.slice(0, legacy28.length).map((a) => a.id)).toEqual(legacy28);
    expect(STEAM_ACHIEVEMENTS.length).toBe(58);

    const fresh25 = createDefaultProgress(LEVELS_2D.length);
    fresh25.heroes = createFreshHeroSaveData();
    expect(earnedSteamAchievementIds(fresh25, LEVELS_2D)).toEqual([]);

    // 1. Chapter Two + Boss i24 + 3D LEVELS isolation
    const pCh2 = createDefaultProgress(LEVELS_2D.length);
    const i17Idx = LEVELS_2D.findIndex((l) => l.id === 'i17');
    const i24Idx = LEVELS_2D.findIndex((l) => l.id === 'i24');
    pCh2.clears[i17Idx] = 1;
    pCh2.bestStars[i17Idx] = 2;
    let earned = new Set(earnedSteamAchievementIds(pCh2, LEVELS_2D));
    expect(earned.has('CHAPTER_TWO_LANDING')).toBe(true);
    expect(earned.has('CHAPTER_TWO_CLEARED')).toBe(false);
    expect(earned.has('BOSS_I24_CLEARED')).toBe(false);

    for (let i = i17Idx; i <= i24Idx; i++) {
      pCh2.clears[i] = 1;
      pCh2.bestStars[i] = i === i24Idx ? 2 : 3;
    }
    earned = new Set(earnedSteamAchievementIds(pCh2, LEVELS_2D));
    expect(earned.has('BOSS_I24_CLEARED')).toBe(true);
    expect(earned.has('CHAPTER_TWO_CLEARED')).toBe(true);
    expect(earned.has('CHAPTER_TWO_THREE_STARS')).toBe(false);

    pCh2.bestStars[i24Idx] = 3;
    earned = new Set(earnedSteamAchievementIds(pCh2, LEVELS_2D));
    expect(earned.has('CHAPTER_TWO_THREE_STARS')).toBe(true);
    expect(earned.has('STARS_ALL_25_ISLANDS')).toBe(false);

    // 3D LEVELS has no Chapter Two islands -> Chapter Two & 25-island achievements stay false even when all 16 are 3★
    const p3dAll = createDefaultProgress(LEVELS.length);
    p3dAll.bestStars.fill(3);
    p3dAll.clears.fill(1);
    const earned3d = new Set(earnedSteamAchievementIds(p3dAll, LEVELS));
    expect(earned3d.has('FEAT_FULL_FIRMAMENT')).toBe(true);
    expect(earned3d.has('CHAPTER_TWO_LANDING')).toBe(false);
    expect(earned3d.has('CHAPTER_TWO_CLEARED')).toBe(false);
    expect(earned3d.has('BOSS_I24_CLEARED')).toBe(false);
    expect(earned3d.has('STARS_ALL_25_ISLANDS')).toBe(false);

    // All 25 islands 3★
    for (let i = 0; i < LEVELS_2D.length; i++) {
      pCh2.clears[i] = 1;
      pCh2.bestStars[i] = 3;
    }
    earned = new Set(earnedSteamAchievementIds(pCh2, LEVELS_2D));
    expect(earned.has('FEAT_FULL_FIRMAMENT')).toBe(true);
    expect(earned.has('STARS_ALL_25_ISLANDS')).toBe(true);
    // Legacy save without difficultyWins has 0 Hard ribbons even at 25×3★ Normal
    expect(earned.has('HARD_FIRST_RIBBON')).toBe(false);

    // 2. Each hero to Level 10 and Level 20 + Fellowship of Skyhold (unlock all 5 @ 10 clears)
    const pHero = createDefaultProgress(LEVELS_2D.length);
    pHero.heroes = createFreshHeroSaveData();
    for (let i = 0; i < 9; i++) pHero.clears[i] = 1;
    expect(earnedSteamAchievementIds(pHero, LEVELS_2D)).not.toContain('HERO_ALL_ROSTER');
    pHero.clears[9] = 1; // 10 cleared islands -> Sela unlocked!
    expect(earnedSteamAchievementIds(pHero, LEVELS_2D)).toContain('HERO_ALL_ROSTER');

    const xpLv10 = HERO_LEVEL_XP[9];
    const xpLv20 = HERO_LEVEL_XP[19];
    for (const hid of HERO_IDS) {
      const upper = hid.toUpperCase();
      pHero.heroes.roster[hid] = { xp: xpLv10 - 1, skills: [] };
      expect(earnedSteamAchievementIds(pHero, LEVELS_2D)).not.toContain(`HERO_${upper}_LV10`);
      pHero.heroes.roster[hid] = { xp: xpLv10, skills: [] };
      const at10 = earnedSteamAchievementIds(pHero, LEVELS_2D);
      expect(at10).toContain(`HERO_${upper}_LV10`);
      expect(at10).not.toContain(`HERO_${upper}_LV20`);

      pHero.heroes.roster[hid] = { xp: xpLv20 - 1, skills: [] };
      expect(earnedSteamAchievementIds(pHero, LEVELS_2D)).not.toContain(`HERO_${upper}_LV20`);
      pHero.heroes.roster[hid] = { xp: xpLv20, skills: [] };
      expect(earnedSteamAchievementIds(pHero, LEVELS_2D)).toContain(`HERO_${upper}_LV20`);
    }
    expect(earnedSteamAchievementIds(pHero, LEVELS_2D)).toContain('HERO_ALL_LV20');

    // 3. Hard ribbons (1, 5, 10, i24, all 25)
    const pHard = createDefaultProgress(LEVELS_2D.length);
    pHard.difficultyWins = {
      easy: new Array<number>(LEVELS_2D.length).fill(0),
      normal: new Array<number>(LEVELS_2D.length).fill(0),
      hard: new Array<number>(LEVELS_2D.length).fill(0),
    };
    pHard.difficultyWins.hard[0] = 1;
    pHard.clears[0] = 1;
    pHard.bestStars[0] = 1;
    earned = new Set(earnedSteamAchievementIds(pHard, LEVELS_2D));
    expect(earned.has('HARD_FIRST_RIBBON')).toBe(true);
    expect(earned.has('HARD_FIVE_RIBBONS')).toBe(false);

    for (let i = 0; i < 5; i++) pHard.difficultyWins.hard[i] = 2;
    expect(earnedSteamAchievementIds(pHard, LEVELS_2D)).toContain('HARD_FIVE_RIBBONS');
    expect(earnedSteamAchievementIds(pHard, LEVELS_2D)).not.toContain('HARD_TEN_RIBBONS');

    for (let i = 0; i < 10; i++) pHard.difficultyWins.hard[i] = 2;
    expect(earnedSteamAchievementIds(pHard, LEVELS_2D)).toContain('HARD_TEN_RIBBONS');
    expect(earnedSteamAchievementIds(pHard, LEVELS_2D)).not.toContain('HARD_BOSS_I24');

    pHard.difficultyWins.hard[i24Idx] = 1;
    const atHardBoss = earnedSteamAchievementIds(pHard, LEVELS_2D);
    expect(atHardBoss).toContain('HARD_BOSS_I24');
    // Raw difficultyWins-only saves also satisfy BOSS_I24_CLEARED & CHAPTER_TWO_LANDING without mutating input.
    expect(atHardBoss).toContain('BOSS_I24_CLEARED');
    expect(atHardBoss).toContain('CHAPTER_TWO_LANDING');
    expect(pHard.clears[i24Idx]).toBe(0);
    expect(atHardBoss).not.toContain('HARD_ALL_ISLANDS');

    pHard.difficultyWins.hard.fill(3);
    const atHardAll3 = earnedSteamAchievementIds(pHard, LEVELS_2D);
    expect(atHardAll3).toContain('HARD_ALL_ISLANDS');
    expect(atHardAll3).toContain('STARS_ALL_25_ISLANDS');
    expect(atHardAll3).toContain('CHAPTER_TWO_THREE_STARS');

    // 4. Endless milestones (Bronze 3, Silver 6, Gold 10, Deep 20, 5 Golds)
    const pEnd = createDefaultProgress(LEVELS_2D.length);
    const w0 = LEVELS_2D[0].waves.length;
    pEnd.bestEndlessWaves[0] = w0 + 3; // 2 endless waves cleared -> below Bronze (3)
    expect(earnedSteamAchievementIds(pEnd, LEVELS_2D)).not.toContain('ENDLESS_BRONZE_MEDAL');
    pEnd.bestEndlessWaves[0] = w0 + 4; // 3 endless waves cleared -> Bronze!
    expect(earnedSteamAchievementIds(pEnd, LEVELS_2D)).toContain('ENDLESS_BRONZE_MEDAL');
    expect(earnedSteamAchievementIds(pEnd, LEVELS_2D)).not.toContain('ENDLESS_SILVER_MEDAL');
    pEnd.bestEndlessWaves[0] = w0 + 7; // 6 endless waves cleared -> Silver!
    expect(earnedSteamAchievementIds(pEnd, LEVELS_2D)).toContain('ENDLESS_SILVER_MEDAL');
    pEnd.bestEndlessWaves[0] = w0 + 21; // 20 endless waves cleared -> Deep 20 + Storm Chaser!
    earned = new Set(earnedSteamAchievementIds(pEnd, LEVELS_2D));
    expect(earned.has('FEAT_STORM_CHASER')).toBe(true);
    expect(earned.has('ENDLESS_DEEP_20')).toBe(true);
    expect(earned.has('ENDLESS_FIVE_GOLDS')).toBe(false);
    for (let i = 1; i < 5; i++) {
      pEnd.bestEndlessWaves[i] = LEVELS_2D[i].waves.length + 11;
    }
    expect(earnedSteamAchievementIds(pEnd, LEVELS_2D)).toContain('ENDLESS_FIVE_GOLDS');

    // 5. Daily Squall streaks & totals (1 win, 7-day streak, 14-day streak, 20 wins; bestStreak survives reset)
    const pDaily = createDefaultProgress(LEVELS_2D.length);
    pDaily.daily = { lastDay: 20500, streak: 1, bestStreak: 1, total: 1 };
    earned = new Set(earnedSteamAchievementIds(pDaily, LEVELS_2D));
    expect(earned.has('DAILY_FIRST_WIN')).toBe(true);
    expect(earned.has('DAILY_STREAK_7')).toBe(false);

    pDaily.daily = { lastDay: 20510, streak: 0, bestStreak: 7, total: 8 };
    earned = new Set(earnedSteamAchievementIds(pDaily, LEVELS_2D));
    expect(earned.has('DAILY_STREAK_7')).toBe(true);
    expect(earned.has('DAILY_STREAK_14')).toBe(false);
    expect(earned.has('DAILY_TOTAL_20')).toBe(false);

    pDaily.daily = { lastDay: 20530, streak: 14, bestStreak: 14, total: 20 };
    earned = new Set(earnedSteamAchievementIds(pDaily, LEVELS_2D));
    expect(earned.has('DAILY_STREAK_14')).toBe(true);
    expect(earned.has('DAILY_TOTAL_20')).toBe(true);

    // 6. Malformed / NaN save fields never throw or false-trigger
    const broken = {
      ...createDefaultProgress(2),
      unlockedLevelIndex: Number.NaN,
      bestStars: [Number.NaN, -5],
      clears: [Number.NaN, 0],
      bestEndlessWaves: [Number.NaN, -99],
      daily: { lastDay: Number.NaN, streak: Number.NaN, bestStreak: Number.NaN, total: Number.NaN },
      heroes: { selectedHero: 'bran' as const, roster: { bran: { xp: Number.NaN, skills: [] } } },
    };
    expect(earnedSteamAchievementIds(broken, LEVELS_2D)).toEqual([]);
  });

  it('auto-hydrates 2D Steam Cloud on boot, prevents first-write cloud clobbering on new PCs, and cancels in-flight boot reads on resetProgress2D', async () => {
    // 1. Auto-hydration on loadProgress2D() boot pulls remote Steam Cloud save and unlocks retroactive achievements.
    const cloudSlots = new Map<string, string>();
    const unlockedBoot: string[] = [];
    const remoteBootSave = createDefaultProgress(LEVELS_2D.length);
    const i24Idx = LEVELS_2D.findIndex((l) => l.id === 'i24');
    remoteBootSave.bestStars[0] = 3;
    remoteBootSave.clears[0] = 1;
    remoteBootSave.bestStars[i24Idx] = 3;
    remoteBootSave.clears[i24Idx] = 1;
    remoteBootSave.heroes = createFreshHeroSaveData();
    remoteBootSave.heroes.roster.bran = { xp: HERO_LEVEL_XP[9], skills: [] };
    cloudSlots.set(
      CLOUD_PROGRESS_2D_SLOT,
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: remoteBootSave }),
    );

    const bootAdapter = createPlatformAdapter({
      storage: createMemStorage(),
      bridge: {
        isSteam: true,
        unlockAchievement: async (id) => {
          if (!unlockedBoot.includes(id)) unlockedBoot.push(id);
          return true;
        },
        cloudRead: async (slot) => cloudSlots.get(slot) ?? null,
        cloudWrite: async (slot, json) => {
          cloudSlots.set(slot, json);
          return true;
        },
      },
    });
    setPlatformAdapter(bootAdapter);

    // Synchronous return is empty local save, while background boot hydration populates localStorage + Steam achievements.
    const initialSync = loadProgress2D(LEVELS_2D);
    expect(initialSync.bestStars[i24Idx]).toBe(0);
    await new Promise((r) => setTimeout(r, 15));
    const afterBoot = loadProgress2D(LEVELS_2D);
    expect(afterBoot.bestStars[i24Idx]).toBe(3);
    expect(afterBoot.heroes?.roster.bran?.xp).toBe(HERO_LEVEL_XP[9]);
    expect(unlockedBoot).toContain('BOSS_I24_CLEARED');
    expect(unlockedBoot).toContain('HERO_BRAN_LV10');

    // 2. Write-before-hydrate protection: calling saveProgress2D() directly on a new PC merges remote cloud first instead of overwriting it!
    localStore.clear();
    const newPcCloud = new Map<string, string>();
    const richRemote = createDefaultProgress(LEVELS_2D.length);
    richRemote.bestStars[5] = 3;
    richRemote.clears[5] = 1;
    richRemote.difficultyWins = {
      easy: new Array<number>(LEVELS_2D.length).fill(0),
      normal: new Array<number>(LEVELS_2D.length).fill(0),
      hard: new Array<number>(LEVELS_2D.length).fill(0),
    };
    richRemote.difficultyWins.hard[5] = 3;
    newPcCloud.set(
      CLOUD_PROGRESS_2D_SLOT,
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: richRemote }),
    );

    const newPcAdapter = createPlatformAdapter({
      storage: createMemStorage(),
      bridge: {
        isSteam: true,
        unlockAchievement: async () => true,
        cloudRead: async (slot) => newPcCloud.get(slot) ?? null,
        cloudWrite: async (slot, json) => {
          newPcCloud.set(slot, json);
          return true;
        },
      },
    });
    setPlatformAdapter(newPcAdapter);

    // Directly call saveProgress2D with only l1c=2★ (never called loadProgress2D or hydrateProgress2DFromCloud first!)
    const firstWriteSave = createDefaultProgress(LEVELS_2D.length);
    firstWriteSave.bestStars[0] = 2;
    firstWriteSave.clears[0] = 1;
    saveProgress2D(firstWriteSave, LEVELS_2D);
    await new Promise((r) => setTimeout(r, 15));

    const mergedAfterFirstWrite = loadProgress2D(LEVELS_2D);
    expect(mergedAfterFirstWrite.bestStars[0]).toBe(2);
    expect(mergedAfterFirstWrite.bestStars[5]).toBe(3); // remote i05 3★ + Hard ribbon preserved!
    expect(mergedAfterFirstWrite.difficultyWins?.hard[5]).toBe(3);
    const cloudAfterFirstWrite = JSON.parse(newPcCloud.get(CLOUD_PROGRESS_2D_SLOT) ?? '{}') as {
      progress: { bestStars: number[] };
    };
    expect(cloudAfterFirstWrite.progress.bestStars[0]).toBe(2);
    expect(cloudAfterFirstWrite.progress.bestStars[5]).toBe(3);

    // 3. Reset cancellation: resetProgress2D() while initial boot cloudRead is in flight never resurrects erased save.
    localStore.clear();
    let resolveSlowRead: ((val: string | null) => void) | null = null;
    const resetCloud = new Map<string, string>(newPcCloud);
    const slowAdapter = createPlatformAdapter({
      storage: createMemStorage(),
      bridge: {
        isSteam: true,
        unlockAchievement: async () => true,
        cloudRead: (slot) =>
          new Promise<string | null>((res) => {
            resolveSlowRead = () => res(resetCloud.get(slot) ?? null);
          }),
        cloudWrite: async (slot, json) => {
          resetCloud.set(slot, json);
          return true;
        },
      },
    });
    setPlatformAdapter(slowAdapter);

    loadProgress2D(LEVELS_2D); // starts slow boot cloudRead
    expect(resolveSlowRead).not.toBeNull();
    resetProgress2D(LEVELS_2D); // user resets while boot cloudRead is still pending!
    resolveSlowRead!(null);
    await new Promise((r) => setTimeout(r, 15));

    expect(localStorage.getItem(PROGRESS_2D_KEY)).toBeNull();
    const afterResetCloud = JSON.parse(resetCloud.get(CLOUD_PROGRESS_2D_SLOT) ?? '{}') as {
      progress: { bestStars: number[] };
    };
    expect(afterResetCloud.progress.bestStars.every((s) => s === 0)).toBe(true);
    setPlatformAdapter(null);
  });
});
