import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { ProgressData } from '../../src/core/types.ts';
import { challengesForLevel } from '../../src/data/challenges.ts';
import { HERO_IDS, HERO_LEVEL_XP } from '../../src/data/heroes.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { combineRunModifiers } from '../../src/data/runModifiers.ts';
import { starWallet } from '../../src/game/progression.ts';
import { applyNode, createFreshHeroSaveData, respec, selectHero } from '../../src/render2d/heroes2d.ts';
import { GameSession } from '../../src/platform/gameSession.ts';
import { buildHudStateView } from '../../src/platform/sessionBridge.ts';
import { SimWorld } from '../../src/sim/world.ts';
import {
  createPlatformAdapter,
  earnedSteamAchievementIds,
  encodeSaveCode,
  exportAchievementManifest,
  hydrateProgressFromCloud,
  recoverProgressSave,
  sanitizeCloudSlot,
  setPlatformAdapter,
  STEAM_ACHIEVEMENTS,
  syncAchievementsFromProgress,
  type CloudStorageLike,
  type SteamAchievementMeta,
  type SteamBridge,
} from '../../src/platform/index.ts';
import {
  CLOUD_PROGRESS_SLOT,
  createDefaultProgress,
  loadProgress,
  resetProgressSave,
  saveLocalProgress,
  saveProgress,
} from '../../src/platform/storage.ts';
import {
  applyRunResult2D,
  CLOUD_PROGRESS_2D_SLOT,
  decodeSaveCode2D,
  encodeSaveCode2D,
  hydrateProgress2DFromCloud,
  importSaveCode2D,
  loadProgress2D,
  onProgress2DCloudHydrated,
  PROGRESS_2D_KEY,
  PROGRESS_2D_RESET_BACKUP_KEY,
  recordRunResult2D,
  recoverProgress2D,
  remapProgress,
  resetProgress2D,
  saveLocalProgress2D,
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

    // 1. Chapter 3 + Boss i24 + 3D LEVELS isolation
    const pCh2 = createDefaultProgress(LEVELS_2D.length);
    const i17Idx = LEVELS_2D.findIndex((l) => l.id === 'i17');
    const i24Idx = LEVELS_2D.findIndex((l) => l.id === 'i24');
    pCh2.clears[i17Idx] = 1;
    pCh2.bestStars[i17Idx] = 2;
    let earned = new Set(earnedSteamAchievementIds(pCh2, LEVELS_2D));
    expect(earned.has('CHAPTER_THREE_LANDING')).toBe(true);
    expect(earned.has('CHAPTER_THREE_CLEARED')).toBe(false);
    expect(earned.has('BOSS_I24_CLEARED')).toBe(false);

    for (let i = i17Idx; i <= i24Idx; i++) {
      pCh2.clears[i] = 1;
      pCh2.bestStars[i] = i === i24Idx ? 2 : 3;
    }
    earned = new Set(earnedSteamAchievementIds(pCh2, LEVELS_2D));
    expect(earned.has('BOSS_I24_CLEARED')).toBe(true);
    expect(earned.has('CHAPTER_THREE_CLEARED')).toBe(true);
    expect(earned.has('CHAPTER_THREE_THREE_STARS')).toBe(false);

    pCh2.bestStars[i24Idx] = 3;
    earned = new Set(earnedSteamAchievementIds(pCh2, LEVELS_2D));
    expect(earned.has('CHAPTER_THREE_THREE_STARS')).toBe(true);
    expect(earned.has('STARS_ALL_ISLANDS')).toBe(false);

    // 3D LEVELS has no Chapter 3 islands -> Chapter 3 & all-island achievements stay false even when all 16 are 3★
    const p3dAll = createDefaultProgress(LEVELS.length);
    p3dAll.bestStars.fill(3);
    p3dAll.clears.fill(1);
    const earned3d = new Set(earnedSteamAchievementIds(p3dAll, LEVELS));
    expect(earned3d.has('FEAT_FULL_FIRMAMENT')).toBe(true);
    expect(earned3d.has('CHAPTER_THREE_LANDING')).toBe(false);
    expect(earned3d.has('CHAPTER_THREE_CLEARED')).toBe(false);
    expect(earned3d.has('BOSS_I24_CLEARED')).toBe(false);
    expect(earned3d.has('STARS_ALL_ISLANDS')).toBe(false);

    // All islands 3★
    for (let i = 0; i < LEVELS_2D.length; i++) {
      pCh2.clears[i] = 1;
      pCh2.bestStars[i] = 3;
    }
    earned = new Set(earnedSteamAchievementIds(pCh2, LEVELS_2D));
    expect(earned.has('FEAT_FULL_FIRMAMENT')).toBe(true);
    expect(earned.has('STARS_ALL_ISLANDS')).toBe(true);
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
    // Raw difficultyWins-only saves also satisfy BOSS_I24_CLEARED & CHAPTER_THREE_LANDING without mutating input.
    expect(atHardBoss).toContain('BOSS_I24_CLEARED');
    expect(atHardBoss).toContain('CHAPTER_THREE_LANDING');
    expect(pHard.clears[i24Idx]).toBe(0);
    expect(atHardBoss).not.toContain('HARD_ALL_ISLANDS');

    pHard.difficultyWins.hard.fill(3);
    const atHardAll3 = earnedSteamAchievementIds(pHard, LEVELS_2D);
    expect(atHardAll3).toContain('HARD_ALL_ISLANDS');
    expect(atHardAll3).toContain('STARS_ALL_ISLANDS');
    expect(atHardAll3).toContain('CHAPTER_THREE_THREE_STARS');

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

    // 3. Reset cancellation: resetProgress2D() while initial boot cloudRead is in flight never resurrects erased save
    // or pollutes localStorage's cloud mirror with the pre-reset remote snapshot.
    localStore.clear();
    let resolveSlowRead: (() => void) | null = null;
    const resetCloud = new Map<string, string>(newPcCloud);
    const slowAdapter = createPlatformAdapter({
      bridge: {
        isSteam: true,
        unlockAchievement: async () => true,
        cloudRead: (slot) => {
          const snapshotBeforeReset = resetCloud.get(slot) ?? null;
          return new Promise<string | null>((res) => {
            resolveSlowRead = () => res(snapshotBeforeReset);
          });
        },
        cloudWrite: async (slot, json) => {
          resetCloud.set(slot, json);
          return true;
        },
      },
    });
    setPlatformAdapter(slowAdapter);

    loadProgress2D(LEVELS_2D); // starts slow boot cloudRead capturing pre-reset remote snapshot
    expect(resolveSlowRead).not.toBeNull();
    resetProgress2D(LEVELS_2D); // user resets while boot cloudRead is still pending!
    resolveSlowRead!();
    await new Promise((r) => setTimeout(r, 15));

    expect(localStorage.getItem(PROGRESS_2D_KEY)).toBeNull();
    expect(recoverProgress2D(LEVELS_2D, { persist: false }).recovered).toBe(false);
    const afterResetCloud = JSON.parse(resetCloud.get(CLOUD_PROGRESS_2D_SLOT) ?? '{}') as {
      progress: { bestStars: number[] };
    };
    expect(afterResetCloud.progress.bestStars.every((s) => s === 0)).toBe(true);
    setPlatformAdapter(null);
  });

  it('hardens 3D Steam Cloud in-flight concurrency, reset cancellation, and corrupt-primary cloud-mirror recovery', async () => {
    // 1. Concurrent saveProgress() while hydrateProgressFromCloud() is awaiting cloudRead merges both without clobbering remote.
    let resolveRead: (() => void) | null = null;
    const remoteSave = createDefaultProgress(LEVELS.length);
    remoteSave.bestStars[3] = 3;
    remoteSave.clears[3] = 1;
    let remoteBlob: string | null = JSON.stringify(remoteSave);

    const adapter = createPlatformAdapter({
      bridge: {
        isSteam: true,
        unlockAchievement: async () => true,
        cloudRead: () => {
          const snap = remoteBlob;
          return new Promise<string | null>((res) => {
            resolveRead = () => res(snap);
          });
        },
        cloudWrite: async (_slot, json) => {
          remoteBlob = json;
          return true;
        },
      },
    });
    setPlatformAdapter(adapter);

    const hydratePromise = hydrateProgressFromCloud(
      createDefaultProgress(LEVELS.length),
      LEVELS.length,
      adapter,
      LEVELS,
    );
    expect(resolveRead).not.toBeNull();

    // Player wins L1 while cloudRead is still pending -> must NOT overwrite remoteBlob's L4=3★!
    const concurrentWin = createDefaultProgress(LEVELS.length);
    concurrentWin.bestStars[0] = 2;
    concurrentWin.clears[0] = 1;
    saveProgress(concurrentWin);
    expect(JSON.parse(remoteBlob ?? '{}').bestStars[3]).toBe(3);

    resolveRead!();
    const res = await hydratePromise;
    expect(res.merged.bestStars[0]).toBe(2);
    expect(res.merged.bestStars[3]).toBe(3);
    expect(loadProgress(LEVELS.length).bestStars[0]).toBe(2);
    expect(loadProgress(LEVELS.length).bestStars[3]).toBe(3);
    expect(JSON.parse(remoteBlob ?? '{}').bestStars[0]).toBe(2);
    expect(JSON.parse(remoteBlob ?? '{}').bestStars[3]).toBe(3);

    // 2. Corrupt primary PROGRESS_KEY falls back to valid local cloud mirror automatically on loadProgress().
    localStorage.setItem('skyhold_isles_progress_v1', '{{{unparseable-corrupt');
    const recoveredFromMirror = loadProgress(LEVELS.length);
    expect(recoveredFromMirror.bestStars[0]).toBe(2);
    expect(recoveredFromMirror.bestStars[3]).toBe(3);

    // 3. resetProgressSave() while hydrateProgressFromCloud() is in flight cancels hydration and clears local cloud mirror.
    let resolveSlow3d: (() => void) | null = null;
    const slow3dAdapter = createPlatformAdapter({
      bridge: {
        isSteam: true,
        unlockAchievement: async () => true,
        cloudRead: () => {
          const snap = remoteBlob;
          return new Promise<string | null>((r) => {
            resolveSlow3d = () => r(snap);
          });
        },
        cloudWrite: async (_slot, json) => {
          remoteBlob = json;
          return true;
        },
      },
    });
    setPlatformAdapter(slow3dAdapter);
    const resetHydratePromise = hydrateProgressFromCloud(
      loadProgress(LEVELS.length),
      LEVELS.length,
      slow3dAdapter,
      LEVELS,
    );
    resetProgressSave(LEVELS.length);
    resolveSlow3d!();
    const resetHydrateRes = await resetHydratePromise;
    expect(resetHydrateRes.updated).toBe(false);
    expect(loadProgress(LEVELS.length).bestStars.every((s) => s === 0)).toBe(true);
    expect(recoverProgressSave(LEVELS.length, { persist: false }).recovered).toBe(false);
    expect(recoverProgressSave(LEVELS.length, { includeResetBackup: true, persist: false }).recovered).toBe(true);
    setPlatformAdapter(null);
  });

  it('mutates World Map boot ProgressData in-place on Steam Cloud arrival, guards pre-hydration clones, and preserves intentional respec/refund', async () => {
    const cloudMap = new Map<string, string>();
    const remote = createDefaultProgress(LEVELS_2D.length);
    remote.bestStars.fill(3);
    remote.clears.fill(1);
    remote.unlockedLevelIndex = LEVELS_2D.length - 1;
    remote.workshop = { treasury: 2 };
    remote.heroes = createFreshHeroSaveData();
    remote.heroes.selectedHero = 'mira';
    remote.heroes.roster.mira = { xp: HERO_LEVEL_XP[19], skills: ['mira_emb_1', 'mira_rng_1'] };
    cloudMap.set(
      CLOUD_PROGRESS_2D_SLOT,
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: remote }),
    );

    const adapter = createPlatformAdapter({
      storage: createMemStorage(),
      bridge: {
        isSteam: true,
        unlockAchievement: async () => true,
        cloudRead: async (slot) => cloudMap.get(slot) ?? null,
        cloudWrite: async (slot, json) => {
          cloudMap.set(slot, json);
          return true;
        },
      },
    });
    setPlatformAdapter(adapter);

    let notifiedCount = 0;
    const unsub = onProgress2DCloudHydrated(() => {
      notifiedCount++;
    });

    try {
      // Simulate World Map holding `bootProgress` across background Steam Cloud hydration,
      // PLUS a pre-hydration clone (`preClone`) created before cloudRead resolves.
      const bootProgress = loadProgress2D(LEVELS_2D);
      const preClone = selectHero(bootProgress, 'bran', LEVELS_2D)!;
      expect(bootProgress.bestStars[0]).toBe(0);

      await new Promise((r) => setTimeout(r, 15));
      expect(notifiedCount).toBe(1);
      // In-place update populated World Map's `bootProgress` directly!
      expect(bootProgress.bestStars[24]).toBe(3);
      expect(bootProgress.heroes?.selectedHero).toBe('mira');
      expect(bootProgress.heroes?.roster.mira?.xp).toBe(HERO_LEVEL_XP[19]);
      expect(bootProgress.workshop).toEqual({ treasury: 2 });

      // Saving the stale pre-hydration clone right after hydration folds in the cloud floor instead of wiping 75★!
      saveProgress2D(preClone, LEVELS_2D);
      await new Promise((r) => setTimeout(r, 10));
      const afterStaleSave = loadProgress2D(LEVELS_2D);
      expect(afterStaleSave.bestStars.every((s) => s === 3)).toBe(true);
      expect(afterStaleSave.heroes?.roster.mira?.xp).toBe(HERO_LEVEL_XP[19]);
      expect(afterStaleSave.heroes?.roster.mira?.skills).toEqual(['mira_emb_1', 'mira_rng_1']);
      expect(afterStaleSave.workshop).toEqual({ treasury: 2 });

      // Intentional post-hydration Workshop Refund & Hero Respec still clear ranks/skills cleanly!
      afterStaleSave.workshop = {};
      saveProgress2D(afterStaleSave, LEVELS_2D);
      const respecced = respec(loadProgress2D(LEVELS_2D), 'mira', LEVELS_2D);
      saveProgress2D(respecced, LEVELS_2D);
      const finalLoaded = loadProgress2D(LEVELS_2D);
      expect(finalLoaded.workshop).toEqual({});
      expect(finalLoaded.heroes?.roster.mira?.xp).toBe(HERO_LEVEL_XP[19]);
      expect(finalLoaded.heroes?.roster.mira?.skills).toEqual([]);
      expect(finalLoaded.bestStars.every((s) => s === 3)).toBe(true);
    } finally {
      unsub();
      setPlatformAdapter(null);
    }
  });

  it('unlocks CHALLENGE_STATIC_FREE on 2D Daily Squall / non-badge challenge wins without inflating starWallet, and clamps oversized star arrays', () => {
    const p = createDefaultProgress(LEVELS_2D.length);

    // Offered badge win ('bowless' on l1c) keeps wonChallenges undefined.
    applyRunResult2D(
      p,
      {
        levelId: 'l1c',
        won: true,
        stars: 3,
        livesRemaining: 18,
        waveReached: LEVELS_2D[0].waves.length,
        runConfig: { endless: false, challenges: ['bowless'], daily: null },
      },
      LEVELS_2D,
    );
    expect(p.wonChallenges).toBeUndefined();
    expect(p.challengeClears[0]).toEqual(['bowless']);
    const walletBeforeDaily = starWallet(p);
    expect(walletBeforeDaily.earned).toBe(4); // 3★ + 1 bowless badge

    // Daily Squall win on l1c with ['staticFree', 'championHost']: staticFree is not in DEFAULT_BY_DIFFICULTY,
    // so it grants NO extra island badge star, yet MUST unlock CHALLENGE_STATIC_FREE ("Still Air")!
    const day = 20777;
    applyRunResult2D(
      p,
      {
        levelId: 'l1c',
        won: true,
        stars: 3,
        livesRemaining: 18,
        waveReached: LEVELS_2D[0].waves.length,
        runConfig: { endless: false, challenges: ['staticFree', 'championHost'], daily: day },
        nowMs: day * 86_400_000 + 3_600_000,
      },
      LEVELS_2D,
    );
    expect(p.challengeClears[0]).toEqual(['bowless']);
    expect(starWallet(p).earned).toBe(5); // +1 Daily star only (no extra badge inflation!)
    expect(p.wonChallenges).toEqual(['staticFree', 'championHost']);
    expect(earnedSteamAchievementIds(p, LEVELS_2D)).toContain('CHALLENGE_STATIC_FREE');

    // Survives SKY2-... save code round-trip and island-list remapping.
    const code = encodeSaveCode2D(p, LEVELS_2D);
    const decoded = decodeSaveCode2D(code, LEVELS_2D);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.progress.wonChallenges).toEqual(['staticFree', 'championHost']);
      expect(earnedSteamAchievementIds(decoded.progress, LEVELS_2D)).toContain('CHALLENGE_STATIC_FREE');
      const remapped = remapProgress(
        decoded.progress,
        LEVELS_2D.map((l) => l.id),
        [...LEVELS_2D].reverse(),
      );
      expect(earnedSteamAchievementIds(remapped, [...LEVELS_2D].reverse())).toContain('CHALLENGE_STATIC_FREE');
    }

    // Oversized bestStars array (e.g. 25-island save evaluated against 16-island roster) must not count tail stars toward FEAT_FULL_FIRMAMENT.
    const oversized = createDefaultProgress(25);
    for (let i = 0; i < 15; i++) oversized.bestStars[i] = 3; // 45/48 stars on first 16 islands
    oversized.bestStars[15] = 0;
    for (let i = 16; i < 25; i++) oversized.bestStars[i] = 3; // +27 stars in tail [16..24]
    expect(earnedSteamAchievementIds(oversized, LEVELS)).not.toContain('FEAT_FULL_FIRMAMENT');
  });

  it('guards remote Steam Cloud saves during cloudRead failures and protects 3D first-write-before-hydrate', async () => {
    const cloudMap = new Map<string, string>();
    const remote2D = createDefaultProgress(LEVELS_2D.length);
    remote2D.bestStars.fill(3);
    remote2D.clears.fill(1);
    remote2D.unlockedLevelIndex = LEVELS_2D.length - 1;
    cloudMap.set(
      CLOUD_PROGRESS_2D_SLOT,
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: remote2D }),
    );

    const remote3D = createDefaultProgress(LEVELS.length);
    remote3D.bestStars.fill(3);
    remote3D.clears.fill(1);
    remote3D.unlockedLevelIndex = LEVELS.length - 1;
    cloudMap.set(CLOUD_PROGRESS_SLOT, JSON.stringify(remote3D));

    let failRemoteRead = true;
    let cloudWriteCalls = 0;
    const adapter = createPlatformAdapter({
      storage: createMemStorage(),
      bridge: {
        isSteam: true,
        unlockAchievement: async () => true,
        cloudRead: async (slot) => {
          if (failRemoteRead) throw new Error('Transient Steamworks Cloud read failure');
          return cloudMap.get(slot) ?? null;
        },
        cloudWrite: async (slot, json) => {
          cloudWriteCalls++;
          cloudMap.set(slot, json);
          return true;
        },
      },
    });
    setPlatformAdapter(adapter);

    // Seed 1-island local saves on both 2D and 3D without any local cloud mirror.
    const local2D = createDefaultProgress(LEVELS_2D.length);
    local2D.bestStars[0] = 1;
    local2D.clears[0] = 1;
    saveLocalProgress2D(local2D, LEVELS_2D);

    const local3D = createDefaultProgress(LEVELS.length);
    local3D.bestStars[0] = 1;
    local3D.clears[0] = 1;
    saveLocalProgress(local3D);

    // 1. Failing cloudRead must NOT be treated as "empty cloud" and must NEVER overwrite remote 25★/16★ saves!
    await hydrateProgress2DFromCloud(local2D, LEVELS_2D, adapter);
    await hydrateProgressFromCloud(local3D, LEVELS.length, adapter, LEVELS);
    expect(adapter.cloudSave.didLastReadFail?.(CLOUD_PROGRESS_2D_SLOT)).toBe(true);
    expect(adapter.cloudSave.didLastReadFail?.(CLOUD_PROGRESS_SLOT)).toBe(true);
    expect(cloudWriteCalls).toBe(0);
    expect(
      (JSON.parse(cloudMap.get(CLOUD_PROGRESS_2D_SLOT) ?? '{}') as { progress: { bestStars: number[] } })
        .progress.bestStars[24],
    ).toBe(3);
    expect((JSON.parse(cloudMap.get(CLOUD_PROGRESS_SLOT) ?? '{}') as { bestStars: number[] }).bestStars[15]).toBe(3);

    // 2. Once Steam Cloud recovers, saveProgress2D() & saveProgress() hydrate + merge instead of clobbering!
    failRemoteRead = false;
    local2D.bestLives[0] = 20;
    saveProgress2D(local2D, LEVELS_2D);
    local3D.bestLives[0] = 19;
    saveProgress(local3D);
    await new Promise((r) => setTimeout(r, 20));

    expect(adapter.cloudSave.didLastReadFail?.(CLOUD_PROGRESS_2D_SLOT)).toBe(false);
    expect(adapter.cloudSave.didLastReadFail?.(CLOUD_PROGRESS_SLOT)).toBe(false);
    const merged2D = loadProgress2D(LEVELS_2D);
    expect(merged2D.bestStars[24]).toBe(3);
    expect(merged2D.bestLives[0]).toBe(20);
    const merged3D = loadProgress(LEVELS.length);
    expect(merged3D.bestStars[15]).toBe(3);
    expect(merged3D.bestLives[0]).toBe(19);
    setPlatformAdapter(null);
  });

  it('performs exact 3-way merge for pre-hydration clones on non-empty second PCs while honoring intentional edits', async () => {
    const cloudMap = new Map<string, string>();
    // Desktop A already has 5 islands (15★), treasury:1, Bran L5 with 1 skill, selectedHero='bran'.
    const desktopLocal = createDefaultProgress(LEVELS_2D.length);
    for (let i = 0; i < 5; i++) {
      desktopLocal.bestStars[i] = 3;
      desktopLocal.clears[i] = 1;
    }
    desktopLocal.unlockedLevelIndex = 5;
    desktopLocal.workshop = { treasury: 1 };
    desktopLocal.heroes = createFreshHeroSaveData();
    desktopLocal.heroes.selectedHero = 'bran';
    desktopLocal.heroes.roster.bran = { xp: HERO_LEVEL_XP[4], skills: ['bran_oak_1'] };
    saveLocalProgress2D(desktopLocal, LEVELS_2D);

    // Steam Deck B advanced to 20 islands (60★), treasury:2 + bastion:2, Bran L15 (3 skills), Mira L20, selectedHero='mira'.
    const deckRemote = createDefaultProgress(LEVELS_2D.length);
    for (let i = 0; i < 20; i++) {
      deckRemote.bestStars[i] = 3;
      deckRemote.clears[i] = 1;
    }
    deckRemote.unlockedLevelIndex = 20;
    deckRemote.workshop = { treasury: 2, bastion: 2 };
    deckRemote.heroes = createFreshHeroSaveData();
    deckRemote.heroes.selectedHero = 'mira';
    deckRemote.heroes.roster.bran = {
      xp: HERO_LEVEL_XP[14],
      skills: ['bran_oak_1', 'bran_oak_2', 'bran_oak_3'],
    };
    deckRemote.heroes.roster.mira = {
      xp: HERO_LEVEL_XP[19],
      skills: ['mira_emb_1', 'mira_rng_1'],
    };
    cloudMap.set(
      CLOUD_PROGRESS_2D_SLOT,
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: deckRemote }),
    );

    const adapter = createPlatformAdapter({
      storage: createMemStorage(),
      bridge: {
        isSteam: true,
        unlockAchievement: async () => true,
        cloudRead: async (slot) => cloudMap.get(slot) ?? null,
        cloudWrite: async (slot, json) => {
          cloudMap.set(slot, json);
          return true;
        },
      },
    });
    setPlatformAdapter(adapter);

    const boot = loadProgress2D(LEVELS_2D);
    // Stale pre-hydration clone taken BEFORE cloud hydration resolved (even though Desktop A had 15★ > 0 and Bran XP > 0!):
    const staleClone: typeof boot = {
      ...boot,
      bestStars: [...boot.bestStars],
      workshop: { ...boot.workshop },
    };
    await new Promise((r) => setTimeout(r, 15));

    saveProgress2D(staleClone, LEVELS_2D);
    const saved = loadProgress2D(LEVELS_2D);
    expect(saved.bestStars[19]).toBe(3);
    expect(saved.workshop).toEqual({ treasury: 2, bastion: 2 });
    expect(saved.heroes?.selectedHero).toBe('mira');
    expect(saved.heroes?.roster.bran?.skills).toEqual(['bran_oak_1', 'bran_oak_2', 'bran_oak_3']);
    expect(saved.heroes?.roster.mira?.skills).toEqual(['mira_emb_1', 'mira_rng_1']);
    setPlatformAdapter(null);
  });

  it('notifies ContentDirector on 3D Steam Cloud hydration, preserves mid-hydrate Workshop refund, and scales HUD earlyBonus', async () => {
    // 1. buildHudStateView scales earlyBonus with waveBonusMul (matching SimWorld.scaleWaveBonus).
    const events = new EventBus();
    const halfBonusWorld = new SimWorld(
      LEVELS[0],
      events,
      combineRunModifiers({ waveBonusMul: 0.5 }),
    );
    halfBonusWorld.startNextWave();
    // Advance until wave 1 finishes spawning ('clearing') so early-call bonus is active.
    for (let i = 0; i < 600 && halfBonusWorld.waveSystem.state === 'spawning'; i++) {
      halfBonusWorld.fixedTick(1 / 60);
    }
    expect(halfBonusWorld.waveSystem.canStartNextWave()).toBe(true);
    const rawEarly = halfBonusWorld.waveSystem.getEarlyCallBonus();
    expect(rawEarly).toBeGreaterThan(0);
    const hudView = buildHudStateView(halfBonusWorld, { speed: 1, paused: false } as never, false);
    expect(hudView.earlyBonus).toBe(Math.round(rawEarly * 0.5));
    halfBonusWorld.dispose();

    // 2. GameSession Steam Cloud hydration calls content.onProgressImported and preserves mid-hydrate refundWorkshop().
    const localWithWs = createDefaultProgress(LEVELS.length);
    localWithWs.bestStars[0] = 3;
    localWithWs.clears[0] = 1;
    localWithWs.workshop = { treasury: 1 };
    saveLocalProgress(localWithWs);

    const remote3D = createDefaultProgress(LEVELS.length);
    for (let i = 0; i < 6; i++) {
      remote3D.bestStars[i] = 3;
      remote3D.clears[i] = 1;
    }
    remote3D.unlockedLevelIndex = 6;
    remote3D.workshop = { treasury: 2, bastion: 1 };
    let resolveCloud: (() => void) | null = null;
    let remoteBlob = JSON.stringify(remote3D);

    const adapter = createPlatformAdapter({
      storage: createMemStorage(),
      bridge: {
        isSteam: true,
        unlockAchievement: async () => true,
        cloudRead: () =>
          new Promise<string | null>((res) => {
            resolveCloud = () => res(remoteBlob);
          }),
        cloudWrite: async (_slot, json) => {
          remoteBlob = json;
          return true;
        },
      },
    });
    setPlatformAdapter(adapter);

    const mockRw = {
      setQuality: () => {},
      setPlacementPreview: () => {},
      setPlacementGridActive: () => {},
      setFlightPathHighlight: () => {},
      setRoutesPinned: () => {},
      setHoveredTowerId: () => {},
      setCanvasCursor: () => {},
      setMeteorTargetPreview: () => {},
      overlayIndicators: { setSelectedTowerRing: () => {} },
      cameraController: { setShowcaseMode: () => {}, getViewVersion: () => 0 },
    };
    const mockSm = {
      unlock: () => {},
      bindEvents: () => () => {},
      setMusicDucked: () => {},
      setMusicContext: () => {},
      playUiConfirm: () => {},
      playUiBack: () => {},
      playStarChime: () => {},
      playBossPulse: () => {},
      suspendForBackground: () => {},
      resumeFromBackground: () => {},
      updateSettings: () => {},
    };
    let importedAdoptedStars = 0;
    const gs = new GameSession(mockRw as never, mockSm as never);
    gs.attachRuntime({
      overlays: {
        isModalOpen: () => false,
        setPlayVisibility: () => {},
        syncInPlay: () => {},
        closeModals: () => {},
        mainMenu: { setOpen: () => {} },
        levelSelect: { setOpen: () => {} },
        workshop: { setOpen: () => {} },
        toast: { show: () => {}, hide: () => {}, update: () => {} },
        tooltip: { hide: () => {} },
        floatingTextPool: { clear: () => {}, update: () => {} },
        towerPanel: { setSellConfirmArmed: () => {} },
        pauseMenu: { isOpen: () => false, setOpen: () => {} },
        settingsModal: { isOpen: () => false, setOpen: () => {} },
        outcomeOverlay: { isOpen: () => false },
        islandBriefing: { isOpen: () => false },
        logbook: { isOpen: () => false },
        daily: { isOpen: () => false },
      } as never,
      inputManager: { setEnabled: () => {}, setModalOpen: () => {} } as never,
      loop: { speed: 1, paused: false, simActive: false, resetAccumulator: () => {}, cycleSpeed: () => 2 } as never,
      setDebugVisible: () => {},
      content: {
        isBlocking: () => false,
        observe: () => {},
        onLeavePlay: () => {},
        onLevelWon: () => {},
        bindLevel: () => {},
        updateMarker: () => {},
        onProgressImported: (_lvls: unknown, prog: { bestStars: number[] }) => {
          importedAdoptedStars = prog.bestStars.reduce((a, b) => a + b, 0);
        },
      } as never,
    });

    // User clicks Refund All in Workshop while cloudRead is still pending:
    gs.refundWorkshop();
    expect(gs.progress.workshop).toEqual({});

    resolveCloud!();
    await new Promise((r) => setTimeout(r, 20));

    expect(gs.progress.unlockedLevelIndex).toBe(6);
    expect(gs.progress.bestStars.slice(0, 6)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(gs.progress.workshop).toEqual({}); // Refund was NOT clobbered by remote { treasury: 2, bastion: 1 }!
    expect(importedAdoptedStars).toBe(18); // ContentDirector adopted all 6 cleared cloud islands!

    // Importing a 25-island 2D save code into 3D preserves source-affordable Workshop upgrades when 3D wallet affords them:
    const rich2D = createDefaultProgress(LEVELS_2D.length);
    for (let i = 16; i < 22; i++) {
      rich2D.bestStars[i] = 3; // 18★ earned in Chapter Two (indices 16..21)
      rich2D.clears[i] = 1;
    }
    rich2D.workshop = { treasury: 2, bastion: 2 }; // 8★ <= 18★ on 2D save, and <= 18★ on gs.progress!
    const code2D = encodeSaveCode2D(rich2D, LEVELS_2D);
    const importRes = gs.importSaveCode(code2D);
    expect(importRes.ok).toBe(true);
    expect(gs.progress.workshop).toEqual({ treasury: 2, bastion: 2 });

    gs.dispose();
    setPlatformAdapter(null);
  });

  it('keeps pre-hydration 2D clones protected across read-only exportSaveCode2D / loadProgress2D calls and normalizes raw ProgressData for achievements', async () => {
    const cloudMap = new Map<string, string>();
    const cloudProgress = createDefaultProgress(LEVELS_2D.length);
    for (let i = 0; i < 10; i++) {
      cloudProgress.bestStars[i] = 3;
      cloudProgress.clears[i] = 1;
    }
    cloudProgress.unlockedLevelIndex = 10;
    cloudProgress.workshop = { treasury: 2 };
    cloudProgress.heroes = {
      selectedHero: 'mira',
      roster: {
        bran: { xp: 100, skills: [] },
        wren: { xp: 0, skills: [] },
        mira: { xp: HERO_LEVEL_XP[11], skills: ['mira_emb_1'] },
        tobb: { xp: 0, skills: [] },
        sela: { xp: 0, skills: [] },
      },
    };
    cloudMap.set(
      'progress2d',
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: cloudProgress }),
    );

    const adapter = createPlatformAdapter({
      bridge: {
        isSteam: true,
        appId: 480,
        unlockAchievement: async () => true,
        cloudRead: async (slot) => {
          await new Promise((r) => setTimeout(r, 8));
          return cloudMap.get(slot) ?? null;
        },
        cloudWrite: async (slot, json) => {
          cloudMap.set(slot, json);
          return true;
        },
      },
    });
    setPlatformAdapter(adapter);

    try {
      const boot = loadProgress2D(LEVELS_2D);
      const shallowStale = selectHero(boot, 'bran', LEVELS_2D)!;
      const deepStale: ProgressData = JSON.parse(JSON.stringify(boot));
      deepStale.heroes!.roster.bran = { xp: 600, skills: [] };

      await new Promise((r) => setTimeout(r, 20));
      expect(boot.bestStars[9]).toBe(3);

      // Read-only calls after hydration must NOT clear pre-hydration clone protection!
      const exported = encodeSaveCode2D(loadProgress2D(LEVELS_2D), LEVELS_2D);
      expect(exported.startsWith('SKY2-')).toBe(true);

      saveProgress2D(shallowStale, LEVELS_2D);
      saveProgress2D(deepStale, LEVELS_2D);

      const afterBoth = loadProgress2D(LEVELS_2D);
      expect(afterBoth.bestStars.slice(0, 10)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
      expect(afterBoth.workshop).toEqual({ treasury: 2 });
      expect(afterBoth.heroes?.roster.mira?.xp).toBe(HERO_LEVEL_XP[11]);
      expect(afterBoth.heroes?.roster.bran?.xp).toBe(600);

      // Authoritative post-hydration refund still clears workshop cleanly:
      afterBoth.workshop = {};
      saveProgress2D(afterBoth, LEVELS_2D);
      expect(loadProgress2D(LEVELS_2D).workshop).toEqual({});
    } finally {
      setPlatformAdapter(null);
    }

    // Raw/malformed ProgressData normalization in earnedSteamAchievementIds:
    const malformed = {
      version: 2,
      unlockedLevelIndex: 0,
      bestStars: undefined,
      clears: [15, Number.NaN, 20],
      bestEndlessWaves: undefined,
      challengeClears: undefined,
      workshop: {},
      daily: { lastDay: 100, streak: 7, bestStreak: 0, total: 7 },
    } as unknown as ProgressData;
    const earned = earnedSteamAchievementIds(malformed, LEVELS_2D);
    expect(earned).toContain('DAILY_STREAK_7');
    expect(earned).toContain('FEAT_STEADY_WINDS'); // 3-day streak consistent with streak=7!
    expect(earned).toContain('FEAT_SQUALL_RIDER');
    expect(earned).toContain('FEAT_VETERAN'); // 15 + 20 = 35 >= 30 wins even with NaN at index 1!
  });

  it('preserves concurrent Workshop Refund, Hero Respec, and Hero Select -> Bran during an in-flight Steam Cloud read (2D & 3D)', async () => {
    const { respec } = await import('../../src/render2d/heroes2d.ts');
    const { saveLocalProgress } = await import('../../src/platform/storage.ts');

    // Seed local 2D save: 10 islands 3★ (30★), treasury:2, Sela selected, Mira L12 with unlocked skill.
    const localInit = createDefaultProgress(LEVELS_2D.length);
    for (let i = 0; i < 10; i++) {
      localInit.bestStars[i] = 3;
      localInit.clears[i] = 1;
    }
    localInit.unlockedLevelIndex = 10;
    localInit.workshop = { treasury: 2 };
    localInit.heroes = {
      selectedHero: 'sela',
      roster: {
        bran: { xp: 250, skills: [] },
        wren: { xp: 0, skills: [] },
        mira: { xp: HERO_LEVEL_XP[11], skills: ['mira_emb_1'] },
        tobb: { xp: 0, skills: [] },
        sela: { xp: HERO_LEVEL_XP[9], skills: [] },
      },
    };
    localStore.set(
      PROGRESS_2D_KEY,
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: localInit }),
    );

    // Remote Steam Cloud ALSO has treasury:2, Sela selected, Mira with mira_emb_1 + higher XP (L15) + extra 3★ on island 12:
    const remote2D = JSON.parse(JSON.stringify(localInit)) as ProgressData;
    remote2D.bestStars[12] = 3;
    remote2D.clears[12] = 1;
    remote2D.heroes!.roster.mira = { xp: HERO_LEVEL_XP[14], skills: ['mira_emb_1'] };

    const cloudMap = new Map<string, string>();
    cloudMap.set(
      CLOUD_PROGRESS_2D_SLOT,
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: remote2D }),
    );

    let resolveRead2D: (() => void) | null = null;
    const adapter2D = createPlatformAdapter({
      bridge: {
        isSteam: true,
        appId: 480,
        unlockAchievement: async () => true,
        cloudRead: (slot) => {
          const snap = cloudMap.get(slot) ?? null;
          return new Promise<string | null>((res) => {
            resolveRead2D = () => res(snap);
          });
        },
        cloudWrite: async (slot, json) => {
          cloudMap.set(slot, json);
          return true;
        },
      },
    });
    setPlatformAdapter(adapter2D);

    try {
      const boot = loadProgress2D(LEVELS_2D);
      expect(resolveRead2D).not.toBeNull();

      // WHILE cloudRead(progress2d) is still in flight, player:
      // 1) Refunds Workshop, 2) Respecs Mira (immutable clone), 3) Switches selectedHero from Sela -> Bran!
      boot.workshop = {};
      const afterRespec = respec(boot, 'mira', LEVELS_2D);
      const afterSelect = selectHero(afterRespec, 'bran', LEVELS_2D)!;
      saveProgress2D(afterSelect, LEVELS_2D);

      resolveRead2D!();
      await new Promise((r) => setTimeout(r, 20));

      const final2D = loadProgress2D(LEVELS_2D);
      expect(final2D.bestStars[12]).toBe(3); // remote i12 3★ merged!
      expect(final2D.heroes?.roster.mira?.xp).toBe(HERO_LEVEL_XP[14]); // remote Mira L15 XP merged!
      expect(final2D.workshop).toEqual({}); // Workshop Refund preserved!
      expect(final2D.heroes?.roster.mira?.skills).toEqual([]); // Mira Respec preserved!
      expect(final2D.heroes?.selectedHero).toBe('bran'); // Switch to Bran preserved!

      const writtenCloud2D = JSON.parse(cloudMap.get(CLOUD_PROGRESS_2D_SLOT)!) as {
        progress: ProgressData;
      };
      expect(writtenCloud2D.progress.workshop).toEqual({});
      expect(writtenCloud2D.progress.heroes?.roster.mira?.skills).toEqual([]);
      expect(writtenCloud2D.progress.heroes?.selectedHero).toBe('bran');
      expect(writtenCloud2D.progress.bestStars[12]).toBe(3);

      // 3D hydrateProgressFromCloud also preserves a concurrent Workshop Refund during cloudRead('progress'):
      localStore.clear();
      const local3D = createDefaultProgress(LEVELS.length);
      for (let i = 0; i < 6; i++) {
        local3D.bestStars[i] = 3;
        local3D.clears[i] = 1;
      }
      local3D.workshop = { treasury: 2 };
      saveLocalProgress(local3D);

      const remote3D = JSON.parse(JSON.stringify(local3D)) as ProgressData;
      remote3D.bestStars[7] = 3;
      remote3D.clears[7] = 1;
      cloudMap.set('progress', JSON.stringify(remote3D));

      let resolveRead3D: (() => void) | null = null;
      const adapter3D = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          unlockAchievement: async () => true,
          cloudRead: (slot) => {
            const snap = cloudMap.get(slot) ?? null;
            return new Promise<string | null>((res) => {
              resolveRead3D = () => res(snap);
            });
          },
          cloudWrite: async (slot, json) => {
            cloudMap.set(slot, json);
            return true;
          },
        },
      });
      setPlatformAdapter(adapter3D);

      const p3dPromise = hydrateProgressFromCloud(local3D, LEVELS.length, adapter3D, LEVELS);
      expect(resolveRead3D).not.toBeNull();
      // Player refunds 3D Workshop while cloudRead('progress') is pending:
      local3D.workshop = {};
      saveLocalProgress(local3D);
      resolveRead3D!();

      const res3D = await p3dPromise;
      expect(res3D.merged.bestStars[7]).toBe(3);
      expect(res3D.merged.workshop).toEqual({});
      expect(JSON.parse(cloudMap.get('progress')!).workshop).toEqual({});
    } finally {
      setPlatformAdapter(null);
    }
  });

  it('preserves hero respec+branch-switch, Workshop refund+rebuy, cloudSave.write JSON validation, and full resetProgress2D keys', async () => {
    try {
      const cloudMap = new Map<string, string>();
      let resolveRead2D: (() => void) | null = null;
      const adapter2D = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          unlockAchievement: async () => true,
          cloudRead: (slot) => {
            const snap = cloudMap.get(slot) ?? null;
            return new Promise<string | null>((res) => {
              resolveRead2D = () => res(snap);
            });
          },
          cloudWrite: async (slot, json) => {
            cloudMap.set(slot, json);
            return true;
          },
        },
      });
      setPlatformAdapter(adapter2D);

      // 1. Hero respec + branch-switch ('bran_van_1' -> 'bran_iron_1') AND Workshop refund + re-buy
      //    ({ quickcast: 1 } -> { bounty: 1 }, both 2★) while cloudRead('progress2d') is pending:
      //    lexicographic order ("bran_van_1" > "bran_iron_1", "quickcast" > "bounty") must NOT revert either!
      const base2D = createDefaultProgress(LEVELS_2D.length);
      base2D.bestStars[0] = 2;
      base2D.clears[0] = 1;
      base2D.unlockedLevelIndex = 1;
      base2D.workshop = { quickcast: 1 };
      base2D.heroes = {
        selectedHero: 'bran',
        roster: {
          bran: { xp: HERO_LEVEL_XP[1], skills: ['bran_van_1'] }, // L2 -> 1 skill point budget
        },
      };
      saveLocalProgress2D(base2D, LEVELS_2D);

      const remote2D = createDefaultProgress(LEVELS_2D.length);
      remote2D.bestStars[0] = 2;
      remote2D.clears[0] = 1;
      remote2D.unlockedLevelIndex = 1;
      remote2D.workshop = { quickcast: 1 };
      remote2D.heroes = {
        selectedHero: 'bran',
        roster: {
          bran: { xp: HERO_LEVEL_XP[1], skills: ['bran_van_1'] },
        },
      };
      cloudMap.set(
        CLOUD_PROGRESS_2D_SLOT,
        JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: remote2D }),
      );

      const boot2D = loadProgress2D(LEVELS_2D);
      expect(resolveRead2D).not.toBeNull();

      // Player respecs Bran -> 'bran_iron_1' and refunds Workshop -> { bounty: 1 } mid-hydration:
      let midEdit = respec(boot2D, 'bran', LEVELS_2D);
      midEdit = applyNode(midEdit, 'bran', 'bran_iron_1', LEVELS_2D)!;
      midEdit.workshop = { bounty: 1 };
      saveProgress2D(midEdit, LEVELS_2D);

      resolveRead2D!();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      const after2D = loadProgress2D(LEVELS_2D);
      expect(after2D.heroes?.roster.bran?.skills).toEqual(['bran_iron_1']);
      expect(after2D.workshop).toEqual({ bounty: 1 });
      const writtenCloud2D = JSON.parse(cloudMap.get(CLOUD_PROGRESS_2D_SLOT)!) as {
        progress: ProgressData;
      };
      expect(writtenCloud2D.progress.heroes?.roster.bran?.skills).toEqual(['bran_iron_1']);
      expect(writtenCloud2D.progress.workshop).toEqual({ bounty: 1 });

      // 2. Local fresh skill/Workshop spend (from empty base) wins equal-budget tie-break over remote:
      localStorage.clear();
      cloudMap.clear();
      let resolveReadFresh: (() => void) | null = null;
      const adapterFresh = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          unlockAchievement: async () => true,
          cloudRead: (slot) => {
            const snap = cloudMap.get(slot) ?? null;
            return new Promise<string | null>((res) => {
              resolveReadFresh = () => res(snap);
            });
          },
          cloudWrite: async (slot, json) => {
            cloudMap.set(slot, json);
            return true;
          },
        },
      });
      setPlatformAdapter(adapterFresh);

      const emptySpend2D = createDefaultProgress(LEVELS_2D.length);
      emptySpend2D.bestStars[0] = 2;
      emptySpend2D.clears[0] = 1;
      emptySpend2D.unlockedLevelIndex = 1;
      emptySpend2D.heroes = {
        selectedHero: 'bran',
        roster: { bran: { xp: HERO_LEVEL_XP[1], skills: [] } },
      };
      saveLocalProgress2D(emptySpend2D, LEVELS_2D);
      cloudMap.set(
        CLOUD_PROGRESS_2D_SLOT,
        JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: remote2D }),
      );

      const bootFresh = loadProgress2D(LEVELS_2D);
      const learnedLocal = applyNode(bootFresh, 'bran', 'bran_iron_1', LEVELS_2D)!;
      learnedLocal.workshop = { bounty: 1 };
      saveProgress2D(learnedLocal, LEVELS_2D);

      resolveReadFresh!();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      const afterFresh = loadProgress2D(LEVELS_2D);
      expect(afterFresh.heroes?.roster.bran?.skills).toEqual(['bran_iron_1']);
      expect(afterFresh.workshop).toEqual({ bounty: 1 });

      // 3. 3D hydrateProgressFromCloud also preserves concurrent Workshop refund + re-buy ({ quickcast: 1 } -> { bounty: 1 }):
      localStorage.clear();
      const base3D = createDefaultProgress(LEVELS.length);
      base3D.bestStars[0] = 2;
      base3D.clears[0] = 1;
      base3D.workshop = { quickcast: 1 };
      saveLocalProgress(base3D);

      const remote3D = createDefaultProgress(LEVELS.length);
      remote3D.bestStars[0] = 2;
      remote3D.clears[0] = 1;
      remote3D.workshop = { quickcast: 1 };
      cloudMap.set('progress', JSON.stringify(remote3D));

      let resolveRead3D: (() => void) | null = null;
      const adapter3D = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          unlockAchievement: async () => true,
          cloudRead: (slot) => {
            const snap = cloudMap.get(slot) ?? null;
            return new Promise<string | null>((res) => {
              resolveRead3D = () => res(snap);
            });
          },
          cloudWrite: async (slot, json) => {
            cloudMap.set(slot, json);
            return true;
          },
        },
      });
      setPlatformAdapter(adapter3D);

      const p3d = hydrateProgressFromCloud(base3D, LEVELS.length, adapter3D, LEVELS);
      base3D.workshop = { bounty: 1 };
      saveLocalProgress(base3D);
      resolveRead3D!();
      const res3D = await p3d;
      expect(res3D.merged.workshop).toEqual({ bounty: 1 });

      // 4. cloudSave.write rejects non-JSON / coerced "[object Object]" / truncated strings without clobbering mirrors:
      let rawBridgeWrites = 0;
      const guardAdapter = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          unlockAchievement: async () => true,
          cloudRead: async () => null,
          cloudWrite: async () => {
            rawBridgeWrites++;
            return true;
          },
        },
      });
      expect(await guardAdapter.cloudSave.write('progress2d', '{"ok":true}')).toBe(true);
      expect(rawBridgeWrites).toBe(1);
      expect(await guardAdapter.cloudSave.write('progress2d', '[object Object]')).toBe(false);
      expect(await guardAdapter.cloudSave.write('progress2d', '{"truncated":')).toBe(false);
      expect(await guardAdapter.cloudSave.write('progress2d', 'null')).toBe(false);
      expect(await guardAdapter.cloudSave.write('progress2d', '')).toBe(false);
      expect(rawBridgeWrites).toBe(1);
      expect(localStorage.getItem('skyhold_isles_cloud_progress2d')).toBe('{"ok":true}');

      // 5. resetProgress2D clears coach & foes-seen onboarding keys alongside STORY_SEEN_KEY:
      localStorage.setItem('skyhold_isles_story2d_seen_v1', '["l1c:intro"]');
      localStorage.setItem('skyhold2d_coach_v1', 'done');
      localStorage.setItem('skyhold2d_foes_seen_v1', '["grunt","runner"]');
      resetProgress2D(LEVELS_2D);
      expect(localStorage.getItem('skyhold_isles_story2d_seen_v1')).toBeNull();
      expect(localStorage.getItem('skyhold2d_coach_v1')).toBeNull();
      expect(localStorage.getItem('skyhold2d_foes_seen_v1')).toBeNull();
    } finally {
      setPlatformAdapter(null);
    }
  });

  it('never clobbers clean local cloud mirrors when cloudRead returns corrupt/truncated JSON and keeps pre-hydration clones protected after intermediate post-hydration saves', async () => {
    try {
      const cloudMap = new Map<string, string>();
      // Seed an intact local mirror (e.g. from an earlier clean session on this PC) with Sela L12 + treasury:2:
      const intactMirror = createDefaultProgress(LEVELS_2D.length);
      for (let i = 0; i < 12; i++) {
        intactMirror.bestStars[i] = 3;
        intactMirror.clears[i] = 1;
      }
      intactMirror.unlockedLevelIndex = 12;
      intactMirror.workshop = { treasury: 2 };
      intactMirror.heroes = {
        selectedHero: 'sela',
        roster: { sela: { xp: HERO_LEVEL_XP[11], skills: ['sela_cal_1'] } },
      };
      const intactMirrorJson = JSON.stringify({
        ids: LEVELS_2D.map((l) => l.id),
        progress: intactMirror,
      });
      localStorage.setItem('skyhold_isles_cloud_progress2d', intactMirrorJson);

      // Remote Steam Cloud got truncated mid-JSON (retains island 13 3★, cuts off before workshop & heroes!):
      const remoteWithExtra = createDefaultProgress(LEVELS_2D.length);
      for (let i = 0; i < 14; i++) {
        remoteWithExtra.bestStars[i] = 3;
        remoteWithExtra.clears[i] = 1;
      }
      remoteWithExtra.workshop = { treasury: 2, bastion: 1 };
      const fullRemoteJson = JSON.stringify({
        ids: LEVELS_2D.map((l) => l.id),
        progress: remoteWithExtra,
      });
      const cutAt = fullRemoteJson.indexOf('"workshop"');
      const truncatedRemoteJson = fullRemoteJson.slice(0, cutAt);
      cloudMap.set(CLOUD_PROGRESS_2D_SLOT, truncatedRemoteJson);

      const adapter = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          unlockAchievement: async () => true,
          cloudRead: async (slot) => cloudMap.get(slot) ?? null,
          cloudWrite: async (slot, json) => {
            cloudMap.set(slot, json);
            return true;
          },
        },
      });
      setPlatformAdapter(adapter);

      // 1. Direct cloudSave.read() returns the raw remote string for caller repair WITHOUT overwriting the clean local mirror!
      const rawRead = await adapter.cloudSave.read(CLOUD_PROGRESS_2D_SLOT);
      expect(rawRead).toBe(truncatedRemoteJson);
      expect(localStorage.getItem('skyhold_isles_cloud_progress2d')).toBe(intactMirrorJson);

      // 2. Boot auto-hydration merges truncated remote (islands 0..13) WITH the intact local mirror (Sela L12 + treasury:2) AND heals Steam Cloud!
      const boot = loadProgress2D(LEVELS_2D);
      const lateStaleClone: ProgressData = JSON.parse(JSON.stringify(boot));
      lateStaleClone.heroes!.roster.bran = { xp: 450, skills: [] };

      await new Promise((r) => setTimeout(r, 15));

      const hydrated = loadProgress2D(LEVELS_2D);
      expect(hydrated.bestStars[13]).toBe(3); // from truncated remote prefix
      expect(hydrated.workshop).toEqual({ treasury: 2 }); // preserved from intact local mirror!
      expect(hydrated.heroes?.selectedHero).toBe('sela'); // preserved from intact local mirror!
      expect(hydrated.heroes?.roster.sela?.xp).toBe(HERO_LEVEL_XP[11]);

      // 3. An intermediate post-hydration save (e.g. unlocking a node on Sela) must NOT disarm protection for `lateStaleClone`!
      const postSave = applyNode(hydrated, 'sela', 'sela_thn_1', LEVELS_2D)!;
      saveProgress2D(postSave, LEVELS_2D);

      // Now `lateStaleClone` (created before hydration!) saves later — must keep all 14 islands, Sela L12 + BOTH skills, AND add Bran's 450 XP!
      saveProgress2D(lateStaleClone, LEVELS_2D);
      const final2D = loadProgress2D(LEVELS_2D);
      expect(final2D.bestStars[13]).toBe(3);
      expect(final2D.workshop).toEqual({ treasury: 2 });
      expect(final2D.heroes?.roster.sela?.skills).toEqual(['sela_cal_1', 'sela_thn_1']);
      expect(final2D.heroes?.roster.bran?.xp).toBe(450);
    } finally {
      setPlatformAdapter(null);
    }
  });

  it('never overwrites localStorage or boot refs when saveProgress2D / saveProgress runs during post-read cloudWrite or unlockAchievement IPC awaits, and resets difficulty2d pref', async () => {
    const { respecHero2D, selectHero2D } = await import('../../src/render2d/ui/progress2d.ts');
    const { saveLocalProgress, saveProgress, loadProgress } = await import('../../src/platform/storage.ts');
    try {
      const cloudMap = new Map<string, string>();
      // Seed remote 2D cloud save with 10 islands 3★, treasury:2, Sela selected with sela_cal_1:
      const remote2D = createDefaultProgress(LEVELS_2D.length);
      for (let i = 0; i < 10; i++) {
        remote2D.bestStars[i] = 3;
        remote2D.clears[i] = 1;
      }
      remote2D.unlockedLevelIndex = 10;
      remote2D.workshop = { treasury: 2 };
      remote2D.heroes = {
        selectedHero: 'sela',
        roster: {
          bran: { xp: 100, skills: [] },
          sela: { xp: HERO_LEVEL_XP[11], skills: ['sela_cal_1'] },
        },
      };
      cloudMap.set(
        CLOUD_PROGRESS_2D_SLOT,
        JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: remote2D }),
      );

      // Local starts with 1 island cleared (so merged !== cloudRaw triggers safeCloudWrite2D + unlockAchievement IPCs):
      const localInit = createDefaultProgress(LEVELS_2D.length);
      localInit.bestStars[11] = 2;
      localInit.clears[11] = 1;
      saveLocalProgress2D(localInit, LEVELS_2D);

      let releaseInitialCloudWrite: (() => void) | null = null;
      let releaseAchievementUnlock: (() => void) | null = null;
      let writeCalls = 0;
      const adapter2D = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          cloudRead: async (slot) => cloudMap.get(slot) ?? null,
          cloudWrite: (slot, json) => {
            writeCalls++;
            cloudMap.set(slot, json);
            if (writeCalls === 1) {
              return new Promise<boolean>((res) => {
                releaseInitialCloudWrite = () => res(true);
              });
            }
            return Promise.resolve(true);
          },
          unlockAchievement: () => {
            if (!releaseAchievementUnlock) {
              return new Promise<boolean>((res) => {
                releaseAchievementUnlock = () => res(true);
              });
            }
            return Promise.resolve(true);
          },
        },
      });
      setPlatformAdapter(adapter2D);

      const boot = loadProgress2D(LEVELS_2D);
      const staleBootClone: ProgressData = JSON.parse(JSON.stringify(boot));
      staleBootClone.heroes = {
        selectedHero: 'bran',
        roster: { bran: { xp: 350, skills: [] } },
      };

      // Wait until cloudRead finished and hydrateProgress2DFromCloud is suspended in safeCloudWrite2D:
      for (let i = 0; i < 10 && !releaseInitialCloudWrite; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(releaseInitialCloudWrite).not.toBeNull();

      // WHILE safeCloudWrite2D IPC is suspended, player refunds Workshop:
      const midWrite = loadProgress2D(LEVELS_2D);
      midWrite.workshop = {};
      saveProgress2D(midWrite, LEVELS_2D);

      releaseInitialCloudWrite!();
      for (let i = 0; i < 10 && !releaseAchievementUnlock; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(releaseAchievementUnlock).not.toBeNull();

      // WHILE syncAchievementsFromProgress IPC is suspended, player respecs Sela and selects Bran:
      respecHero2D('sela', LEVELS_2D);
      selectHero2D('bran', LEVELS_2D);

      releaseAchievementUnlock!();
      await new Promise((r) => setTimeout(r, 15));

      // Verify neither post-write localStorage nor boot reference nor cloud reverted any mid-IPC action!
      expect(boot.workshop).toEqual({});
      expect(boot.heroes?.roster.sela?.skills).toEqual([]);
      expect(boot.heroes?.selectedHero).toBe('bran');
      expect(boot.bestStars[0]).toBe(3);
      expect(boot.bestStars[11]).toBe(2);

      const persisted2D = loadProgress2D(LEVELS_2D);
      expect(persisted2D.workshop).toEqual({});
      expect(persisted2D.heroes?.roster.sela?.skills).toEqual([]);
      expect(persisted2D.heroes?.selectedHero).toBe('bran');

      // Saving a pre-hydration clone afterwards STILL preserves the mid-IPC refund & respec:
      saveProgress2D(staleBootClone, LEVELS_2D);
      const afterStale = loadProgress2D(LEVELS_2D);
      expect(afterStale.workshop).toEqual({});
      expect(afterStale.heroes?.roster.sela?.skills).toEqual([]);
      expect(afterStale.heroes?.roster.bran?.xp).toBe(350);

      // 3D hydrateProgressFromCloud also never overwrites a saveProgress made during cloudWrite IPC:
      localStorage.clear();
      const local3D = createDefaultProgress(LEVELS.length);
      local3D.bestStars[1] = 2;
      local3D.clears[1] = 1;
      saveLocalProgress(local3D);

      const remote3D = createDefaultProgress(LEVELS.length);
      remote3D.bestStars[0] = 3;
      remote3D.clears[0] = 1;
      remote3D.workshop = { treasury: 1 };
      cloudMap.set('progress', JSON.stringify(remote3D));

      let release3DWrite: (() => void) | null = null;
      let writes3D = 0;
      const adapter3D = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          unlockAchievement: async () => true,
          cloudRead: async (slot) => cloudMap.get(slot) ?? null,
          cloudWrite: (slot, json) => {
            writes3D++;
            cloudMap.set(slot, json);
            if (writes3D === 1) {
              return new Promise<boolean>((res) => {
                release3DWrite = () => res(true);
              });
            }
            return Promise.resolve(true);
          },
        },
      });
      setPlatformAdapter(adapter3D);

      const p3d = hydrateProgressFromCloud(local3D, LEVELS.length, adapter3D, LEVELS);
      for (let i = 0; i < 10 && !release3DWrite; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(release3DWrite).not.toBeNull();
      // Player refunds 3D Workshop while safeCloudWrite is suspended:
      const mid3D = loadProgress(LEVELS.length);
      mid3D.workshop = {};
      saveProgress(mid3D);

      release3DWrite!();
      await p3d;
      expect(loadProgress(LEVELS.length).workshop).toEqual({});
      expect(JSON.parse(cloudMap.get('progress')!).workshop).toEqual({});

      // resetProgress2D also resets remembered difficulty preference back to default Normal:
      localStorage.setItem('skyhold_isles_difficulty2d_v1', 'hard');
      resetProgress2D(LEVELS_2D);
      expect(localStorage.getItem('skyhold_isles_difficulty2d_v1')).toBeNull();
    } finally {
      setPlatformAdapter(null);
    }
  });

  it('protects stale World Map / GameSession progress snapshots saved during post-read achievement IPC awaits (2D & 3D) and coalesces concurrent achievement unlocks', async () => {
    try {
      const cloudMap = new Map<string, string>();
      const remote2D = createDefaultProgress(LEVELS_2D.length);
      for (let i = 0; i < 14; i++) {
        remote2D.bestStars[i] = 3;
        remote2D.clears[i] = 1;
      }
      remote2D.unlockedLevelIndex = 14;
      remote2D.workshop = { quickcast: 2, treasury: 1 };
      remote2D.heroes = {
        selectedHero: 'mira',
        roster: {
          bran: { xp: 200, skills: [] },
          mira: { xp: HERO_LEVEL_XP[11], skills: ['mira_emb_1', 'mira_emb_2'] },
        },
      };
      cloudMap.set(
        CLOUD_PROGRESS_2D_SLOT,
        JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: remote2D }),
      );

      let releaseAch2D: (() => void) | null = null;
      let suspended2D = false;
      const adapter2D = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          unlockAchievement: () => {
            if (!suspended2D) {
              suspended2D = true;
              return new Promise<boolean>((res) => {
                releaseAch2D = () => res(true);
              });
            }
            return Promise.resolve(true);
          },
          cloudRead: async (slot) => cloudMap.get(slot) ?? null,
          cloudWrite: async (slot, json) => {
            cloudMap.set(slot, json);
            return true;
          },
        },
      });
      setPlatformAdapter(adapter2D);

      // Fresh PC boots World Map (`boot` is empty in memory; cloudRead resolves synchronously via microtask,
      // then hydrateProgress2DFromCloud suspends inside syncAchievementsFromProgress):
      const boot2D = loadProgress2D(LEVELS_2D);
      for (let i = 0; i < 12 && !releaseAch2D; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(releaseAch2D).not.toBeNull();
      expect(boot2D.bestStars[0]).toBe(0); // `.then(...)` has not run yet!

      // WHILE syncAchievementsFromProgress is suspended on IPC, World Map saves stale `boot2D`
      // after adding local Bran XP: must 3-way merge remote stars + Workshop + Mira skills instead of clobbering!
      boot2D.heroes!.roster.bran = { xp: 450, skills: [] };
      saveProgress2D(boot2D, LEVELS_2D);

      expect(boot2D.bestStars[13]).toBe(3);
      expect(boot2D.workshop).toEqual({ quickcast: 2, treasury: 1 });
      expect(boot2D.heroes?.roster.mira?.skills).toEqual(['mira_emb_1', 'mira_emb_2']);
      expect(boot2D.heroes?.roster.bran?.xp).toBe(450);

      // Still inside the same achievement IPC window, `boot2D` is now post-hydration:
      // an explicit Workshop refund on `boot2D` must stay authoritative after `.then(...)` finishes!
      boot2D.workshop = {};
      saveProgress2D(boot2D, LEVELS_2D);

      releaseAch2D!();
      await new Promise((r) => setTimeout(r, 15));

      expect(boot2D.bestStars[13]).toBe(3);
      expect(boot2D.workshop).toEqual({});
      expect(boot2D.heroes?.roster.mira?.skills).toEqual(['mira_emb_1', 'mira_emb_2']);
      const finalCloud2D = JSON.parse(cloudMap.get(CLOUD_PROGRESS_2D_SLOT)!) as {
        progress: ProgressData;
      };
      expect(finalCloud2D.progress.bestStars[13]).toBe(3);
      expect(finalCloud2D.progress.workshop).toEqual({});
      expect(finalCloud2D.progress.heroes?.roster.mira?.skills).toEqual(['mira_emb_1', 'mira_emb_2']);

      // 3D parity: saving a stale pre-hydration 3D snapshot during syncAchievementsFromProgress
      // also 3-way-merges remote stars + Workshop without clobbering Steam Cloud!
      localStorage.clear();
      const stale3D = createDefaultProgress(LEVELS.length);
      const remote3D = createDefaultProgress(LEVELS.length);
      for (let i = 0; i < 8; i++) {
        remote3D.bestStars[i] = 3;
        remote3D.clears[i] = 1;
      }
      remote3D.workshop = { treasury: 2 };
      cloudMap.set('progress', JSON.stringify(remote3D));

      let releaseAch3D: (() => void) | null = null;
      let suspended3D = false;
      const adapter3D = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          unlockAchievement: () => {
            if (!suspended3D) {
              suspended3D = true;
              return new Promise<boolean>((res) => {
                releaseAch3D = () => res(true);
              });
            }
            return Promise.resolve(true);
          },
          cloudRead: async (slot) => cloudMap.get(slot) ?? null,
          cloudWrite: async (slot, json) => {
            cloudMap.set(slot, json);
            return true;
          },
        },
      });
      setPlatformAdapter(adapter3D);

      const hydrate3DPromise = hydrateProgressFromCloud(stale3D, LEVELS.length, adapter3D, LEVELS);
      for (let i = 0; i < 12 && !releaseAch3D; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(releaseAch3D).not.toBeNull();

      stale3D.bestEndlessWaves[2] = 19;
      saveProgress(stale3D);
      expect(stale3D.bestStars[7]).toBe(3);
      expect(stale3D.workshop).toEqual({ treasury: 2 });
      expect(stale3D.bestEndlessWaves[2]).toBe(19);
      expect(JSON.parse(cloudMap.get('progress')!).bestStars[7]).toBe(3);

      releaseAch3D!();
      await hydrate3DPromise;

      // Concurrent PlatformAdapter.achievements.unlock(id) coalesces in-flight IPC calls and allows retry after failure:
      let rawUnlockCalls = 0;
      let shouldSucceed = false;
      let releaseUnlock: (() => void) | null = null;
      const dedupAdapter = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          unlockAchievement: () => {
            rawUnlockCalls++;
            return new Promise<boolean>((res) => {
              releaseUnlock = () => res(shouldSucceed);
            });
          },
          cloudRead: async () => null,
          cloudWrite: async () => true,
        },
      });

      const u1 = dedupAdapter.achievements.unlock('BOSS_I24_CLEARED');
      const u2 = dedupAdapter.achievements.unlock('BOSS_I24_CLEARED');
      expect(rawUnlockCalls).toBe(1);
      releaseUnlock!();
      expect(await Promise.all([u1, u2])).toEqual([false, false]);

      // Failed unlock was not cached: retry succeeds and coalesces concurrent callers onto 1 IPC call!
      shouldSucceed = true;
      const u3 = dedupAdapter.achievements.unlock('BOSS_I24_CLEARED');
      const u4 = dedupAdapter.achievements.unlock('BOSS_I24_CLEARED');
      expect(rawUnlockCalls).toBe(2);
      releaseUnlock!();
      expect(await Promise.all([u3, u4])).toEqual([true, true]);
      expect(await dedupAdapter.achievements.unlock('BOSS_I24_CLEARED')).toBe(true);
      expect(rawUnlockCalls).toBe(2);
    } finally {
      setPlatformAdapter(null);
    }
  });

  it('prevents pre-hydration importSaveCode2D, recoverProgress2D, and 3D GameSession.importSaveCode from poisoning post-hydration refs or wiping remote Workshop/islands', async () => {
    localStorage.clear();
    const cloudMap = new Map<string, string>();

    // Remote 2D Steam Cloud save has 14 cleared islands, Workshop upgrades, and L10 Mira.
    const remote2D = createDefaultProgress(LEVELS_2D.length);
    for (let i = 0; i < 14; i++) {
      remote2D.bestStars[i] = 3;
      remote2D.clears[i] = 1;
    }
    remote2D.unlockedLevelIndex = 14;
    remote2D.workshop = { quickcast: 2, bounty: 2 };
    remote2D.heroes = createFreshHeroSaveData();
    remote2D.heroes.selectedHero = 'mira';
    remote2D.heroes.roster.mira = { xp: HERO_LEVEL_XP[9], skills: ['mira_emb_1'] };
    cloudMap.set(
      CLOUD_PROGRESS_2D_SLOT,
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: remote2D }),
    );

    // Save code only has 3 cleared islands and `{ quickcast: 1 }`.
    const imported2D = createDefaultProgress(LEVELS_2D.length);
    for (let i = 0; i < 3; i++) {
      imported2D.bestStars[i] = 3;
      imported2D.clears[i] = 1;
    }
    imported2D.unlockedLevelIndex = 3;
    imported2D.workshop = { quickcast: 1 };
    imported2D.heroes = createFreshHeroSaveData();
    const code2D = encodeSaveCode2D(imported2D, LEVELS_2D);

    let releaseRead2D: (() => void) | null = null;
    const adapter2D = createPlatformAdapter({
      bridge: {
        isSteam: true,
        appId: 480,
        unlockAchievement: async () => true,
        cloudRead: (slot) =>
          new Promise<string | null>((res) => {
            releaseRead2D = () => res(cloudMap.get(slot) ?? null);
          }),
        cloudWrite: async (slot, json) => {
          cloudMap.set(slot, json);
          return true;
        },
      },
    });
    setPlatformAdapter(adapter2D);

    try {
      // 1. User imports save code on fresh PC BEFORE Steam Cloud read resolves:
      const impRes = importSaveCode2D(code2D, LEVELS_2D);
      expect(impRes.ok).toBe(true);
      if (!impRes.ok) return;
      const heldRef = impRes.progress;
      expect(heldRef.bestStars[13]).toBe(0);
      expect(releaseRead2D).not.toBeNull();

      // Steam Cloud read now resolves:
      releaseRead2D!();
      await new Promise((r) => setTimeout(r, 15));

      // Caller still holds `heldRef` (returned before cloud read resolved), selects Wren (which shares
      // `heldRef.bestStars`), and calls `saveProgress2D`: must 3-way merge remote islands/Workshop/Mira!
      const withWren = selectHero(heldRef, 'wren', LEVELS_2D);
      expect(withWren).not.toBeNull();
      saveProgress2D(withWren!, LEVELS_2D);

      expect(withWren!.bestStars[13]).toBe(3);
      expect(withWren!.workshop).toEqual({ quickcast: 2, bounty: 2 });
      expect(withWren!.heroes?.roster.mira?.xp).toBe(HERO_LEVEL_XP[9]);
      expect(withWren!.heroes?.selectedHero).toBe('wren');
      const written2D = JSON.parse(cloudMap.get(CLOUD_PROGRESS_2D_SLOT)!) as { progress: ProgressData };
      expect(written2D.progress.bestStars[13]).toBe(3);
      expect(written2D.progress.workshop).toEqual({ quickcast: 2, bounty: 2 });

      // 2. Same pre-hydration guard for `recoverProgress2D`:
      localStorage.clear();
      localStorage.setItem(
        'skyhold_isles_progress2d_import_backup',
        JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: imported2D }),
      );
      let releaseRecRead2D: (() => void) | null = null;
      const recAdapter2D = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          unlockAchievement: async () => true,
          cloudRead: (slot) =>
            new Promise<string | null>((res) => {
              releaseRecRead2D = () => res(cloudMap.get(slot) ?? null);
            }),
          cloudWrite: async (slot, json) => {
            cloudMap.set(slot, json);
            return true;
          },
        },
      });
      setPlatformAdapter(recAdapter2D);
      const recRes = recoverProgress2D(LEVELS_2D);
      expect(recRes.recovered).toBe(true);
      expect(releaseRecRead2D).not.toBeNull();
      releaseRecRead2D!();
      await new Promise((r) => setTimeout(r, 15));

      saveProgress2D(recRes.progress, LEVELS_2D);
      expect(recRes.progress.bestStars[13]).toBe(3);
      expect(recRes.progress.workshop).toEqual({ quickcast: 2, bounty: 2 });

      // 3. 3D `GameSession.importSaveCode` while `hydrateProgressFromCloud` is awaiting `cloudSave.read`:
      // importing `{ quickcast: 1 }` must NOT be misinterpreted as refunding remote `{ quickcast: 2, bounty: 2 }`!
      localStorage.clear();
      const remote3D = createDefaultProgress(LEVELS.length);
      for (let i = 0; i < 10; i++) {
        remote3D.bestStars[i] = 3;
        remote3D.clears[i] = 1;
      }
      remote3D.unlockedLevelIndex = 10;
      remote3D.workshop = { quickcast: 2, bounty: 2 };
      cloudMap.set(CLOUD_PROGRESS_SLOT, JSON.stringify(remote3D));

      const imported3D = createDefaultProgress(LEVELS.length);
      for (let i = 0; i < 2; i++) {
        imported3D.bestStars[i] = 3;
        imported3D.clears[i] = 1;
      }
      imported3D.unlockedLevelIndex = 2;
      imported3D.workshop = { quickcast: 1 };
      const code3D = encodeSaveCode(imported3D);

      let releaseRead3D: (() => void) | null = null;
      const adapter3D = createPlatformAdapter({
        bridge: {
          isSteam: true,
          appId: 480,
          unlockAchievement: async () => true,
          cloudRead: (slot) =>
            new Promise<string | null>((res) => {
              releaseRead3D = () => res(cloudMap.get(slot) ?? null);
            }),
          cloudWrite: async (slot, json) => {
            cloudMap.set(slot, json);
            return true;
          },
        },
      });
      setPlatformAdapter(adapter3D);

      const mockRw = {
        setQuality: () => {},
        loadLevel: () => {},
        setPlacementGridActive: () => {},
        setFlightPathHighlight: () => {},
        setRoutesPinned: () => {},
        setHoveredTowerId: () => {},
        setCanvasCursor: () => {},
        setMeteorTargetPreview: () => {},
        overlayIndicators: { setSelectedTowerRing: () => {} },
        cameraController: { setShowcaseMode: () => {}, getViewVersion: () => 0 },
      };
      const mockSm = {
        unlock: () => {},
        bindEvents: () => () => {},
        setMusicDucked: () => {},
        setMusicContext: () => {},
        playUiConfirm: () => {},
        playUiBack: () => {},
        playStarChime: () => {},
        playBossPulse: () => {},
        suspendForBackground: () => {},
        resumeFromBackground: () => {},
        updateSettings: () => {},
      };
      const gs = new GameSession(mockRw as never, mockSm as never);
      try {
        expect(releaseRead3D).not.toBeNull();
        expect(gs.importSaveCode(code3D).ok).toBe(true);
        expect(gs.progress.workshop).toEqual({ quickcast: 1 });

        releaseRead3D!();
        await new Promise((r) => setTimeout(r, 15));

        expect(gs.progress.bestStars[9]).toBe(3);
        expect(gs.progress.workshop).toEqual({ quickcast: 2, bounty: 2 });
        expect(JSON.parse(cloudMap.get(CLOUD_PROGRESS_SLOT)!).workshop).toEqual({
          quickcast: 2,
          bounty: 2,
        });
      } finally {
        gs.dispose();
      }
    } finally {
      setPlatformAdapter(null);
    }
  });

  it('keeps direct STEAM_ACHIEVEMENTS[i].isEarned predicates 1-to-1 with earnedSteamAchievementIds on partial/compact difficultyWins saves', () => {
    const rawCompact = {
      version: 2,
      unlockedLevelIndex: 24,
      bestStars: [],
      bestEndlessWaves: [],
      bestLives: [],
      clears: [],
      workshop: {},
      challengeClears: LEVELS_2D.map((lvl) => [...challengesForLevel(lvl)]),
      daily: { lastDay: 500, streak: 14, bestStreak: 0, total: 20 },
      difficultyWins: {
        h: new Array<number>(LEVELS_2D.length).fill(3),
      } as unknown as ProgressData['difficultyWins'],
      h: {
        s: 'sela',
        r: {
          bran: { x: HERO_LEVEL_XP[19] },
          wren: { x: HERO_LEVEL_XP[9] },
          mira: { x: HERO_LEVEL_XP[19] },
          tobb: { x: 0 },
          sela: { x: HERO_LEVEL_XP[19] },
        },
      },
      wc: ['staticFree'],
    } as unknown as ProgressData;

    const batchEarned = new Set(earnedSteamAchievementIds(rawCompact, LEVELS_2D));
    expect(batchEarned.has('HARD_BOSS_I24')).toBe(true);
    expect(batchEarned.has('HARD_ALL_ISLANDS')).toBe(true);
    expect(batchEarned.has('CROWN_ALL_ISLANDS')).toBe(true);
    expect(batchEarned.has('STARS_ALL_ISLANDS')).toBe(true);
    expect(batchEarned.has('DAILY_STREAK_14')).toBe(true);
    expect(batchEarned.has('HERO_ALL_ROSTER')).toBe(true);
    expect(batchEarned.has('HERO_BRAN_LV20')).toBe(true);
    expect(batchEarned.has('HERO_WREN_LV10')).toBe(true);
    expect(batchEarned.has('HERO_WREN_LV20')).toBe(false);
    expect(batchEarned.has('HERO_SELA_LV20')).toBe(true);
    expect(batchEarned.has('CHALLENGE_STATIC_FREE')).toBe(true);

    for (const ach of STEAM_ACHIEVEMENTS) {
      expect(ach.isEarned(rawCompact, LEVELS_2D), `${ach.id} direct vs batch mismatch`).toBe(
        batchEarned.has(ach.id),
      );
    }

    // Also verify GameSession.resetProgress() notifies attached ContentDirector.onProgressReset():
    let contentResetCount = 0;
    const mockRw = {
      setQuality: () => {},
      loadLevel: () => {},
      setPlacementGridActive: () => {},
      setFlightPathHighlight: () => {},
      setRoutesPinned: () => {},
      setHoveredTowerId: () => {},
      setCanvasCursor: () => {},
      setMeteorTargetPreview: () => {},
      overlayIndicators: { setSelectedTowerRing: () => {} },
      cameraController: { setShowcaseMode: () => {}, getViewVersion: () => 0 },
    };
    const mockSm = {
      unlock: () => {},
      bindEvents: () => () => {},
      setMusicDucked: () => {},
      setMusicContext: () => {},
      playUiConfirm: () => {},
      playUiBack: () => {},
      playStarChime: () => {},
      playBossPulse: () => {},
      suspendForBackground: () => {},
      resumeFromBackground: () => {},
      updateSettings: () => {},
    };
    const gs = new GameSession(mockRw as never, mockSm as never);
    try {
      gs.attachRuntime({
        overlays: {
          mainMenu: { setOpen: () => {} },
          levelSelect: { setOpen: () => {} },
          workshop: { setOpen: () => {} },
          toast: { show: () => {} },
        } as never,
        inputManager: { setEnabled: () => {}, setModalOpen: () => {} } as never,
        loop: { simActive: false, paused: false } as never,
        setDebugVisible: () => {},
        content: {
          onProgressReset: () => {
            contentResetCount++;
          },
          onProgressImported: () => {},
          isBlocking: () => false,
        } as never,
      });
      gs.resetProgress();
      expect(contentResetCount).toBe(1);
    } finally {
      gs.dispose();
    }
  });
});
