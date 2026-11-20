import { afterEach, describe, expect, it } from 'vitest';
import { SeededRng } from '../../src/core/rng.ts';
import type { ProgressData } from '../../src/core/types.ts';
import { CHALLENGE_IDS, challengesForLevel } from '../../src/data/challenges.ts';
import { difficultyWinsOf } from '../../src/data/difficulty.ts';
import {
  countHeroSkillPointsSpent,
  defaultLevel20Skills,
  defaultSkillsForLevel,
  HERO_IDS,
  heroLevelFromXp,
  heroSkillPointsForLevel,
} from '../../src/data/heroes.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { LEVEL_L1C, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { maxedWorkshopRanks, WORKSHOP_UPGRADES, workshopStarsSpent } from '../../src/data/workshop.ts';
import { starWallet } from '../../src/game/progression.ts';
import {
  decodeSaveCode,
  describeMergeGain,
  encodeSaveCode,
  hydrateProgressFromCloud,
  inspectSaveCodeHints,
  mergeProgress,
  PROGRESS_CORRUPT_BACKUP_KEY,
  recoverProgressSave,
  setPlatformAdapter,
  tryRepairTruncatedJson,
} from '../../src/platform/index.ts';
import {
  backupProgressBeforeImport,
  createDefaultProgress,
  loadProgress,
  migrateProgress,
  resetProgressSave,
  saveLocalProgress,
} from '../../src/platform/storage.ts';
import { xpForHeroLevel } from '../../src/render2d/heroes2d.ts';
import {
  CLOUD_PROGRESS_2D_SLOT,
  decodeSaveCode2D,
  encodeSaveCode2D,
  exportSaveCode2D,
  hydrateProgress2DFromCloud,
  importSaveCode2D,
  islandStates,
  loadProgress2D,
  PROGRESS_2D_CORRUPT_BACKUP_KEY,
  PROGRESS_2D_IMPORT_BACKUP_KEY,
  PROGRESS_2D_KEY,
  PROGRESS_2D_RESET_BACKUP_KEY,
  recoverProgress2D,
  remapProgress,
  resetProgress2D,
  saveProgress2D,
} from '../../src/render2d/ui/progress2d.ts';

function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    configurable: true,
    writable: true,
  });
  return store;
}

afterEach(() => {
  setPlatformAdapter(null);
  if ('localStorage' in globalThis) {
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  }
});

function assertStrictProgressV2(p: ProgressData, levelCount: number): void {
  expect(Number.isInteger(p.version) && p.version >= 2).toBe(true);
  expect(Number.isInteger(p.unlockedLevelIndex) && p.unlockedLevelIndex >= 0).toBe(true);
  if (levelCount > 0) expect(p.unlockedLevelIndex).toBeLessThan(levelCount);
  else expect(p.unlockedLevelIndex).toBe(0);

  expect(p.bestStars).toHaveLength(levelCount);
  expect(p.bestEndlessWaves).toHaveLength(levelCount);
  expect(p.bestLives).toHaveLength(levelCount);
  expect(p.clears).toHaveLength(levelCount);
  expect(p.challengeClears).toHaveLength(levelCount);

  for (let i = 0; i < levelCount; i++) {
    expect(Number.isInteger(p.bestStars[i]) && p.bestStars[i] >= 0 && p.bestStars[i] <= 3).toBe(true);
    expect(Number.isInteger(p.clears[i]) && p.clears[i] >= 0).toBe(true);
    if (p.bestStars[i] > 0) expect(p.clears[i]).toBeGreaterThanOrEqual(1);
    expect(new Set(p.challengeClears[i]).size).toBe(p.challengeClears[i].length);
  }

  expect(starWallet(p).available).toBeGreaterThanOrEqual(0);

  if (p.heroes !== undefined) {
    expect(HERO_IDS).toContain(p.heroes.selectedHero);
    for (const id of HERO_IDS) {
      const entry = p.heroes.roster[id]!;
      expect(entry).toBeDefined();
      expect(Number.isInteger(entry.xp) && entry.xp >= 0).toBe(true);
      const budget = heroSkillPointsForLevel(heroLevelFromXp(entry.xp));
      expect(countHeroSkillPointsSpent(id, entry.skills)).toBeLessThanOrEqual(budget);
    }
  }

  if (p.difficultyWins !== undefined) {
    expect(p.difficultyWins.easy).toHaveLength(levelCount);
    expect(p.difficultyWins.normal).toHaveLength(levelCount);
    expect(p.difficultyWins.hard).toHaveLength(levelCount);
    for (let i = 0; i < levelCount; i++) {
      expect(p.difficultyWins.easy[i]).toBeGreaterThanOrEqual(0);
      expect(p.difficultyWins.easy[i]).toBeLessThanOrEqual(1);
      expect(p.difficultyWins.normal[i]).toBeGreaterThanOrEqual(0);
      expect(p.difficultyWins.normal[i]).toBeLessThanOrEqual(3);
      expect(p.difficultyWins.hard[i]).toBeGreaterThanOrEqual(0);
      expect(p.difficultyWins.hard[i]).toBeLessThanOrEqual(3);
      expect(
        Math.max(
          p.difficultyWins.easy[i],
          p.difficultyWins.normal[i],
          p.difficultyWins.hard[i],
        ),
      ).toBe(p.bestStars[i]);
    }
  }
}

function buildRich25IslandSave(): ProgressData {
  const n = LEVELS_2D.length;
  const p = createDefaultProgress(n);
  p.unlockedLevelIndex = n - 1;
  p.difficultyWins = {
    easy: new Array<number>(n).fill(0),
    normal: new Array<number>(n).fill(0),
    hard: new Array<number>(n).fill(0),
  };
  for (let i = 0; i < n; i++) {
    const ez = i % 3 === 0 ? 1 : 0;
    const nm = i % 4 === 0 ? 3 : i % 2 === 0 ? 2 : 1;
    const hd = i % 5 === 0 || i === n - 1 ? 3 : i % 3 === 1 ? 2 : 0;
    p.difficultyWins.easy[i] = ez;
    p.difficultyWins.normal[i] = nm;
    p.difficultyWins.hard[i] = hd;
    p.bestStars[i] = Math.max(ez, nm, hd);
    p.clears[i] = 1 + (i % 3);
    p.bestLives[i] = 16 + (i % 5);
    p.bestEndlessWaves[i] = i % 2 === 0 ? LEVELS_2D[i].waves.length + 12 : 0;
    p.challengeClears[i] = challengesForLevel(LEVELS_2D[i]).slice(0, (i % 2) + 1);
  }
  p.workshop = maxedWorkshopRanks();
  p.daily = { lastDay: 20_620, streak: 9, bestStreak: 14, total: 23 };
  p.heroes = {
    selectedHero: 'sela',
    roster: {
      bran: { xp: xpForHeroLevel(20), skills: [...defaultLevel20Skills('bran')] },
      wren: { xp: xpForHeroLevel(15) + 42, skills: [...defaultSkillsForLevel('wren', 15)] },
      mira: { xp: xpForHeroLevel(12), skills: [...defaultSkillsForLevel('mira', 12)] },
      tobb: { xp: xpForHeroLevel(10), skills: [...defaultSkillsForLevel('tobb', 10)] },
      sela: { xp: xpForHeroLevel(20), skills: [...defaultLevel20Skills('sela')] },
    },
  };
  return p;
}

describe('Save Robustness v2 — Export/Import Save Codes (Heroes, Difficulty, Workshop)', () => {
  it('round-trips full 25-island progress with all 5 heroes, per-difficulty ribbons, and maxed Workshop', () => {
    installMemoryStorage();
    const rich = buildRich25IslandSave();
    saveProgress2D(rich, LEVELS_2D);

    const code = exportSaveCode2D(LEVELS_2D);
    expect(code.startsWith('SKY2-')).toBe(true);
    const hints = inspectSaveCodeHints(code);
    expect(hints.rawSelectedHero).toBe('sela');
    expect(hints.rawWorkshop).toEqual(maxedWorkshopRanks());

    resetProgress2D(LEVELS_2D);
    const res = importSaveCode2D(code, LEVELS_2D);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.progress).toEqual(rich);
    expect(res.summary).toContain('★');
    expect(res.summary).toContain('workshop upgrades');
    expect(res.summary).toContain('hero XP');
    expect(res.summary).toContain('Hard ribbons');
    expect(loadProgress2D(LEVELS_2D)).toEqual(rich);
  });

  it('reconciles bidirectional bestStars ↔ difficultyWins mismatches and rejects tampered/invalid codes cleanly', () => {
    installMemoryStorage();
    // 1. Partial save where bestStars has 3★ on island 1 & 2★ on island 2, while difficultyWins only recorded easy[0]=1
    const partial = migrateProgress(
      {
        version: 2,
        unlockedLevelIndex: 2,
        bestStars: [1, 3, 2, 0],
        difficultyWins: { easy: [1], normal: [], hard: [0, 0, 0, 2] },
      },
      4,
    );
    expect(partial.bestStars).toEqual([1, 3, 2, 2]);
    expect(partial.difficultyWins).toEqual({
      easy: [1, 0, 0, 0],
      normal: [0, 3, 2, 0],
      hard: [0, 0, 0, 2],
    });
    const states = islandStates(partial, LEVELS_2D.slice(0, 4));
    expect(states[1].stars).toBe(3);
    expect(states[1].diffStars.normal).toBe(3);
    expect(states[3].hardWon).toBe(true);

    // 2. Non-string, oversized, bit-flipped, and truncated save codes never throw
    expect(decodeSaveCode(null as unknown as string, 25).ok).toBe(false);
    expect(decodeSaveCode(undefined as unknown as string, 25).ok).toBe(false);
    expect(decodeSaveCode(12345 as unknown as string, 25).ok).toBe(false);
    expect(decodeSaveCode('SKY2-' + 'A'.repeat(300_000) + '-0000000', 25).ok).toBe(false);

    const validCode = encodeSaveCode2D(buildRich25IslandSave(), LEVELS_2D);
    const rng = new SeededRng(0xbad_c0de);
    for (let i = 0; i < 150; i++) {
      let mutated: string;
      if (i % 3 === 0) {
        mutated = validCode.slice(0, rng.int(1, validCode.length - 1));
      } else {
        const pos = rng.int(5, validCode.length - 1);
        const replacement = validCode[pos] === 'A' ? 'B' : 'A';
        mutated = validCode.slice(0, pos) + replacement + validCode.slice(pos + 1);
      }
      const d = decodeSaveCode2D(mutated, LEVELS_2D);
      expect(d.ok).toBe(false);
    }
  });

  it('preserves Workshop & selectedHero on truncated levelIds codes while blocking cheated Workshop ranks', () => {
    installMemoryStorage();
    const curLevels = LEVELS_2D.slice(0, 6);

    // Legitimate code where `s` has 3★ on 3 islands (9★ >= 5★ Workshop), but `i` only listed 1 island ('l1c'):
    const sourceSave = createDefaultProgress(3);
    sourceSave.bestStars = [3, 3, 3];
    sourceSave.clears = [1, 1, 1];
    sourceSave.workshop = { treasury: 2, bastion: 1 }; // costs 5★ (affordable on sourceSave's 9★!)
    const truncatedIdsCode = encodeSaveCode(sourceSave, ['l1c']);

    const localSave = createDefaultProgress(curLevels.length);
    localSave.bestStars = [0, 3, 0, 0, 0, 0]; // 3★ on i01 -> combined with l1c (3★) = 6★ >= 5★!
    localSave.clears = [0, 1, 0, 0, 0, 0];
    localSave.workshop = { treasury: 1 };
    saveProgress2D(localSave, curLevels);

    const okImport = importSaveCode2D(truncatedIdsCode, curLevels);
    expect(okImport.ok).toBe(true);
    if (okImport.ok) {
      expect(okImport.progress.workshop).toEqual({ treasury: 2, bastion: 1 });
      expect(starWallet(okImport.progress).available).toBe(1);
    }

    // Cheated code where `w` spends 13★ while `s` only has [3] (3★ total on sourceSave) must NOT clobber local Workshop!
    const cheatedPayload = {
      v: 2,
      u: 0,
      s: [3],
      e: [],
      l: [],
      c: [1],
      w: { treasury: 2, bastion: 2, storm: 2 }, // 13★ > 3★!
      b: [],
      d: { lastDay: -1, streak: 0, bestStreak: 0, total: 0 },
      i: ['l1c'],
    };
    const body = Buffer.from(JSON.stringify(cheatedPayload), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    let h = 0x811c9dc5;
    for (let i = 0; i < body.length; i++) {
      h ^= body.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    const cheatedCode = `SKY2-${body}-${h.toString(36).padStart(7, '0')}`;

    saveProgress2D(localSave, curLevels);
    const guardedImport = importSaveCode2D(cheatedCode, curLevels);
    expect(guardedImport.ok).toBe(true);
    if (guardedImport.ok) {
      // Combined stars = 6★; cheated 13★ workshop was rejected at source, keeping local { treasury: 1 }!
      expect(guardedImport.progress.workshop).toEqual({ treasury: 1 });
      expect(starWallet(guardedImport.progress).available).toBe(5);
    }
  });
});

describe('Save Robustness v2 — Desktop Steam Cloud Conflict Rules', () => {
  it('resolves divergent Workshop spends on the same star pool, legacy-vs-Hard ribbons, and conflicting hero branches commutatively', () => {
    // Desktop & Laptop both earned 10★ on the exact same 4 islands (3+3+2+2 = 10★):
    const desktop = createDefaultProgress(6);
    desktop.bestStars = [3, 3, 2, 2, 0, 0]; // legacy Normal save (no difficultyWins!)
    desktop.clears = [1, 1, 1, 1, 0, 0];
    desktop.unlockedLevelIndex = 4;
    desktop.workshop = { treasury: 2, bastion: 2 }; // 3★ + 5★ = 8★ (affordable <= 10★)
    desktop.heroes = {
      selectedHero: 'wren',
      roster: {
        bran: { xp: xpForHeroLevel(5), skills: ['bran_oak_1', 'bran_oak_2', 'bran_oak_3'] }, // 4 pts (budget 4)
        wren: { xp: xpForHeroLevel(4), skills: ['wren_bow_1'] },
      },
    };

    const laptop = createDefaultProgress(6);
    laptop.bestStars = [2, 3, 2, 2, 0, 0];
    laptop.clears = [1, 2, 1, 1, 0, 0];
    laptop.unlockedLevelIndex = 4;
    laptop.difficultyWins = {
      easy: [1, 0, 0, 0, 0, 0],
      normal: [0, 3, 2, 0, 0, 0],
      hard: [2, 0, 0, 2, 0, 0], // Hard ribbons on islands 0 & 3!
    };
    laptop.workshop = { fletcher: 2, powder: 1 }; // 5★ + 2★ = 7★ (affordable <= 10★, union = 15★ > 10★!)
    laptop.heroes = {
      selectedHero: 'mira',
      roster: {
        // Conflicting 4-pt branch at same L5 budget (union = 8 pts > 4 pts -> deterministic tie-break!)
        bran: { xp: xpForHeroLevel(5), skills: ['bran_iron_1', 'bran_iron_2', 'bran_iron_3'] },
        mira: { xp: xpForHeroLevel(6), skills: ['mira_emb_1', 'mira_emb_2'] },
      },
    };

    const ab = mergeProgress(desktop, laptop, 6);
    const ba = mergeProgress(laptop, desktop, 6);
    expect(ab).toEqual(ba); // strictly commutative!
    expect(mergeProgress(ab, ab, 6)).toEqual(ab); // strictly idempotent!
    assertStrictProgressV2(ab, 6);

    // Desktop's 8★ primaryWorkshop ({ treasury: 2, bastion: 2 }) is topped up with +2★ from Laptop ({ fletcher: 1 }) = 10★!
    expect(ab.workshop).toEqual({ treasury: 2, bastion: 2, fletcher: 1 });
    expect(workshopStarsSpent(ab.workshop)).toBe(10);
    expect(starWallet(ab).available).toBe(0);

    // Island 0 keeps Desktop's legacy 3★ Normal AND Laptop's 2★ Hard ribbon & 1★ Easy win!
    expect(ab.difficultyWins).toEqual({
      easy: [1, 0, 0, 0, 0, 0],
      normal: [3, 3, 2, 2, 0, 0],
      hard: [2, 0, 0, 2, 0, 0],
    });
    expect(ab.heroes?.selectedHero).toBe('mira'); // Mira unlocked at 4 clears & Laptop has higher total hero XP
    expect(describeMergeGain(desktop, ab)).toContain('+2 Hard ribbons');
  });

  it('survives throwing cloudSave.read/write without clobbering remote cloud and heals truncated Steam Cloud blobs', async () => {
    installMemoryStorage();
    const local2d = createDefaultProgress(LEVELS_2D.length);
    local2d.bestStars[0] = 2;
    local2d.clears[0] = 1;
    saveProgress2D(local2d, LEVELS_2D);

    let cloudWrites = 0;
    // 1. Transient read exception must NOT overwrite Steam Cloud with local-only save or reject
    const afterReadThrow = await hydrateProgress2DFromCloud(undefined, LEVELS_2D, {
      isSteam: true,
      isMobile: false,
      mobilePlatform: 'web',
      overlayActive: false,
      achievements: { unlock: async () => true },
      cloudSave: {
        read: async () => {
          throw new Error('Steam IPC read timeout');
        },
        write: async () => {
          cloudWrites++;
          return true;
        },
      },
      triggerHaptic: async () => false,
      onOverlayChange: () => () => {},
      onPause: () => () => {},
      onResume: () => () => {},
    });
    expect(cloudWrites).toBe(0);
    expect(afterReadThrow.merged.bestStars[0]).toBe(2);

    // 2. Truncated Steam Cloud JSON salvages surviving remote progress, merges with local, and writes healed JSON back!
    const remoteFull = buildRich25IslandSave();
    const fullCloudJson = JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: remoteFull });
    // Cut off inside `heroes` near the end -> `ids`, `bestStars`, `clears`, `workshop`, etc. survive!
    const cutAt = fullCloudJson.indexOf('"tobb"');
    expect(cutAt).toBeGreaterThan(100);
    const truncatedCloudJson = fullCloudJson.slice(0, cutAt);

    let healedCloudBlob: string | null = null;
    const healed = await hydrateProgress2DFromCloud(undefined, LEVELS_2D, {
      isSteam: true,
      isMobile: false,
      mobilePlatform: 'web',
      overlayActive: false,
      achievements: { unlock: async () => true },
      cloudSave: {
        read: async () => truncatedCloudJson,
        write: async (_slot, json) => {
          healedCloudBlob = json;
          return true;
        },
      },
      triggerHaptic: async () => false,
      onOverlayChange: () => () => {},
      onPause: () => () => {},
      onResume: () => () => {},
    });
    expect(healed.updated).toBe(true);
    expect(healed.merged.bestStars).toEqual(remoteFull.bestStars);
    expect(healed.merged.heroes?.roster.bran?.xp).toBe(xpForHeroLevel(20));
    expect(healedCloudBlob).not.toBeNull();
    expect(() => JSON.parse(healedCloudBlob!)).not.toThrow();

    // 3. Same resilience when cloudSave.write throws on 3D hydrateProgressFromCloud
    const local3d = createDefaultProgress(LEVELS.length);
    local3d.bestStars[0] = 3;
    local3d.clears[0] = 1;
    const res3d = await hydrateProgressFromCloud(
      local3d,
      LEVELS.length,
      {
        isSteam: true,
        isMobile: false,
        mobilePlatform: 'web',
        overlayActive: false,
        achievements: { unlock: async () => true },
        cloudSave: {
          read: async () => '{"version":2,"unlockedLevelIndex":2,"bestStars":[2,3',
          write: async () => {
            throw new Error('Disk full');
          },
        },
        triggerHaptic: async () => false,
        onOverlayChange: () => () => {},
        onPause: () => () => {},
        onResume: () => () => {},
      },
      LEVELS,
    );
    expect(res3d.merged.bestStars[0]).toBe(3);
    expect(res3d.merged.bestStars[1]).toBe(3);
  });
});

describe('Save Robustness v2 — Corrupted / Partial Save Recovery', () => {
  it('salvages truncated 2D and 3D JSON across every cut offset without throwing and preserves forensic backups', () => {
    const store = installMemoryStorage();
    const rich = buildRich25IslandSave();
    saveProgress2D(rich, LEVELS_2D);
    const fullRaw = store.get(PROGRESS_2D_KEY)!;

    let recoveredSomeStars = 0;
    for (let cut = 24; cut < fullRaw.length; cut += 19) {
      store.clear();
      const truncated = fullRaw.slice(0, cut);
      store.set(PROGRESS_2D_KEY, truncated);
      const loaded = loadProgress2D(LEVELS_2D);
      assertStrictProgressV2(loaded, LEVELS_2D.length);
      expect(store.get(PROGRESS_2D_CORRUPT_BACKUP_KEY)).toBe(truncated);
      if (loaded.bestStars.some((s) => s > 0)) recoveredSomeStars++;
    }
    expect(recoveredSomeStars).toBeGreaterThan(20);

    // 3D loadProgress also salvages truncated JSON and writes PROGRESS_CORRUPT_BACKUP_KEY once
    store.clear();
    store.set('skyhold_isles_progress_v1', '{"version":2,"unlockedLevelIndex":3,"bestStars":[3,2,3],"clears":[1,1');
    const rec3d = loadProgress(LEVELS.length);
    expect(rec3d.bestStars.slice(0, 3)).toEqual([3, 2, 3]);
    expect(rec3d.unlockedLevelIndex).toBe(3);
    expect(store.get(PROGRESS_CORRUPT_BACKUP_KEY)).toContain('"bestStars":[3,2,3]');

    // Direct tryRepairTruncatedJson handles escaped quotes and rejects mismatched brackets
    expect(tryRepairTruncatedJson('{"a":"hello \\"world","b":[1,2')).toEqual({ a: 'hello "world', b: [1, 2] });
    expect(tryRepairTruncatedJson('{]')).toBeNull();
    expect(tryRepairTruncatedJson('not an object')).toBeNull();
  });

  it('auto-recovers corrupted PROGRESS_2D_KEY from cloud mirror and merges all backup slots via recoverProgress2D / recoverProgressSave', () => {
    const store = installMemoryStorage();

    // 1. Double-encoded Stored2D wrapper (`progress` serialized as string) loads cleanly
    const inner = createDefaultProgress(LEVELS_2D.length);
    inner.bestStars[0] = 3;
    inner.clears[0] = 1;
    store.set(PROGRESS_2D_KEY, JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: JSON.stringify(inner) }));
    expect(loadProgress2D(LEVELS_2D).bestStars[0]).toBe(3);

    // 2. Completely unparseable primary slot auto-recovers from mirrored `skyhold_isles_cloud_progress2d`
    const mirrorProg = createDefaultProgress(LEVELS_2D.length);
    mirrorProg.bestStars[1] = 3;
    mirrorProg.clears[1] = 1;
    store.set(
      `skyhold_isles_cloud_${CLOUD_PROGRESS_2D_SLOT}`,
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: mirrorProg }),
    );
    store.set(PROGRESS_2D_KEY, '{completely_corrupt_slot');
    const autoRec = loadProgress2D(LEVELS_2D);
    expect(autoRec.bestStars[1]).toBe(3);

    // 3. Explicit recoverProgress2D merges truncated primary + cloud mirror + importBackup (+ optional resetBackup)
    const importBkp = createDefaultProgress(LEVELS_2D.length);
    importBkp.bestStars[2] = 2;
    importBkp.clears[2] = 1;
    store.set(
      PROGRESS_2D_IMPORT_BACKUP_KEY,
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: importBkp }),
    );
    const resetBkp = createDefaultProgress(LEVELS_2D.length);
    resetBkp.bestStars[4] = 3;
    resetBkp.clears[4] = 1;
    store.set(
      PROGRESS_2D_RESET_BACKUP_KEY,
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: resetBkp }),
    );
    store.set(PROGRESS_2D_KEY, '{"ids":["l1c"],"progress":{"version":2,"bestStars":[3],"clears":[1');

    const withoutReset = recoverProgress2D(LEVELS_2D, { includeResetBackup: false });
    expect(withoutReset.recovered).toBe(true);
    expect(withoutReset.sources).toEqual(['primary', 'cloud', 'importBackup']);
    expect(withoutReset.progress.bestStars.slice(0, 5)).toEqual([3, 3, 2, 0, 0]);

    const withReset = recoverProgress2D(LEVELS_2D, { includeResetBackup: true });
    expect(withReset.progress.bestStars.slice(0, 5)).toEqual([3, 3, 2, 0, 3]);

    // 4. Explicit 3D recoverProgressSave merges import backup + reset backup when requested
    store.clear();
    const p3dA = createDefaultProgress(LEVELS.length);
    p3dA.bestStars[0] = 3;
    p3dA.clears[0] = 1;
    saveLocalProgress(p3dA);
    backupProgressBeforeImport();
    resetProgressSave(LEVELS.length);
    const p3dRec = recoverProgressSave(LEVELS.length, { includeResetBackup: true });
    expect(p3dRec.recovered).toBe(true);
    expect(p3dRec.progress.bestStars[0]).toBe(3);
  });
});

describe('Save Robustness v2 — Version Migration & Algebraic Merge Fuzz', () => {
  it('fuzzes 300 cross-version (v0/v1/v2/v3/v99) saves across 25 islands: migration, remap, save-code round-trip, commutativity & idempotence', () => {
    const rng = new SeededRng(0x2026_1120);
    const versions = [undefined, 0, 1, 2, 3, 99, -1, '1', '2', NaN];

    const genSave = (): ProgressData => {
      const len = rng.int(1, 28);
      const raw: Record<string, unknown> = {
        version: versions[rng.int(0, versions.length - 1)],
        unlockedLevelIndex: rng.chance(0.85) ? rng.int(0, 26) : 'corrupt',
        bestStars: Array.from({ length: len }, () => (rng.chance(0.6) ? rng.int(0, 4) : -1)),
        clears: Array.from({ length: len }, () => (rng.chance(0.5) ? rng.int(0, 5) : 0)),
        bestLives: Array.from({ length: len }, () => rng.int(0, 25)),
        bestEndlessWaves: Array.from({ length: len }, () => (rng.chance(0.3) ? rng.int(10, 40) : 0)),
        challengeClears: Array.from({ length: len }, () =>
          rng.chance(0.35) ? [CHALLENGE_IDS[rng.int(0, CHALLENGE_IDS.length - 1)]] : [],
        ),
        daily: {
          lastDay: rng.chance(0.7) ? 20_500 + rng.int(0, 8) : -1,
          streak: rng.int(0, 6),
          bestStreak: rng.int(0, 10),
          total: rng.int(0, 20),
        },
      };
      if (rng.chance(0.7)) {
        const w: Record<string, number> = {};
        for (const u of WORKSHOP_UPGRADES) {
          if (rng.chance(0.45)) w[u.id] = rng.int(0, u.costs.length);
        }
        raw.workshop = w;
      }
      if (rng.chance(0.75)) {
        const roster: Record<string, unknown> = {};
        for (const hid of HERO_IDS) {
          const lvl = rng.int(1, 20);
          roster[hid] = {
            xp: xpForHeroLevel(lvl) + rng.int(0, 80),
            skills: rng.chance(0.8) ? defaultSkillsForLevel(hid, lvl) : ['unknown_skill'],
          };
        }
        raw.heroes = { selectedHero: HERO_IDS[rng.int(0, HERO_IDS.length - 1)], roster };
      }
      if (rng.chance(0.65)) {
        raw.difficultyWins = {
          easy: Array.from({ length: len }, () => (rng.chance(0.35) ? rng.int(0, 2) : 0)),
          normal: Array.from({ length: len }, () => (rng.chance(0.5) ? rng.int(0, 3) : 0)),
          hard: Array.from({ length: len }, () => (rng.chance(0.35) ? rng.int(0, 3) : 0)),
        };
      }

      const oldIds =
        rng.chance(0.3)
          ? [...LEVELS_2D.slice(0, 17).map((l) => l.id), { ...LEVEL_L1C, id: 'retired_test' }.id]
          : LEVELS_2D.map((l) => l.id);
      const firstPass = remapProgress(raw, oldIds, LEVELS_2D);
      assertStrictProgressV2(firstPass, LEVELS_2D.length);
      // Stabilize pass-1 non-finite unlock clamping (`'corrupt'` -> 0 on pass 1, walked on pass 2)
      const stabilized = remapProgress(
        firstPass,
        LEVELS_2D.map((l) => l.id),
        LEVELS_2D,
      );
      assertStrictProgressV2(stabilized, LEVELS_2D.length);
      return stabilized;
    };

    let prev = genSave();
    for (let i = 0; i < 300; i++) {
      const cur = genSave();

      // Save-code round-trip preserves exact 25-island state (filtering only Daily-only `championHost` badge if rolled)
      const code = encodeSaveCode2D(cur, LEVELS_2D);
      const decoded = decodeSaveCode2D(code, LEVELS_2D);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        assertStrictProgressV2(decoded.progress, LEVELS_2D.length);
        expect(decoded.progress).toEqual(cur);
      }

      // Algebraic merge laws across 25 islands: commutativity, idempotence, and monotonicity
      const m1 = mergeProgress(prev, cur, LEVELS_2D.length);
      const m2 = mergeProgress(cur, prev, LEVELS_2D.length);
      expect(m1).toEqual(m2);
      expect(mergeProgress(m1, m1, LEVELS_2D.length)).toEqual(m1);
      assertStrictProgressV2(m1, LEVELS_2D.length);

      const dwPrev = difficultyWinsOf(prev);
      const dwCur = difficultyWinsOf(cur);
      const dwMerged = difficultyWinsOf(m1);
      for (let k = 0; k < LEVELS_2D.length; k++) {
        expect(m1.bestStars[k]).toBeGreaterThanOrEqual(Math.max(prev.bestStars[k], cur.bestStars[k]));
        expect(dwMerged.hard[k]).toBeGreaterThanOrEqual(Math.max(dwPrev.hard[k], dwCur.hard[k]));
      }
      for (const hid of HERO_IDS) {
        expect(m1.heroes!.roster[hid]!.xp).toBe(
          Math.max(prev.heroes!.roster[hid]!.xp, cur.heroes!.roster[hid]!.xp),
        );
      }

      prev = cur;
    }
  }, 30_000);

  it('recoverProgressSave (3D) merges PROGRESS_CORRUPT_BACKUP_KEY even after primary slot was overwritten', () => {
    const store = installMemoryStorage();
    const original = createDefaultProgress(LEVELS.length);
    original.bestStars[0] = 3;
    original.bestStars[1] = 3;
    original.bestStars[2] = 2;
    original.clears[0] = 1;
    original.clears[1] = 1;
    original.clears[2] = 1;
    original.unlockedLevelIndex = 3;
    const fullRaw = JSON.stringify(original);
    // Truncate near the end so loadProgress salvages prefix & writes forensic PROGRESS_CORRUPT_BACKUP_KEY
    const truncated = fullRaw.slice(0, fullRaw.length - 6);
    store.set('skyhold_isles_progress_v1', truncated);
    const loadedFromTrunc = loadProgress(LEVELS.length);
    expect(loadedFromTrunc.bestStars[0]).toBe(3);
    expect(store.get(PROGRESS_CORRUPT_BACKUP_KEY)).toBe(truncated);

    // Suppose primary slot is later overwritten with only island 0 cleared (e.g. fresh session before recovery):
    const tiny = createDefaultProgress(LEVELS.length);
    tiny.bestStars[0] = 1;
    tiny.clears[0] = 1;
    saveLocalProgress(tiny);

    const rec = recoverProgressSave(LEVELS.length);
    expect(rec.recovered).toBe(true);
    expect(rec.sources).toContain('corruptBackup');
    expect(rec.progress.bestStars.slice(0, 3)).toEqual([3, 3, 2]);
  });
});
