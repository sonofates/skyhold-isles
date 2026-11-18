import { afterEach, describe, expect, it } from 'vitest';
import { HERO_LEVEL_XP, HERO_MAX_LEVEL } from '../../src/data/heroes.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { createDefaultProgress } from '../../src/platform/storage.ts';
import {
  applyHeroXp,
  applyNode,
  canUnlockNode,
  defaultLevel20Skills,
  defaultSkillsForLevel,
  HERO_IDS,
  heroLevel,
  heroLevelProgress,
  heroRoster,
  isHeroUnlocked,
  lastHero,
  migrateHeroSave,
  nodeUnlockStatus,
  resolveHeroForRun,
  respec,
  selectHero,
  xpForHeroLevel,
  xpForRun,
} from '../../src/render2d/heroes2d.ts';
import {
  applyRunResult2D,
  loadProgress2D,
  PROGRESS_2D_KEY,
  recordRunResult2D,
  remapProgress,
  respecHero2D,
  saveProgress2D,
  selectHero2D,
  unlockHeroNode2D,
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
  if ('localStorage' in globalThis) {
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  }
});

describe('hero XP curve & level calculation', () => {
  it('maps XP cleanly to levels 1..20 and reports accurate fractional bar progress', () => {
    expect(heroLevel(-50)).toBe(1);
    expect(heroLevel(NaN)).toBe(1);
    expect(heroLevel(0)).toBe(1);
    expect(heroLevel(HERO_LEVEL_XP[1] - 1)).toBe(1);
    expect(heroLevel(HERO_LEVEL_XP[1])).toBe(2);

    for (let lvl = 1; lvl <= HERO_MAX_LEVEL; lvl++) {
      const xp = xpForHeroLevel(lvl);
      expect(heroLevel(xp)).toBe(lvl);
      const prog = heroLevelProgress(xp);
      expect(prog.level).toBe(lvl);
      expect(prog.totalSkillPoints).toBe(lvl - 1);
      if (lvl < HERO_MAX_LEVEL) {
        expect(prog.xpIntoLevel).toBe(0);
        expect(prog.fraction).toBe(0);
      } else {
        expect(prog.nextLevelXp).toBeNull();
        expect(prog.fraction).toBe(1);
      }
    }

    const mid = heroLevelProgress(60);
    expect(mid.level).toBe(1);
    expect(mid.fraction).toBeCloseTo(60 / HERO_LEVEL_XP[1], 5);
    expect(heroLevel(999_999)).toBe(20);
  });

  it('computes run XP consistently from kills, waves cleared, and victory stars', () => {
    expect(xpForRun({ won: false, enemiesKilled: 40, waveReached: 5 })).toBe(40 * 1 + 4 * 12);
    expect(xpForRun({ won: true, stars: 3, enemiesKilled: 100, wavesCleared: 10 })).toBe(
      100 * 1 + 10 * 12 + 30 + 3 * 15,
    );
  });
});

describe('hero campaign milestones, selection, skill tree & respec', () => {
  it('unlocks Bran from the start and unlocks Wren/Mira/Tobb/Sela at 2, 4, 7, 10 cleared islands', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    expect(HERO_IDS.filter((id) => isHeroUnlocked(p, id, LEVELS_2D))).toEqual(['bran']);
    expect(lastHero(p, LEVELS_2D)).toBe('bran');
    expect(selectHero(p, 'wren', LEVELS_2D)).toBeNull();

    const clearIslands = (n: number): void => {
      for (let i = 0; i < n; i++) p.clears[i] = 1;
      p.unlockedLevelIndex = Math.min(LEVELS_2D.length - 1, n);
    };

    clearIslands(2);
    expect(HERO_IDS.filter((id) => isHeroUnlocked(p, id, LEVELS_2D))).toEqual(['bran', 'wren']);
    const pWren = selectHero(p, 'wren', LEVELS_2D)!;
    expect(pWren).not.toBeNull();
    expect(lastHero(p, LEVELS_2D)).toBe('bran'); // pure: input not mutated
    expect(lastHero(pWren, LEVELS_2D)).toBe('wren');

    clearIslands(4);
    expect(HERO_IDS.filter((id) => isHeroUnlocked(p, id, LEVELS_2D))).toEqual(['bran', 'wren', 'mira']);
    clearIslands(7);
    expect(HERO_IDS.filter((id) => isHeroUnlocked(p, id, LEVELS_2D))).toEqual(['bran', 'wren', 'mira', 'tobb']);
    clearIslands(10);
    expect(HERO_IDS.filter((id) => isHeroUnlocked(p, id, LEVELS_2D))).toEqual(HERO_IDS);
  });

  it('enforces linear branch prerequisites, 2-of-3 tier-3 capstone rule, point budgets, and free respec', () => {
    let p = createDefaultProgress(LEVELS_2D.length);

    // At level 1 (0 skill points), tier 1 lacks points and tier 2 lacks prerequisites.
    expect(nodeUnlockStatus(p, 'bran', 'bran_oak_1', LEVELS_2D)).toBe('insufficientPoints');
    expect(nodeUnlockStatus(p, 'bran', 'bran_oak_2', LEVELS_2D)).toBe('lockedPrereq');
    expect(nodeUnlockStatus(p, 'wren', 'wren_bow_1', LEVELS_2D)).toBe('heroLocked');
    expect(canUnlockNode(p, 'bran', 'bran_oak_1', LEVELS_2D)).toBe(false);
    expect(applyNode(p, 'bran', 'bran_oak_1', LEVELS_2D)).toBeNull();

    // Grant Bran Level 12 (11 skill points: enough for 2 branches to Tier 3 (4 + 4 = 8) + Capstone (3) = 11).
    p = applyHeroXp(p, 'bran', xpForHeroLevel(12), LEVELS_2D).progress;
    expect(heroRoster(p, LEVELS_2D)[0].skillPointsAvailable).toBe(11);

    // Unlock branch 1 to Tier 3 (cost 1 + 1 + 2 = 4).
    for (const id of ['bran_oak_1', 'bran_oak_2', 'bran_oak_3']) {
      expect(canUnlockNode(p, 'bran', id, LEVELS_2D)).toBe(true);
      p = applyNode(p, 'bran', id, LEVELS_2D)!;
    }
    expect(nodeUnlockStatus(p, 'bran', 'bran_oak_1', LEVELS_2D)).toBe('unlocked');
    // Capstone still locked with only 1 branch at Tier 3!
    expect(nodeUnlockStatus(p, 'bran', 'bran_cap', LEVELS_2D)).toBe('lockedPrereq');

    // Unlock branch 2 to Tier 3 (cost 1 + 1 + 2 = 4 -> 3 points left).
    for (const id of ['bran_iron_1', 'bran_iron_2', 'bran_iron_3']) {
      p = applyNode(p, 'bran', id, LEVELS_2D)!;
    }
    // Now 2 branches at Tier 3 -> Capstone (cost 3) is available!
    expect(canUnlockNode(p, 'bran', 'bran_cap', LEVELS_2D)).toBe(true);
    const beforeCapHp = heroRoster(p, LEVELS_2D)[0].resolvedStats.maxHp;
    p = applyNode(p, 'bran', 'bran_cap', LEVELS_2D)!;

    const entryAfter = heroRoster(p, LEVELS_2D)[0];
    expect(entryAfter.skillPointsSpent).toBe(11);
    expect(entryAfter.skillPointsAvailable).toBe(0);
    expect(entryAfter.resolvedStats.maxHp).toBeGreaterThan(beforeCapHp);

    // Free respec refunds all 11 skill points while preserving XP and level 12.
    const respecced = respec(p, 'bran', LEVELS_2D);
    const afterRespec = heroRoster(respecced, LEVELS_2D)[0];
    expect(afterRespec.level).toBe(12);
    expect(afterRespec.unlockedSkills).toEqual([]);
    expect(afterRespec.skillPointsAvailable).toBe(11);
  });
});

describe('2D save persistence, migration & run-end XP recording', () => {
  it('migrates legacy pre-hero 2D saves and sanitizes corrupted hero data without losing XP', () => {
    const store = installMemoryStorage();
    const legacy = createDefaultProgress(3);
    legacy.clears = [1, 1, 0];
    legacy.bestStars = [3, 2, 0];
    legacy.unlockedLevelIndex = 2;
    delete legacy.heroes;
    store.set(PROGRESS_2D_KEY, JSON.stringify({ ids: ['l1c', 'i01', 'i02'], progress: legacy }));

    const loaded = loadProgress2D(LEVELS_2D.slice(0, 3));
    expect(loaded.bestStars).toEqual([3, 2, 0]);
    expect(loaded.heroes).toBeDefined();
    expect(loaded.heroes!.selectedHero).toBe('bran');
    expect(loaded.heroes!.roster.bran).toEqual({ xp: 0, skills: [] });

    // Corrupted hero save: locked selectedHero ('sela'), skipped prerequisite, overspent points.
    const corrupt = migrateHeroSave(
      {
        selectedHero: 'sela',
        roster: {
          bran: { xp: 300, skills: ['bran_oak_3'] }, // skipped tier 1 & 2 -> refunded to [], XP kept!
          wren: { xp: 150, skills: ['wren_bow_1', 'wren_vol_1'] }, // L2 = 1 pt, spent 2 -> refunded to [], XP kept!
          mira: { xp: -99, skills: 'not-an-array' },
        },
      },
      loaded,
      LEVELS_2D.slice(0, 3),
    );
    expect(corrupt.selectedHero).toBe('bran');
    expect(corrupt.roster.bran).toEqual({ xp: 300, skills: [] });
    expect(corrupt.roster.wren).toEqual({ xp: 150, skills: [] });
    expect(corrupt.roster.mira).toEqual({ xp: 0, skills: [] });

    // Reordering islands via remapProgress keeps hero XP & unlocked skills intact.
    const withSkills = applyHeroXp(loaded, 'bran', 500, LEVELS_2D.slice(0, 3)).progress;
    const withNode = applyNode(withSkills, 'bran', 'bran_oak_1', LEVELS_2D.slice(0, 3))!;
    const remapped = remapProgress(
      withNode,
      ['l1c', 'i01', 'i02'],
      [{ id: 'new-isle' }, { id: 'l1c' }, { id: 'i01' }, { id: 'i02' }],
    );
    expect(remapped.heroes?.roster.bran).toEqual({ xp: 500, skills: ['bran_oak_1'] });
  });

  it('records persistent hero XP at run end across wins, losses, and endless runs, and persists UI helpers', () => {
    installMemoryStorage();

    // 1. Loss with Bran still records Bran's earned XP without awarding island stars.
    const lossRec = recordRunResult2D(
      {
        levelId: LEVELS_2D[0].id,
        won: false,
        stars: 0,
        livesRemaining: 0,
        waveReached: 6,
        enemiesKilled: 80,
        heroId: 'bran',
      },
      LEVELS_2D,
    );
    expect(lossRec.win).toBeNull();
    expect(lossRec.hero).toBeDefined();
    expect(lossRec.hero!.xpGained).toBe(80 + 5 * 12); // 140 XP -> Level 2!
    expect(lossRec.hero!.newLevel).toBe(2);
    expect(lossRec.hero!.leveledUp).toBe(true);
    expect(lossRec.hero!.skillPointsGained).toBe(1);

    // Storage helpers unlock node, select hero (once unlocked), and respec cleanly.
    expect(unlockHeroNode2D('bran', 'bran_oak_1', LEVELS_2D)).not.toBeNull();
    expect(loadProgress2D(LEVELS_2D).heroes?.roster.bran?.skills).toEqual(['bran_oak_1']);
    respecHero2D('bran', LEVELS_2D);
    expect(loadProgress2D(LEVELS_2D).heroes?.roster.bran?.skills).toEqual([]);

    // 2. Win islands 0 & 1 -> Wren unlocks and can be selected in storage.
    recordRunResult2D(
      { levelId: LEVELS_2D[0].id, won: true, stars: 3, livesRemaining: 20, waveReached: 10, enemiesKilled: 120, heroId: 'bran' },
      LEVELS_2D,
    );
    recordRunResult2D(
      { levelId: LEVELS_2D[1].id, won: true, stars: 3, livesRemaining: 20, waveReached: 12, enemiesKilled: 150, heroId: 'bran' },
      LEVELS_2D,
    );
    expect(selectHero2D('wren', LEVELS_2D)).not.toBeNull();
    expect(lastHero(loadProgress2D(LEVELS_2D), LEVELS_2D)).toBe('wren');

    // 3. Endless run records hero XP alongside endless wave record.
    const p = loadProgress2D(LEVELS_2D);
    const endlessRes = applyRunResult2D(
      p,
      {
        levelId: LEVELS_2D[0].id,
        won: false,
        stars: 0,
        livesRemaining: 0,
        waveReached: LEVELS_2D[0].waves.length + 3,
        runConfig: { endless: true, challenges: [], daily: null },
        heroId: 'wren',
        heroXpEarned: 310,
      },
      LEVELS_2D,
    );
    expect(endlessRes.endless?.reachedEndless).toBe(true);
    expect(endlessRes.hero?.heroId).toBe('wren');
    expect(endlessRes.hero?.newXp).toBe(310);
    saveProgress2D(p, LEVELS_2D);

    // URL query resolver supports default lastHero, ?hero=<id>, ?hero=none, ?herolevel=10, and ?herolevel=20.
    const saved = loadProgress2D(LEVELS_2D);
    expect(resolveHeroForRun(saved, null, null, LEVELS_2D)?.heroId).toBe('wren');
    expect(resolveHeroForRun(saved, 'none', null, LEVELS_2D)).toBeNull();
    const forced10 = resolveHeroForRun(saved, 'mira', '10', LEVELS_2D)!;
    expect(forced10.heroId).toBe('mira');
    expect(forced10.level).toBe(10);
    expect(forced10.skills).toEqual(defaultSkillsForLevel('mira', 10));
    expect(forced10.skills.length).toBeGreaterThan(0);
    const forced20 = resolveHeroForRun(saved, 'sela', '20', LEVELS_2D)!;
    expect(forced20.heroId).toBe('sela');
    expect(forced20.level).toBe(20);
    expect([...forced20.skills].sort()).toEqual([...defaultLevel20Skills('sela')].sort());
  });
});
