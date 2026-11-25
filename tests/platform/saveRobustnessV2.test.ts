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
  tryRepairTruncatedJsonArray,
} from '../../src/platform/index.ts';
import {
  backupProgressBeforeImport,
  createDefaultProgress,
  loadProgress,
  loadSettings,
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

  it('salvages truncated JSON arrays (STORY_SEEN_KEY) and truncated settings JSON without losing prior entries', async () => {
    const store = installMemoryStorage();
    expect(tryRepairTruncatedJsonArray('["l1c:intro","i01:intro","i02:int')).toEqual([
      'l1c:intro',
      'i01:intro',
    ]);
    expect(tryRepairTruncatedJsonArray('not-an-array')).toBeNull();

    // Truncated STORY_SEEN_KEY preserves seen beats across subsequent markStorySeen writes
    store.set('skyhold_isles_story2d_seen_v1', '["l1c:intro","l1c:outro","i01:int');
    const { storySeen, markStorySeen } = await import('../../src/render2d/ui/progress2d.ts');
    expect(storySeen('l1c', 'intro')).toBe(true);
    expect(storySeen('l1c', 'outro')).toBe(true);
    markStorySeen('i02', 'intro');
    expect(storySeen('l1c', 'intro')).toBe(true);
    expect(storySeen('i02', 'intro')).toBe(true);

    // Truncated SETTINGS_KEY preserves muted / masterVolume / cameraShake fields written before cutoff
    store.set(
      'skyhold_isles_settings_v1',
      '{"masterVolume":0.22,"muted":true,"cameraShake":false,"damageNu',
    );
    const settings = loadSettings();
    expect(settings.masterVolume).toBeCloseTo(0.22, 5);
    expect(settings.muted).toBe(true);
    expect(settings.cameraShake).toBe(false);
  });

  it('preserves mirror daily, challengeClears, workshop, difficultyWins, and heroes when primary JSON truncates mid-object, and backs up truncated saves before import', async () => {
    const store = installMemoryStorage();
    const { backupProgressBeforeImport, PROGRESS_IMPORT_BACKUP_KEY } = await import(
      '../../src/platform/storage.ts'
    );
    const { PROGRESS_2D_IMPORT_BACKUP_KEY } = await import('../../src/render2d/ui/progress2d.ts');

    // Mirror has full 12★ progress, challenge badges, 7-day Daily streak, Workshop upgrades, Hard ribbon, and L10 Mira:
    const mirror = createDefaultProgress(LEVELS.length);
    for (let i = 0; i < 4; i++) {
      mirror.bestStars[i] = 3;
      mirror.clears[i] = 2;
    }
    mirror.unlockedLevelIndex = 4;
    mirror.challengeClears[0] = ['bowless'];
    mirror.daily = { lastDay: 20500, streak: 7, bestStreak: 7, total: 11 };
    mirror.workshop = { treasury: 2, bastion: 1 };
    mirror.difficultyWins = {
      easy: new Array<number>(LEVELS.length).fill(0),
      normal: new Array<number>(LEVELS.length).fill(0),
      hard: new Array<number>(LEVELS.length).fill(0),
    };
    mirror.difficultyWins.hard[0] = 3;
    mirror.heroes = {
      selectedHero: 'mira',
      roster: { mira: { xp: xpForHeroLevel(10), skills: ['mira_emb_1'] } },
    };
    store.set('skyhold_isles_cloud_progress', JSON.stringify(mirror));

    // Primary save gained island 4 (3★) and Day 20501, but truncated mid-`daily` so streak/total/workshop/heroes were cut off!
    const truncatedPrimary =
      '{"version":2,"unlockedLevelIndex":5,"bestStars":[3,3,3,3,3],"clears":[2,2,2,2,1],"workshop":{},"challengeClears":[[]],"daily":{"lastDay":20501,"str';
    store.set('skyhold_isles_progress_v1', truncatedPrimary);

    const recovered = loadProgress(LEVELS.length);
    expect(recovered.bestStars.slice(0, 5)).toEqual([3, 3, 3, 3, 3]);
    expect(recovered.unlockedLevelIndex).toBe(5);
    expect(recovered.challengeClears[0]).toEqual(['bowless']);
    expect(recovered.daily.bestStreak).toBeGreaterThanOrEqual(7);
    expect(recovered.daily.total).toBe(11);
    expect(recovered.workshop).toEqual({ treasury: 2, bastion: 1 });
    expect(recovered.difficultyWins?.hard[0]).toBe(3);
    expect(recovered.heroes?.selectedHero).toBe('mira');
    expect(recovered.heroes?.roster.mira?.xp).toBe(xpForHeroLevel(10));

    // backupProgressBeforeImport refreshes an older import backup when PROGRESS_KEY holds a truncated save with real progress:
    store.set(PROGRESS_IMPORT_BACKUP_KEY, '{"version":2,"unlockedLevelIndex":0,"bestStars":[1]}');
    backupProgressBeforeImport();
    const savedImportBackup = JSON.parse(store.get(PROGRESS_IMPORT_BACKUP_KEY)!);
    expect(savedImportBackup.bestStars.slice(0, 5)).toEqual([3, 3, 3, 3, 3]);

    // importSaveCode2D writes a valid serialized backup of current 2D progress (not raw garbage) when primary was corrupted & recovered from cloud mirror:
    store.set('skyhold_isles_progress2d_v1', '{corrupt-unterminated-garbage');
    const mirror2D = createDefaultProgress(LEVELS_2D.length);
    mirror2D.bestStars[0] = 3;
    mirror2D.clears[0] = 1;
    store.set(
      'skyhold_isles_cloud_progress2d',
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: mirror2D }),
    );
    const incoming2D = createDefaultProgress(LEVELS_2D.length);
    incoming2D.bestStars[1] = 2;
    incoming2D.clears[1] = 1;
    const imp = importSaveCode2D(encodeSaveCode2D(incoming2D, LEVELS_2D), LEVELS_2D);
    expect(imp.ok).toBe(true);
    expect(store.get(PROGRESS_2D_IMPORT_BACKUP_KEY)).toBeTruthy();
    const parsedBackup2D = JSON.parse(store.get(PROGRESS_2D_IMPORT_BACKUP_KEY)!);
    expect(parsedBackup2D.progress.bestStars[0]).toBe(3);
  });

  it('salvages trailing-garbage JSON, mismatched closing brackets, punctuation-heavy strings, and 25->16 backup Workshop/hero candidates', async () => {
    const store = installMemoryStorage();
    const { tryRepairTruncatedJson } = await import('../../src/platform/storage.ts');

    // 1. Non-atomic overwrite leaving trailing bytes after a complete JSON container:
    expect(
      tryRepairTruncatedJson('{"version":2,"unlockedLevelIndex":4,"bestStars":[3,3,2]}0,0,0],"stale":true}}'),
    ).toEqual({
      version: 2,
      unlockedLevelIndex: 4,
      bestStars: [3, 3, 2],
    });
    expect(tryRepairTruncatedJsonArray('["l1c:intro","i01:intro"]trailing_bytes]')).toEqual([
      'l1c:intro',
      'i01:intro',
    ]);

    // 2. Mismatched closing bracket at truncation boundary (`}` inside `[`) salvages full prefix including final element:
    expect(
      tryRepairTruncatedJson('{"version":2,"unlockedLevelIndex":3,"bestStars":[3,3,2}'),
    ).toEqual({
      version: 2,
      unlockedLevelIndex: 3,
      bestStars: [3, 3, 2],
    });

    // 3. Structural punctuation `{ [ } ] ,` inside string values + trailing comma inside closed array:
    expect(
      tryRepairTruncatedJson('{"version":2,"note":"a{b[c}d]e,f","bestStars":[3,2,'),
    ).toEqual({
      version: 2,
      note: 'a{b[c}d]e,f',
      bestStars: [3, 2],
    });
    expect(tryRepairTruncatedJson('{"version":2,"bestStars":[3,2,]}')).toEqual({
      version: 2,
      bestStars: [3, 2],
    });

    // 4. recoverProgressSave(16) preserves legitimate Workshop + selectedHero from a 25-island backup when primary holds complementary stars/clears,
    // while still rejecting cheated Workshop saves that exceed even their own stars:
    const primary16 = createDefaultProgress(LEVELS.length);
    for (let i = 0; i < 10; i++) {
      primary16.bestStars[i] = 3;
      primary16.clears[i] = 1;
    }
    primary16.unlockedLevelIndex = 10;
    saveLocalProgress(primary16);

    const backup25 = createDefaultProgress(25);
    for (let i = 16; i < 22; i++) {
      backup25.bestStars[i] = 3; // 18★ on islands 16..21 -> legitimate 8★ Workshop spend!
      backup25.clears[i] = 1;
    }
    backup25.workshop = { treasury: 2, bastion: 2 };
    backup25.heroes = {
      selectedHero: 'sela',
      roster: { sela: { xp: xpForHeroLevel(8), skills: [] } },
    };
    // Make backup25 have at least 10 clears on 0..24 so sela was unlocked on backup25:
    for (let i = 10; i < 16; i++) backup25.clears[i] = 1;
    store.set('skyhold_isles_progress_import_backup', JSON.stringify(backup25));

    const rec = recoverProgressSave(LEVELS.length, { persist: false });
    expect(rec.recovered).toBe(true);
    expect(rec.progress.workshop).toEqual({ treasury: 2, bastion: 2 });
    expect(rec.progress.heroes?.selectedHero).toBe('sela');

    // Cheated backup (0 stars everywhere, impossible Workshop) is still rejected to `{}`:
    store.clear();
    const cheated = createDefaultProgress(25);
    cheated.bestStars[0] = 1;
    cheated.clears[0] = 1;
    cheated.workshop = { treasury: 3, bastion: 3 };
    store.set('skyhold_isles_progress_v1', JSON.stringify(cheated));
    const cheatedRec = recoverProgressSave(LEVELS.length, { persist: false });
    expect(cheatedRec.progress.workshop).toEqual({});
  });

  it('salvages early mid-object corruption followed by >200 structural tokens, merges cloud mirror in backupProgressBeforeImport, and clears 3D hint flags on resetProgressSave', async () => {
    const store = installMemoryStorage();
    const {
      backupProgressBeforeImport,
      hasSeenEnemyIntro,
      hasSeenFlyerToast,
      hasSeenUpgradeToast,
      markEnemyIntroSeen,
      markFlyerToastSeen,
      markUpgradeToastSeen,
      PROGRESS_IMPORT_BACKUP_KEY,
      resetProgressSave,
      tryRepairTruncatedJson,
    } = await import('../../src/platform/storage.ts');
    const { PROGRESS_2D_IMPORT_BACKUP_KEY } = await import('../../src/render2d/ui/progress2d.ts');

    // 1. Full 25-island Stored2D (~450 structural cuts) with corruption in `clears` followed by >300 intact tokens in challengeClears + difficultyWins + heroes:
    const full25 = createDefaultProgress(LEVELS_2D.length);
    for (let i = 0; i < 12; i++) {
      full25.bestStars[i] = 3;
      full25.clears[i] = 2;
    }
    full25.difficultyWins = {
      easy: new Array<number>(LEVELS_2D.length).fill(1),
      normal: new Array<number>(LEVELS_2D.length).fill(3),
      hard: new Array<number>(LEVELS_2D.length).fill(3),
    };
    full25.heroes = {
      selectedHero: 'sela',
      roster: {
        bran: { xp: 5000, skills: ['bran_oak_1', 'bran_oak_2', 'bran_van_1', 'bran_van_2'] },
        wren: { xp: 5000, skills: ['wren_bow_1', 'wren_bow_2', 'wren_vol_1', 'wren_vol_2'] },
        mira: { xp: 5000, skills: ['mira_emb_1', 'mira_emb_2', 'mira_wsp_1', 'mira_wsp_2'] },
        tobb: { xp: 5000, skills: ['tobb_clk_1', 'tobb_clk_2', 'tobb_giz_1', 'tobb_giz_2'] },
        sela: { xp: 5000, skills: ['sela_cal_1', 'sela_cal_2', 'sela_thn_1', 'sela_thn_2'] },
      },
    };
    const serialized25 = JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: full25 });
    const corruptedEarly = serialized25.replace('"clears":[2,2,2', '"clears":[2,NaN,2');
    const salvaged = tryRepairTruncatedJson(corruptedEarly) as {
      ids: string[];
      progress: { bestStars: number[]; clears: number[] };
    } | null;
    expect(salvaged).not.toBeNull();
    expect(salvaged!.ids).toHaveLength(LEVELS_2D.length);
    expect(salvaged!.progress.bestStars.slice(0, 12)).toEqual(new Array(12).fill(3));
    expect(salvaged!.progress.clears).toEqual([2]);

    // 2. backupProgressBeforeImport combines truncated primary + cloud mirror and never writes raw garbage:
    store.clear();
    store.set('skyhold_isles_progress_v1', '<<<unparseable-noise>>>');
    backupProgressBeforeImport();
    expect(store.get(PROGRESS_IMPORT_BACKUP_KEY)).toBeUndefined();

    const mirror3D = createDefaultProgress(LEVELS.length);
    mirror3D.bestStars[0] = 3;
    mirror3D.bestStars[1] = 3;
    mirror3D.clears[0] = 1;
    mirror3D.clears[1] = 1;
    store.set('skyhold_isles_cloud_progress', JSON.stringify(mirror3D));
    backupProgressBeforeImport();
    expect(JSON.parse(store.get(PROGRESS_IMPORT_BACKUP_KEY)!).bestStars.slice(0, 2)).toEqual([3, 3]);

    // And importSaveCode2D never writes raw garbage into PROGRESS_2D_IMPORT_BACKUP_KEY when both primary and mirror are unparseable/empty:
    store.clear();
    store.set('skyhold_isles_progress2d_v1', '<<<unparseable-2d-noise>>>');
    const incoming2D = createDefaultProgress(LEVELS_2D.length);
    incoming2D.bestStars[0] = 2;
    incoming2D.clears[0] = 1;
    expect(importSaveCode2D(encodeSaveCode2D(incoming2D, LEVELS_2D), LEVELS_2D).ok).toBe(true);
    expect(store.get(PROGRESS_2D_IMPORT_BACKUP_KEY)).toBeUndefined();

    // 3. resetProgressSave clears 3D onboarding/hint keys + in-memory enemyIntrosSeen cache (settings untouched):
    markEnemyIntroSeen('healer');
    markFlyerToastSeen();
    markUpgradeToastSeen();
    expect(hasSeenEnemyIntro('healer')).toBe(true);
    expect(hasSeenFlyerToast()).toBe(true);
    expect(hasSeenUpgradeToast()).toBe(true);

    resetProgressSave(LEVELS.length);
    expect(hasSeenEnemyIntro('healer')).toBe(false);
    expect(hasSeenFlyerToast()).toBe(false);
    expect(hasSeenUpgradeToast()).toBe(false);
  });

  it('preserves full-length difficultyWins when bestStars is shorter, pads applyRunResult2D densely, and guards partial difficultyWins across 2D helpers', async () => {
    installMemoryStorage();
    const { describeMergeGain, mergeProgress } = await import('../../src/platform/saveCode.ts');
    const { hasAnyProgress } = await import('../../src/platform/storage.ts');
    const { clearedIslandsCount2D, heroRoster, isHeroUnlocked } = await import(
      '../../src/render2d/heroes2d.ts'
    );
    const { availableChallenges, canPlayEndless, dailyForToday, resolveQueryRun2D } = await import(
      '../../src/render2d/ui/modes2d.ts'
    );
    const { inferSeenFromProgress } = await import('../../src/platform/contentStorage.ts');
    const { NEUTRAL_RUN_MODIFIERS } = await import('../../src/data/runModifiers.ts');
    const { applyRunResult2D, islandStates, loadProgress2D, recordRunResult2D } = await import(
      '../../src/render2d/ui/progress2d.ts'
    );

    const i24 = LEVELS_2D.findIndex(l => l.id === 'i24');
    // 1. Short/empty bestStars + full-length difficultyWins (Hard win on i24) must NOT truncate at bestStars.length:
    const shortStarsWithCh2Hard = {
      ...createDefaultProgress(0),
      difficultyWins: {
        easy: new Array<number>(LEVELS_2D.length).fill(0),
        normal: new Array<number>(LEVELS_2D.length).fill(0),
        hard: Array.from({ length: LEVELS_2D.length }, (_, idx) => (idx === i24 ? 3 : 0)),
      },
    };
    const empty25 = createDefaultProgress(LEVELS_2D.length);
    const merged = mergeProgress(empty25, shortStarsWithCh2Hard, LEVELS_2D.length);
    expect(merged.difficultyWins?.hard[i24]).toBe(3);
    expect(merged.bestStars[i24]).toBe(3);
    expect(describeMergeGain(empty25, shortStarsWithCh2Hard)).toContain('+1 Hard ribbon');

    const states = islandStates(shortStarsWithCh2Hard, LEVELS_2D);
    expect(states).toHaveLength(LEVELS_2D.length);
    expect(states[i24].hardWon).toBe(true);
    expect(states[i24].stars).toBe(3);

    // 2. applyRunResult2D on a 17-island ProgressData winning i24 pads arrays densely with zero sparse holes.
    expect(LEVELS_2D[i24 + 1].id).toBe('i28');
    const short17 = createDefaultProgress(17);
    applyRunResult2D(
      short17,
      {
        levelId: 'i24',
        won: true,
        stars: 3,
        livesRemaining: 19,
        waveReached: LEVELS_2D[i24].waves.length,
        runConfig: { endless: false, challenges: [], daily: null, difficulty: 'hard' },
      },
      LEVELS_2D,
    );
    expect(short17.bestStars).toHaveLength(LEVELS_2D.length);
    expect(short17.bestStars.includes(undefined as unknown as number)).toBe(false);
    expect(short17.difficultyWins?.hard).toHaveLength(LEVELS_2D.length);
    expect(short17.difficultyWins?.hard[i24]).toBe(3);
    expect(short17.bestStars[i24]).toBe(3);
    // Nothing leaks onto the island that now sits at the old flat index 24 (i22).
    expect(short17.difficultyWins?.hard[LEVELS_2D.findIndex(l => l.id === 'i22')]).toBe(0);

    // 3. Partial raw difficultyWins (`{ hard: [3, 2, 3] }` missing `easy` & `normal`) + NaN/Infinity entries never throw:
    const partialRaw = {
      version: 2,
      unlockedLevelIndex: Number.NaN,
      bestStars: [Number.POSITIVE_INFINITY, Number.NaN],
      bestEndlessWaves: [],
      bestLives: [],
      clears: [Number.NaN],
      workshop: {},
      challengeClears: [null as unknown as string[]],
      daily: { lastDay: 0, streak: 0, bestStreak: 0, total: 0 },
      difficultyWins: { hard: [3, 2, 3] } as unknown as ProgressData['difficultyWins'],
    } as ProgressData;

    expect(hasAnyProgress(partialRaw)).toBe(true);
    expect(clearedIslandsCount2D(partialRaw, LEVELS_2D)).toBe(3);
    expect(isHeroUnlocked(partialRaw, 'wren', LEVELS_2D)).toBe(true);
    expect(heroRoster(partialRaw, LEVELS_2D)).toHaveLength(5);
    expect(canPlayEndless('l1c', partialRaw, LEVELS_2D)).toBe(true);
    expect(canPlayEndless('i03', partialRaw, LEVELS_2D)).toBe(false);
    expect(availableChallenges('l1c', partialRaw, LEVELS_2D).length).toBeGreaterThan(0);
    expect(dailyForToday(Date.UTC(2026, 10, 20), partialRaw, LEVELS_2D)).not.toBeNull();

    // 4. recordRunResult2D records & persists wonChallenges even when levelId is outside the passed levels list:
    recordRunResult2D(
      {
        levelId: 'custom-daily-stage',
        won: true,
        stars: 2,
        livesRemaining: 15,
        waveReached: 10,
        runConfig: { endless: false, challenges: ['staticFree'], daily: null },
      },
      LEVELS_2D,
    );
    expect(loadProgress2D(LEVELS_2D).wonChallenges).toContain('staticFree');

    // 5. Compact `{ e, n, h }` difficultyWins & dirty/zero-rank workshop in resolveQueryRun2D / inferSeenFromProgress:
    const dirtyWorkshopAndCompactDw = {
      ...createDefaultProgress(0),
      workshop: { quickcast: 0, retiredNode: 2, bad: Number.NaN } as unknown as ProgressData['workshop'],
      difficultyWins: { h: [3] } as unknown as ProgressData['difficultyWins'],
    };
    expect(hasAnyProgress(dirtyWorkshopAndCompactDw)).toBe(true);
    expect(inferSeenFromProgress(LEVELS_2D, dirtyWorkshopAndCompactDw).length).toBeGreaterThan(0);
    const resolvedNeutral = resolveQueryRun2D(
      new URLSearchParams('level=l1c'),
      dirtyWorkshopAndCompactDw,
      { levels: LEVELS_2D, warn: () => undefined },
    );
    expect(resolvedNeutral.modifiers).toBe(NEUTRAL_RUN_MODIFIERS);
  });

  it('preserves compact hero saves (`{ s, r }` / `h`) across remapProgress, loadProgress2D, heroes2d, encodeSaveCode, mergeProgress, and guards hasAnyProgress against dirty empty shapes', async () => {
    const store = installMemoryStorage();
    const { decodeSaveCode, describeMergeGain, encodeSaveCode, mergeProgress } = await import(
      '../../src/platform/saveCode.ts'
    );
    const { hasAnyProgress, loadProgress } = await import('../../src/platform/storage.ts');
    const { HERO_LEVEL_XP, heroRoster, migrateHeroSave, resolveHeroForRun } = await import(
      '../../src/render2d/heroes2d.ts'
    );
    const { loadProgress2D, PROGRESS_2D_KEY, remapProgress } = await import(
      '../../src/render2d/ui/progress2d.ts'
    );

    // 1. remapProgress (same IDs, reordered IDs, and empty levels) + migrateHeroSave preserve compact `{ s, r: { mira: { x, k } } }`!
    const compactRaw2D = {
      version: 2,
      unlockedLevelIndex: 6,
      bestStars: [3, 3, 3, 3, 3, 3],
      bestEndlessWaves: [],
      bestLives: [],
      clears: [1, 1, 1, 1, 1, 1],
      workshop: {},
      challengeClears: [],
      daily: { lastDay: 0, streak: 0, bestStreak: 0, total: 0 },
      h: {
        s: 'mira',
        r: {
          bran: { x: 250 },
          mira: { x: HERO_LEVEL_XP[9], k: ['mira_emb_1', 'mira_emb_2'] },
        },
      },
      dw: { h: [3, 3, 0, 0, 0, 3] },
      wc: ['staticFree'],
    };

    const sameRemapped = remapProgress(
      compactRaw2D,
      LEVELS_2D.map((l) => l.id),
      LEVELS_2D,
    );
    expect(sameRemapped.heroes?.selectedHero).toBe('mira');
    expect(sameRemapped.heroes?.roster.mira?.xp).toBe(HERO_LEVEL_XP[9]);
    expect(sameRemapped.heroes?.roster.mira?.skills).toEqual(['mira_emb_1', 'mira_emb_2']);
    expect(sameRemapped.heroes?.roster.bran?.xp).toBe(250);
    expect(sameRemapped.difficultyWins?.hard.slice(0, 6)).toEqual([3, 3, 0, 0, 0, 3]);
    expect(sameRemapped.wonChallenges).toEqual(['staticFree']);

    const ch1Ids = LEVELS_2D.slice(0, 17).map((l) => l.id);
    const diffRemapped = remapProgress(compactRaw2D, ch1Ids, LEVELS_2D);
    expect(diffRemapped.heroes?.selectedHero).toBe('mira');
    expect(diffRemapped.heroes?.roster.mira?.xp).toBe(HERO_LEVEL_XP[9]);
    expect(diffRemapped.heroes?.roster.mira?.skills).toEqual(['mira_emb_1', 'mira_emb_2']);

    // Stored in PROGRESS_2D_KEY with compact `h` / mixed `{ selectedHero, roster: { mira: { x, k } } }`:
    store.set(
      PROGRESS_2D_KEY,
      JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: compactRaw2D }),
    );
    const loaded2D = loadProgress2D(LEVELS_2D);
    expect(loaded2D.heroes?.selectedHero).toBe('mira');
    expect(loaded2D.heroes?.roster.mira?.xp).toBe(HERO_LEVEL_XP[9]);
    expect(loaded2D.heroes?.roster.mira?.skills).toEqual(['mira_emb_1', 'mira_emb_2']);

    // Direct heroRoster / resolveHeroForRun / migrateHeroSave on un-migrated compact ProgressData:
    const rawCompactProgress = compactRaw2D as unknown as ProgressData;
    const roster = heroRoster(rawCompactProgress, LEVELS_2D);
    const miraEntry = roster.find((e) => e.id === 'mira')!;
    expect(miraEntry.selected).toBe(true);
    expect(miraEntry.level).toBe(10);
    expect(miraEntry.unlockedSkills).toEqual(['mira_emb_1', 'mira_emb_2']);
    const runHero = resolveHeroForRun(rawCompactProgress, null, null, LEVELS_2D);
    expect(runHero).toEqual({
      heroId: 'mira',
      level: 10,
      skills: ['mira_emb_1', 'mira_emb_2'],
    });
    expect(
      migrateHeroSave(
        { selectedHero: 'mira', roster: { mira: { x: HERO_LEVEL_XP[4], k: ['mira_emb_1'] } } },
        sameRemapped,
        LEVELS_2D,
      ).roster.mira,
    ).toEqual({ xp: HERO_LEVEL_XP[4], skills: ['mira_emb_1'] });

    // 2. encodeSaveCode + mergeProgress + describeMergeGain honor compact `h`, `dw`, and `wc`:
    const encodedCompact = encodeSaveCode(rawCompactProgress, LEVELS_2D.map((l) => l.id));
    const decodedCompact = decodeSaveCode(encodedCompact, LEVELS_2D.length);
    expect(decodedCompact.ok).toBe(true);
    if (decodedCompact.ok) {
      expect(decodedCompact.progress.heroes?.selectedHero).toBe('mira');
      expect(decodedCompact.progress.heroes?.roster.mira?.xp).toBe(HERO_LEVEL_XP[9]);
      expect(decodedCompact.progress.difficultyWins?.hard[5]).toBe(3);
      expect(decodedCompact.progress.wonChallenges).toEqual(['staticFree']);
    }

    const empty25 = createDefaultProgress(LEVELS_2D.length);
    const mergedCompact = mergeProgress(empty25, rawCompactProgress, LEVELS_2D.length);
    expect(mergedCompact.heroes?.selectedHero).toBe('mira');
    expect(mergedCompact.heroes?.roster.mira?.xp).toBe(HERO_LEVEL_XP[9]);
    expect(mergedCompact.difficultyWins?.hard[5]).toBe(3);
    expect(mergedCompact.wonChallenges).toEqual(['staticFree']);

    const gainSummary = describeMergeGain(empty25, rawCompactProgress);
    expect(gainSummary).toContain('hero XP');
    expect(gainSummary).toContain('+3 Hard ribbons');
    expect(gainSummary).toContain('+1 challenge win');

    // 3. hasAnyProgress rejects dirty empty shapes (preventing truncated `{"heroes":{` from shadowing cloud mirrors):
    expect(
      hasAnyProgress({
        ...createDefaultProgress(5),
        heroes: {} as unknown as ProgressData['heroes'],
        workshop: { startingGold: 0, bogus: 99, quickcast: Number.NaN } as unknown as ProgressData['workshop'],
        wonChallenges: ['notAChallenge'],
        challengeClears: [[123 as unknown as string]],
      }),
    ).toBe(false);
    expect(
      hasAnyProgress({
        ...createDefaultProgress(5),
        heroes: { s: 'bran', r: { bran: { x: 0, k: [] } } } as unknown as ProgressData['heroes'],
      }),
    ).toBe(false);
    expect(
      hasAnyProgress({
        ...createDefaultProgress(5),
        heroes: { selectedHero: 'notAHero' as never, roster: {} },
      }),
    ).toBe(false);
    expect(hasAnyProgress(rawCompactProgress)).toBe(true);

    // Truncated primary `{"version":2,"heroes":{` in 3D & 2D falls through cleanly to intact cloud mirror:
    store.clear();
    store.set('skyhold_isles_progress_v1', '{"version":2,"heroes":{');
    const clean3DMirror = createDefaultProgress(LEVELS.length);
    clean3DMirror.bestStars[0] = 3;
    clean3DMirror.clears[0] = 1;
    store.set('skyhold_isles_cloud_progress', JSON.stringify(clean3DMirror));
    expect(loadProgress(LEVELS.length).bestStars[0]).toBe(3);
  });

  it('preserves mixed full+compact hero/difficulty payloads and honors top-level `dw` + partial ProgressData across 2D, achievements, saveCode, and contentStorage', async () => {
    const { earnedSteamAchievementIds, STEAM_ACHIEVEMENTS } = await import(
      '../../src/platform/achievements.ts'
    );
    const { inferSeenFromProgress } = await import('../../src/platform/contentStorage.ts');
    const { describeMergeGain, mergeProgress } = await import('../../src/platform/saveCode.ts');
    const { hasAnyProgress, migrateProgress } = await import('../../src/platform/storage.ts');
    const { HERO_LEVEL_XP, clearedIslandsCount2D, isHeroUnlocked, migrateHeroSave, resolveHeroForRun } =
      await import('../../src/render2d/heroes2d.ts');
    const { availableChallenges, canPlayEndless, dailyForToday } = await import(
      '../../src/render2d/ui/modes2d.ts'
    );
    const { applyRunResult2D, islandStates, isUnlocked2D } = await import(
      '../../src/render2d/ui/progress2d.ts'
    );

    // 1. Mixed full+compact hero entries (`{ xp, k }`, `{ x, skills }`, and split `{ roster, r }`) + mixed `{ easy, h }`:
    const mixedRaw = {
      version: 2,
      unlockedLevelIndex: 0,
      bestStars: [],
      bestEndlessWaves: [],
      bestLives: [],
      clears: [],
      workshop: {},
      challengeClears: [],
      daily: { lastDay: 0, streak: 0, bestStreak: 0, total: 0 },
      heroes: {
        s: 'mira',
        roster: {
          bran: { xp: 400, k: ['bran_iron_1'] },
          wren: { x: HERO_LEVEL_XP[4], skills: ['wren_bow_1'] },
        },
        r: {
          mira: { x: HERO_LEVEL_XP[9], k: ['mira_emb_1', 'mira_emb_2'] },
        },
      },
      dw: { easy: [1], h: [3, 3, 3, 3] },
    } as unknown as ProgressData;

    const migrated = migrateProgress(mixedRaw, LEVELS_2D.length);
    expect(migrated.difficultyWins?.easy[0]).toBe(1);
    expect(migrated.difficultyWins?.hard.slice(0, 4)).toEqual([3, 3, 3, 3]);
    expect(migrated.bestStars.slice(0, 4)).toEqual([3, 3, 3, 3]);
    expect(migrated.heroes?.selectedHero).toBe('mira');
    expect(migrated.heroes?.roster.bran).toEqual({ xp: 400, skills: ['bran_iron_1'] });
    expect(migrated.heroes?.roster.wren).toEqual({ xp: HERO_LEVEL_XP[4], skills: ['wren_bow_1'] });
    expect(migrated.heroes?.roster.mira).toEqual({
      xp: HERO_LEVEL_XP[9],
      skills: ['mira_emb_1', 'mira_emb_2'],
    });

    // 2. Direct un-migrated top-level `dw` (`bestStars: [], clears: []`) unlocks heroes, challenges, endless, daily, islandStates, achievements, and codex:
    expect(clearedIslandsCount2D(mixedRaw, LEVELS_2D)).toBe(4);
    expect(isHeroUnlocked(mixedRaw, 'mira', LEVELS_2D)).toBe(true);
    expect(resolveHeroForRun(mixedRaw, null, null, LEVELS_2D)).toEqual({
      heroId: 'mira',
      level: 10,
      skills: ['mira_emb_1', 'mira_emb_2'],
    });
    expect(migrateHeroSave(mixedRaw.heroes, mixedRaw, LEVELS_2D).selectedHero).toBe('mira');
    expect(canPlayEndless('l1c', mixedRaw, LEVELS_2D)).toBe(true);
    expect(availableChallenges('l1c', mixedRaw, LEVELS_2D).length).toBeGreaterThan(0);
    expect(dailyForToday(Date.UTC(2026, 10, 20), mixedRaw, LEVELS_2D)).not.toBeNull();
    expect(inferSeenFromProgress(LEVELS_2D, mixedRaw).length).toBeGreaterThan(0);
    expect(hasAnyProgress({ ...createDefaultProgress(4), difficultyWins: { easy: [0], e: [1] } as never })).toBe(
      true,
    );

    const states = islandStates(mixedRaw, LEVELS_2D);
    expect(states[0].stars).toBe(3);
    expect(states[0].clears).toBe(1);
    expect(states[0].hardWon).toBe(true);
    expect(states[0].diffStars).toEqual({ easy: 1, normal: 0, hard: 3 });

    const earnedIds = earnedSteamAchievementIds(mixedRaw, LEVELS_2D);
    expect(earnedIds).toContain('HERO_MIRA_LV10');
    expect(earnedIds).toContain('HARD_FIRST_RIBBON');
    const miraLv10Ach = STEAM_ACHIEVEMENTS.find((a) => a.id === 'HERO_MIRA_LV10')!;
    expect(miraLv10Ach.isEarned(mixedRaw, LEVELS_2D)).toBe(true);

    const empty25 = createDefaultProgress(LEVELS_2D.length);
    const rawGain = describeMergeGain(empty25, mixedRaw);
    expect(rawGain).toContain('+12★');
    expect(rawGain).toContain('+4 Hard ribbons');
    expect(rawGain).toContain('hero XP');
    expect(mergeProgress(empty25, mixedRaw, LEVELS_2D.length).heroes?.selectedHero).toBe('mira');

    // 3. Partial / non-finite ProgressData never throws or poisons applyRunResult2D / islandStates / isUnlocked2D / describeMergeGain:
    const partialDirty = {
      version: 2,
      unlockedLevelIndex: Number.NaN,
      bestStars: [Number.NaN] as number[],
      clears: [Number.NaN] as number[],
      bestLives: [Number.NaN] as number[],
      bestEndlessWaves: [Number.NaN] as number[],
      challengeClears: [123 as unknown as string[]],
      workshop: {},
      daily: undefined as unknown as ProgressData['daily'],
    } as ProgressData;
    expect(isUnlocked2D(partialDirty, 'l1c', LEVELS_2D)).toBe(true);
    expect(isUnlocked2D(partialDirty, 'i01', LEVELS_2D)).toBe(false);
    expect(islandStates(partialDirty, LEVELS_2D)[0].stars).toBe(0);
    expect(() => describeMergeGain(partialDirty, empty25)).not.toThrow();

    const winRec = applyRunResult2D(
      partialDirty,
      {
        levelId: 'l1c',
        won: true,
        stars: 3,
        livesRemaining: 20,
        waveReached: 8,
        nowMs: Date.UTC(2026, 10, 20),
        runConfig: { endless: false, challenges: [], daily: 20777 },
      },
      LEVELS_2D,
    );
    expect(winRec.win?.stars).toBe(3);
    expect(partialDirty.bestStars[0]).toBe(3);
    expect(partialDirty.clears[0]).toBe(1);
    expect(partialDirty.bestLives[0]).toBe(20);
    expect(partialDirty.unlockedLevelIndex).toBe(1);
    expect(partialDirty.daily.total).toBe(1);
  });
});
