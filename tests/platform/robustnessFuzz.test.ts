import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { ObjectPool } from '../../src/core/pool.ts';
import { SeededRng } from '../../src/core/rng.ts';
import type { HeroId, ProgressData } from '../../src/core/types.ts';
import { computeMeteorDamage } from '../../src/data/abilities.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { CHALLENGE_IDS, challengeModifiers, runModifiersFor } from '../../src/data/challenges.ts';
import { combineRunModifiers } from '../../src/data/runModifiers.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import {
  applyDailyWin,
  createDailyRecord,
  dailyChallengeFor,
  liveStreak,
  normalizeDailyRecord,
  utcDayNumber,
} from '../../src/data/daily.ts';
import {
  isHeroUnlocked,
  countHeroSkillPointsSpent,
  defaultLevel20Skills,
  HERO_IDS,
  heroLevelFromXp,
  heroSkillPointsForLevel,
  xpForHeroLevel,
} from '../../src/render2d/heroes2d.ts';
import { LEVEL_L1C, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { buyRank, maxedWorkshopRanks, WORKSHOP_UPGRADES, workshopModifiers } from '../../src/data/workshop.ts';
import { starWallet } from '../../src/game/progression.ts';
import { DoubleTapDetector, VelocityTracker } from '../../src/platform/gestures.ts';
import { updatePlacementPreviewFromNdc } from '../../src/platform/sessionBridge.ts';
import {
  decodeSaveCode,
  describeMergeGain,
  encodeSaveCode,
  mergeProgress,
} from '../../src/platform/saveCode.ts';
import {
  createDefaultProgress,
  hasAnyProgress,
  loadSettings,
  migrateProgress,
} from '../../src/platform/storage.ts';
import {
  applyRunResult2D,
  decodeSaveCode2D,
  encodeSaveCode2D,
  exportSaveCode2D,
  importSaveCode2D,
  islandStates,
  loadProgress2D,
  PROGRESS_2D_IMPORT_BACKUP_KEY,
  PROGRESS_2D_KEY,
  PROGRESS_2D_RESET_BACKUP_KEY,
  recordDailyWin2D,
  recordWin2D,
  remapProgress,
  resetProgress2D,
  saveProgress2D,
} from '../../src/render2d/ui/progress2d.ts';
import { resolveQueryRun2D } from '../../src/render2d/ui/modes2d.ts';
import { worldToGridCoord } from '../../src/sim/grid.ts';
import { buildEndlessWaveDef, computeEarlyCallBonus } from '../../src/sim/waveSystem.ts';
import { SimWorld } from '../../src/sim/world.ts';

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

function assertValidProgressInvariants(p: ProgressData, levelCount: number): void {
  expect(Number.isInteger(p.version)).toBe(true);
  expect(Number.isInteger(p.unlockedLevelIndex)).toBe(true);
  expect(p.unlockedLevelIndex).toBeGreaterThanOrEqual(0);
  if (levelCount > 0) {
    expect(p.unlockedLevelIndex).toBeLessThan(levelCount);
  } else {
    expect(p.unlockedLevelIndex).toBe(0);
  }

  expect(p.bestStars).toHaveLength(levelCount);
  expect(p.bestEndlessWaves).toHaveLength(levelCount);
  expect(p.bestLives).toHaveLength(levelCount);
  expect(p.clears).toHaveLength(levelCount);
  expect(p.challengeClears).toHaveLength(levelCount);

  for (let i = 0; i < levelCount; i++) {
    expect(Number.isInteger(p.bestStars[i])).toBe(true);
    expect(p.bestStars[i]).toBeGreaterThanOrEqual(0);
    expect(p.bestStars[i]).toBeLessThanOrEqual(3);
    expect(Number.isInteger(p.bestEndlessWaves[i]) && p.bestEndlessWaves[i] >= 0).toBe(true);
    expect(Number.isInteger(p.bestLives[i]) && p.bestLives[i] >= 0).toBe(true);
    expect(Number.isInteger(p.clears[i]) && p.clears[i] >= 0).toBe(true);
    if (p.bestStars[i] > 0) expect(p.clears[i]).toBeGreaterThanOrEqual(1);
    const seen = new Set(p.challengeClears[i]);
    expect(seen.size).toBe(p.challengeClears[i].length);
  }

  expect(starWallet(p).available).toBeGreaterThanOrEqual(0);
  expect(Number.isInteger(p.daily.lastDay) && p.daily.lastDay >= -1).toBe(true);
  expect(Number.isInteger(p.daily.streak) && p.daily.streak >= 0).toBe(true);
  expect(Number.isInteger(p.daily.bestStreak) && p.daily.bestStreak >= p.daily.streak).toBe(true);
  expect(Number.isInteger(p.daily.total) && p.daily.total >= 0).toBe(true);

  if (p.heroes !== undefined) {
    expect(HERO_IDS).toContain(p.heroes.selectedHero);
    for (const id of HERO_IDS) {
      const entry = p.heroes.roster[id];
      expect(entry).toBeDefined();
      expect(Number.isInteger(entry!.xp) && entry!.xp >= 0).toBe(true);
      const budget = heroSkillPointsForLevel(heroLevelFromXp(entry!.xp));
      expect(countHeroSkillPointsSpent(id, entry!.skills)).toBeLessThanOrEqual(budget);
    }
  }
}

function randInt(rng: SeededRng, maxExclusive: number): number {
  return maxExclusive <= 1 ? 0 : rng.int(0, maxExclusive - 1);
}

function randomFuzzyValue(rng: SeededRng, depth = 0): unknown {
  const pick = randInt(rng, depth > 1 ? 8 : 11);
  switch (pick) {
    case 0:
      return null;
    case 1:
      return undefined;
    case 2:
      return rng.chance(0.5);
    case 3:
      return randInt(rng, 50) - 10;
    case 4:
      return [NaN, Infinity, -Infinity, -0, 1e308, 3.7][randInt(rng, 6)];
    case 5:
      return ['', 'l1c', 'bowless', 'bran', 'sela', 'junk_id', 'x'.repeat(80)][randInt(rng, 7)];
    case 6:
      return CHALLENGE_IDS[randInt(rng, CHALLENGE_IDS.length)];
    case 7:
      return HERO_IDS[randInt(rng, HERO_IDS.length)];
    case 8:
      return Array.from({ length: randInt(rng, 8) }, () => randomFuzzyValue(rng, depth + 1));
    default: {
      const o: Record<string, unknown> = {};
      const keys = ['a', 'xp', 'skills', 'treasury', 'bastion', 'lastDay', 'streak', 'total'];
      const n = randInt(rng, 5);
      for (let i = 0; i < n; i++) {
        o[keys[randInt(rng, keys.length)]] = randomFuzzyValue(rng, depth + 1);
      }
      return o;
    }
  }
}

function buildFuzzedRawSave(rng: SeededRng): unknown {
  const roll = randInt(rng, 10);
  if (roll === 0) return randomFuzzyValue(rng); // completely arbitrary primitive / array / null

  const raw: Record<string, unknown> = {};
  if (rng.chance(0.7)) raw.version = [undefined, 0, 1, 2, 99, '2', NaN][randInt(rng, 7)];
  if (rng.chance(0.85)) {
    raw.unlockedLevelIndex = [0, 3, 8, 16, -5, 999, NaN, Infinity, '4'][randInt(rng, 9)];
  }
  if (rng.chance(0.85)) {
    raw.bestStars = Array.from({ length: randInt(rng, 22) }, () =>
      rng.chance(0.75) ? randInt(rng, 6) - 1 : randomFuzzyValue(rng, 2),
    );
  }
  if (rng.chance(0.7)) {
    raw.bestEndlessWaves = Array.from({ length: randInt(rng, 22) }, () =>
      rng.chance(0.7) ? randInt(rng, 60) - 5 : randomFuzzyValue(rng, 2),
    );
  }
  if (rng.chance(0.7)) {
    raw.bestLives = Array.from({ length: randInt(rng, 22) }, () =>
      rng.chance(0.7) ? randInt(rng, 30) - 5 : randomFuzzyValue(rng, 2),
    );
  }
  if (rng.chance(0.7)) {
    raw.clears = Array.from({ length: randInt(rng, 22) }, () =>
      rng.chance(0.7) ? randInt(rng, 10) - 2 : randomFuzzyValue(rng, 2),
    );
  }
  if (rng.chance(0.7)) {
    if (rng.chance(0.2)) {
      raw.workshop = randomFuzzyValue(rng, 2);
    } else {
      const w: Record<string, unknown> = {};
      for (const upg of WORKSHOP_UPGRADES) {
        if (rng.chance(0.5)) w[upg.id] = rng.chance(0.8) ? randInt(rng, 5) - 1 : NaN;
      }
      w.unknownUpgrade = 99;
      raw.workshop = w;
    }
  }
  if (rng.chance(0.7)) {
    raw.challengeClears = Array.from({ length: randInt(rng, 20) }, () =>
      rng.chance(0.2)
        ? 'bad'
        : Array.from({ length: randInt(rng, 5) }, () =>
            rng.chance(0.6)
              ? CHALLENGE_IDS[randInt(rng, CHALLENGE_IDS.length)]
              : randomFuzzyValue(rng, 2),
          ),
    );
  }
  if (rng.chance(0.7)) {
    raw.daily = rng.chance(0.2)
      ? randomFuzzyValue(rng, 2)
      : {
          lastDay: [randInt(rng, 25000) - 5, NaN, Infinity][randInt(rng, 3)],
          streak: randInt(rng, 15) - 3,
          bestStreak: randInt(rng, 20) - 3,
          total: randInt(rng, 40) - 5,
        };
  }
  if (rng.chance(0.6)) {
    if (rng.chance(0.2)) {
      raw.heroes = randomFuzzyValue(rng, 2);
    } else {
      const roster: Record<string, unknown> = {};
      for (const id of HERO_IDS) {
        if (rng.chance(0.75)) {
          const allNodes = defaultLevel20Skills(id);
          const take = randInt(rng, allNodes.length + 1);
          const skills = rng.chance(0.75)
            ? allNodes.slice(0, take)
            : ['bad_node', allNodes[allNodes.length - 1], 42];
          roster[id] = {
            xp: rng.chance(0.8) ? randInt(rng, 20000) - 500 : NaN,
            skills,
          };
        }
      }
      raw.heroes = {
        selectedHero: rng.chance(0.75) ? HERO_IDS[randInt(rng, HERO_IDS.length)] : 'unknown_hero',
        roster,
      };
    }
  }
  return raw;
}

describe('save/progress migrations, 2D wrapper edge cases & 500-case seeded fuzzing', () => {
  it('survives 500 seeded fuzzed v1/v2/2D/corrupted payloads with strict schema invariants and idempotence', () => {
    const rng = new SeededRng(0x5eed_cafe);
    const levelCounts = [0, 1, 9, 13, 16, 17, 24];

    for (let i = 0; i < 500; i++) {
      const n = levelCounts[randInt(rng, levelCounts.length)];
      const raw = buildFuzzedRawSave(rng);
      const migrated = migrateProgress(raw, n);
      assertValidProgressInvariants(migrated, n);

      // Finite stored unlock indices are 1-step idempotent; corrupted non-finite unlock indices
      // intentionally clamp to 0 without walking on pass 1 (progressMigration.test.ts) and stabilize on pass 2.
      const second = migrateProgress(JSON.parse(JSON.stringify(migrated)), n);
      assertValidProgressInvariants(second, n);
      const rawObj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
      if (rawObj && typeof rawObj.unlockedLevelIndex === 'number' && Number.isFinite(rawObj.unlockedLevelIndex)) {
        expect(second).toEqual(migrated);
      }
      const third = migrateProgress(JSON.parse(JSON.stringify(second)), n);
      expect(third).toEqual(second);

      // 2D remapProgress must also satisfy all invariants across arbitrary oldIds permutations.
      const sliceLen = Math.min(LEVELS_2D.length, Math.max(0, n));
      const levelsSlice = LEVELS_2D.slice(0, sliceLen);
      const oldIds =
        i % 5 === 0
          ? []
          : i % 5 === 1
            ? ['l1c', 'l1c', 'vanished-isle', 'i02']
            : levelsSlice
                .map((l) => l.id)
                .reverse()
                .slice(0, randInt(rng, sliceLen + 1));
      const remapped = remapProgress(raw, oldIds, levelsSlice);
      assertValidProgressInvariants(remapped, sliceLen);
      expect(remapped.heroes).toBeDefined();
    }
  });

  it('preserves 2D hero XP, skill trees, and selectedHero across save codes and mergeProgress', () => {
    const a = createDefaultProgress(17);
    a.unlockedLevelIndex = 5;
    a.bestStars.splice(0, 5, 3, 3, 2, 2, 1);
    a.clears.splice(0, 5, 2, 1, 1, 1, 1);
    a.heroes = {
      selectedHero: 'wren',
      roster: {
        bran: { xp: xpForHeroLevel(6), skills: ['bran_oak_1', 'bran_oak_2'] },
        wren: { xp: xpForHeroLevel(10), skills: ['wren_bow_1', 'wren_bow_2', 'wren_bow_3'] },
        mira: { xp: 0, skills: [] },
        tobb: { xp: 0, skills: [] },
        sela: { xp: 0, skills: [] },
      },
    };
    expect(hasAnyProgress(createDefaultProgress(17))).toBe(false);
    const heroOnly = createDefaultProgress(17);
    heroOnly.heroes = {
      selectedHero: 'bran',
      roster: { bran: { xp: 250, skills: ['bran_oak_1'] } },
    };
    expect(hasAnyProgress(heroOnly)).toBe(true);

    const code = encodeSaveCode(a);
    const decoded = decodeSaveCode(code, 17);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.progress).toEqual(a);

    // Merge with a second device that levelled Bran further and unlocked Vanguard branch.
    const b = createDefaultProgress(17);
    b.unlockedLevelIndex = 3;
    b.bestStars.splice(0, 3, 3, 2, 2);
    b.clears.splice(0, 3, 1, 1, 1);
    b.heroes = {
      selectedHero: 'bran',
      roster: {
        bran: { xp: xpForHeroLevel(12), skills: ['bran_van_1', 'bran_van_2'] },
        wren: { xp: xpForHeroLevel(4), skills: ['wren_bow_1'] },
        mira: { xp: 400, skills: [] },
        tobb: { xp: 0, skills: [] },
        sela: { xp: 0, skills: [] },
      },
    };

    const merged = mergeProgress(a, b, 17);
    assertValidProgressInvariants(merged, 17);
    expect(merged.heroes!.selectedHero).toBe('wren');
    expect(merged.heroes!.roster.bran!.xp).toBe(xpForHeroLevel(12));
    expect(merged.heroes!.roster.bran!.skills).toEqual([
      'bran_oak_1',
      'bran_van_1',
      'bran_oak_2',
      'bran_van_2',
    ]);
    expect(merged.heroes!.roster.wren!.xp).toBe(xpForHeroLevel(10));
    expect(merged.heroes!.roster.mira!.xp).toBe(400);
    expect(describeMergeGain(a, merged)).toContain('hero XP');
    expect(mergeProgress(merged, merged, 17)).toEqual(merged);
  });

  it('fuzzes 150 save-code encode/decode/merge pairs for monotonicity and idempotence', () => {
    const rng = new SeededRng(0x9988_7766);
    const N = 17;
    for (let i = 0; i < 150; i++) {
      const a = migrateProgress(buildFuzzedRawSave(rng), N);
      const b = migrateProgress(buildFuzzedRawSave(rng), N);
      const codeA = encodeSaveCode(a);
      const decA = decodeSaveCode(codeA, N);
      expect(decA.ok).toBe(true);
      if (!decA.ok) continue;

      const m = mergeProgress(decA.progress, b, N);
      assertValidProgressInvariants(m, N);
      for (let k = 0; k < N; k++) {
        expect(m.bestStars[k]).toBeGreaterThanOrEqual(Math.max(a.bestStars[k], b.bestStars[k]));
        expect(m.bestEndlessWaves[k]).toBeGreaterThanOrEqual(
          Math.max(a.bestEndlessWaves[k], b.bestEndlessWaves[k]),
        );
      }
      expect(mergeProgress(b, decA.progress, N)).toEqual(m);
      expect(mergeProgress(m, m, N)).toEqual(m);
    }
  });

  it('handles empty ids wrapper, duplicate ids, non-object JSON, NaN settings volume, and zero-level lists', () => {
    const store = installMemoryStorage();
    // Wrapper with empty `ids: []` must fall back to positional mapping instead of wiping stars!
    store.set(
      PROGRESS_2D_KEY,
      JSON.stringify({
        ids: [],
        progress: { unlockedLevelIndex: 2, bestStars: [3, 2, 0], clears: [1, 1, 0] },
      }),
    );
    const loadedEmptyIds = loadProgress2D(LEVELS_2D.slice(0, 3));
    expect(loadedEmptyIds.bestStars).toEqual([3, 2, 0]);
    expect(loadedEmptyIds.unlockedLevelIndex).toBe(2);

    // Duplicate IDs in `oldIds` merge by taking max per field and unioning badges.
    const dupRemap = remapProgress(
      {
        unlockedLevelIndex: 2,
        bestStars: [1, 3, 2],
        bestLives: [10, 19, 15],
        clears: [1, 2, 1],
        challengeClears: [['bowless'], ['glassSanctuary'], []],
      },
      ['l1c', 'l1c', 'i01'],
      LEVELS_2D.slice(0, 2),
    );
    expect(dupRemap.bestStars).toEqual([3, 2]);
    expect(dupRemap.bestLives).toEqual([19, 15]);
    expect(dupRemap.challengeClears[0]).toEqual(['bowless', 'glassSanctuary']);

    // Primitive / array JSON stored under PROGRESS_2D_KEY falls back cleanly.
    for (const raw of ['42', '"hello"', '[1,2,3]', 'null']) {
      store.set(PROGRESS_2D_KEY, raw);
      const fresh = loadProgress2D(LEVELS_2D.slice(0, 3));
      assertValidProgressInvariants(fresh, 3);
    }

    // Empty level list returns [] islandStates without negative index issues.
    expect(islandStates(createDefaultProgress(0), [])).toEqual([]);

    // Settings NaN masterVolume falls back to default finite volume.
    store.set('skyhold_isles_settings_v1', '{"masterVolume":null,"v":3}');
    expect(Number.isFinite(loadSettings().masterVolume)).toBe(true);
  });
});

describe('Daily Squall, Endless escalations, and Silent Skies + Hero interactions', () => {
  it('guards non-finite and duplicate inputs in Daily Squall selection and streak accounting', () => {
    expect(utcDayNumber(NaN)).toBe(0);
    expect(utcDayNumber(Infinity)).toBe(0);
    expect(dailyChallengeFor(NaN, [0, 1])).toBeNull();
    expect(dailyChallengeFor(Infinity, [0, 1])).toBeNull();
    expect(dailyChallengeFor(20500, [-3, NaN, Infinity])).toBeNull();

    // Duplicate and negative indices are deduplicated/ignored deterministically.
    const dedup = dailyChallengeFor(20500, [-1, 2, 2, NaN, 2]);
    expect(dedup).not.toBeNull();
    expect(dedup!.levelIndex).toBe(2);

    const rec = createDailyRecord();
    expect(applyDailyWin(rec, NaN, 100)).toEqual({ counted: false, streak: 0 });
    expect(applyDailyWin(rec, 100, NaN)).toEqual({ counted: false, streak: 0 });
    expect(rec.lastDay).toBe(-1);

    // Fractional day numbers floor cleanly and chain streaks properly.
    expect(applyDailyWin(rec, 100.9, 100.9)).toEqual({ counted: true, streak: 1 });
    expect(applyDailyWin(rec, 101.4, 101.8)).toEqual({ counted: true, streak: 2 });
    expect(liveStreak(rec, NaN)).toBe(0);
    expect(normalizeDailyRecord(rec, NaN).lastDay).toBe(101);
  });

  it('caps extreme endless wave skips and wave defs without Infinity HP or pool overflow', () => {
    installMemoryStorage();
    const world = new SimWorld(LEVEL_L1C, new EventBus(), { heroId: 'bran', heroLevel: 20 });
    expect(world.enterEndlessMode()).toBe(false); // cannot enter before winning
    world.debugForceWin();
    expect(world.enterEndlessMode()).toBe(true);
    expect(world.enterEndlessMode()).toBe(false); // idempotent: already endless

    // NaN wave skip clamps safely to wave 1 instead of setting currentWaveIndex = NaN.
    expect(world.debugSkipToWave(NaN)).toBe(true);
    expect(Number.isFinite(world.waveSystem.currentWaveIndex)).toBe(true);

    // Extreme endless wave skip (wave 5000) keeps HP scale finite and spawns finite-HP enemies.
    expect(world.debugSkipToWave(5000)).toBe(true);
    const scale = world.waveSystem.getCurrentWaveHpScale();
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBeGreaterThan(1);
    for (let i = 0; i < 60; i++) world.fixedTick(BALANCE.fixedDt);
    for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
      const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
      expect(Number.isFinite(e.hp) && e.hp > 0).toBe(true);
      expect(Number.isFinite(e.maxHp) && e.maxHp > 0).toBe(true);
    }

    // High-offset endless wave definitions cap boss counts so pool weight stays bounded.
    const def500 = buildEndlessWaveDef(500, LEVEL_L1C);
    expect(Number.isFinite(def500.clearBonus)).toBe(true);
    const bossGrp = def500.groups.find((g) => g.enemyType === 'boss');
    expect(bossGrp ? bossGrp.count : 0).toBeLessThanOrEqual(12);

    // NaN stars/lives in 2D outcome recorders never write NaN into progress arrays.
    recordWin2D('l1c', NaN as unknown as 1, NaN, LEVELS_2D.slice(0, 2));
    const p = loadProgress2D(LEVELS_2D.slice(0, 2));
    expect(p.bestStars[0]).toBe(1);
    expect(p.bestLives[0]).toBe(0);
    applyRunResult2D(
      p,
      { levelId: 'i01', won: true, stars: NaN, livesRemaining: NaN, waveReached: 12 },
      LEVELS_2D.slice(0, 2),
    );
    expect(p.bestStars[1]).toBe(1);
    expect(p.bestLives[1]).toBe(0);
  });

  it('Silent Skies disables global Meteor & Overcharge while keeping hero active skills and passives usable', () => {
    const mods = runModifiersFor(workshopModifiers(maxedWorkshopRanks()), ['silentSkies']);
    expect(mods.abilitiesDisabled).toBe(true);

    for (const heroId of HERO_IDS as readonly HeroId[]) {
      const world = new SimWorld(LEVEL_L1C, new EventBus(), mods, {
        heroId,
        heroLevel: 20,
        heroSkills: defaultLevel20Skills(heroId),
      });
      world.gold = 5000;
      const plots = world.grid.plots!;
      let nearestPlot = 0;
      let bestPlotSq = Infinity;
      for (let p = 0; p < plots.length; p++) {
        const dSq = (plots[p].x - world.hero!.x) ** 2 + (plots[p].z - world.hero!.z) ** 2;
        if (dSq < bestPlotSq) {
          bestPlotSq = dSq;
          nearestPlot = p;
        }
      }
      const archer = world.placeTowerOnPlot(nearestPlot, 'archer')!;
      world.commandHeroMove(archer.x, archer.z);
      for (let i = 0; i < 60 * 10 && world.hero!.state === 'moving'; i++) {
        world.fixedTick(BALANCE.fixedDt);
      }
      world.startNextWave();
      const foe = world.enemySystem.spawnEnemy('brute', 2, false, 0)!;
      foe.x = foe.prevX = world.hero!.x;
      foe.z = foe.prevZ = world.hero!.z;
      world.spatialHash.insert(foe.poolIndex, foe.x, foe.z);

      // Global sky abilities are disabled under Silent Skies.
      expect(world.canUseAbilities()).toBe(false);
      expect(world.getAbilityState('meteor').disabled).toBe(true);
      expect(world.getAbilityState('meteor').usable).toBe(false);
      expect(world.getAbilityState('overcharge').disabled).toBe(true);
      expect(world.getAbilityState('overcharge').usable).toBe(false);
      expect(world.castMeteor(0, 0)).toBe(false);
      expect(world.castOvercharge()).toBe(false);
      expect(world.castAbility('meteor', 0, 0)).toBe(false);
      expect(world.castAbility('overcharge')).toBe(false);

      // Hero kit skills remain separate from global sanctuary abilities and cast normally.
      const stateBefore = world.getHeroState()!;
      expect(stateBefore.skills[0].usable).toBe(true);
      expect(stateBefore.skills[1].usable).toBe(true);
      expect(world.castHeroSkill(0, foe.x, foe.z)).toBe(true);
      expect(world.castHeroSkill(1, heroId === 'tobb' ? archer.x : foe.x, heroId === 'tobb' ? archer.z : foe.z)).toBe(true);
      expect(world.getHeroState()!.skills[0].ready).toBe(false);
      expect(world.getHeroState()!.skills[1].ready).toBe(false);
    }
  });

  it('rejects non-finite coordinates on abilities, hero movement, and barracks rally without corrupting state', () => {
    const mods = challengeModifiers([]);
    const world = new SimWorld(LEVEL_L1C, new EventBus(), mods, { heroId: 'bran', heroLevel: 5 });
    world.gold = 1000;
    const barracks = world.placeTowerOnPlot(2, 'barracks')!;
    world.startNextWave();

    expect(world.castMeteor(NaN, 0)).toBe(false);
    expect(world.castMeteor(0, Infinity)).toBe(false);
    expect(world.commandHeroMove(NaN, 0)).toBe(false);
    expect(world.commandHeroMove(0, -Infinity)).toBe(false);
    expect(world.setRallyPoint(barracks.id, NaN, 0)).toBe(false);
    expect(world.setRallyPoint(barracks.id, 0, Infinity)).toBe(false);
    expect(Number.isFinite(world.hero!.x) && Number.isFinite(world.hero!.z)).toBe(true);
  });

  it('zero-alloc GroundGraph helpers match allocating helpers bit-for-bit and step 1,200 combat ticks cleanly', () => {
    const world = new SimWorld(LEVEL_L1C, new EventBus(), {
      heroId: 'tobb',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('tobb'),
    });
    const g = world.heroSystem.groundGraph;
    const outClamp = { x: 0, z: 0, roadX: 0, roadZ: 0, lane: 0, dist: 0 };
    for (const [x, z] of [
      [0, 0],
      [-7.5, 4.2],
      [9.1, -6.3],
      [NaN, 5],
    ]) {
      expect(g.clampToGroundOut(x, z, 1.2, outClamp)).toEqual(g.clampToGround(x, z, 1.2));
    }
    const outPath = [{ x: 99, z: 99 }];
    expect(g.findPathInto(-6, -2, 5, 2, 1.2, outPath)).toEqual(g.findPath(-6, -2, 5, 2, 1.2));

    world.gold = 5000;
    const mortar = world.placeTowerOnPlot(0, 'mortar')!;
    world.upgradeTower(mortar.id);
    world.upgradeTower(mortar.id);
    const cannon = world.placeTowerOnPlot(1, 'cannon')!;
    world.upgradeTower(cannon.id);
    world.upgradeTower(cannon.id);
    world.placeTowerOnPlot(2, 'barracks');
    world.startNextWave();
    world.castHeroSkill(0, cannon.x, cannon.z);

    const t0 = performance.now();
    for (let i = 0; i < 1200 && world.outcome === 'ongoing'; i++) {
      if (world.waveSystem.state === 'betweenWaves') world.startNextWave();
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(Number.isFinite(world.gold)).toBe(true);
  });

  it('preserves positional island alignment in loadProgress2D when stored ids contain corrupted slots', () => {
    const store = installMemoryStorage();
    const subset = LEVELS_2D.slice(0, 3); // ['l1c', 'i01', 'i02']
    store.set(
      PROGRESS_2D_KEY,
      JSON.stringify({
        ids: [subset[0].id, null, subset[2].id],
        progress: {
          version: 2,
          unlockedLevelIndex: 2,
          bestStars: [3, 2, 1],
          clears: [1, 1, 1],
          bestLives: [20, 15, 11],
          bestEndlessWaves: [0, 18, 14],
          challengeClears: [['bowless'], ['quietGuns'], ['thaw']],
        },
      }),
    );

    const loaded = loadProgress2D(subset);
    // Slot 0 ('l1c') keeps 3★, slot 1 ('i01' was missing/null in stored ids) stays 0★,
    // and slot 2 ('i02') keeps its own 1★ / wave 14 instead of shifting onto slot 1's 2★!
    expect(loaded.bestStars).toEqual([3, 0, 1]);
    expect(loaded.bestEndlessWaves).toEqual([0, 0, 14]);
    expect(loaded.challengeClears[2]).toEqual(['thaw']);
  });

  it('guards NaN/Infinity traps across buyRank, meteor/early-call math, combineRunModifiers, gestures, and tile grid', () => {
    expect(buyRank({}, 'treasury', NaN)).toBeNull();
    expect(buyRank({}, 'treasury', Infinity)).toBeNull();
    expect(buyRank({}, 'treasury', -5)).toBeNull();
    expect(buyRank({}, 'treasury', 1)).toEqual({ treasury: 1 });

    expect(computeMeteorDamage(NaN)).toBe(185);
    expect(computeMeteorDamage(Infinity)).toBe(185);
    expect(computeEarlyCallBonus(NaN, false)).toBe(0);
    expect(computeEarlyCallBonus(Infinity, false)).toBe(0);

    const combined = combineRunModifiers({
      startGoldBonus: NaN,
      startGoldMul: Infinity,
      maxLives: NaN,
      towerFireRateMul: { archer: NaN, cannon: 1.05 },
    });
    expect(combined.startGoldBonus).toBe(0);
    expect(combined.startGoldMul).toBe(1);
    expect(combined.maxLives).toBeNull();
    expect(combined.towerFireRateMul.archer).toBeUndefined();
    expect(combined.towerFireRateMul.cannon).toBe(1.05);

    const unmigrated = createDefaultProgress(LEVELS_2D.length);
    (unmigrated as { unlockedLevelIndex: number }).unlockedLevelIndex = Infinity;
    expect(isHeroUnlocked(unmigrated, 'sela', LEVELS_2D)).toBe(false);

    const vt = new VelocityTracker();
    vt.add(0, 0, 0);
    vt.add(NaN, 10, 50);
    vt.add(100, 0, 50);
    expect(vt.velocity().vx).toBe(2000);

    const dt = new DoubleTapDetector();
    expect(dt.register(10, 10, 100)).toBe(false);
    expect(dt.register(NaN, 10, 150)).toBe(false);
    expect(dt.register(12, 12, 200)).toBe(true);

    // 3D tile grid rejects fractional coordinates instead of truncating into Int32Array slots.
    const tileWorld = new SimWorld(LEVELS[0], new EventBus());
    tileWorld.gold = 9999;
    let grassCol = -1;
    let grassRow = -1;
    for (let r = 0; r < tileWorld.grid.rows && grassCol === -1; r++) {
      for (let c = 0; c < tileWorld.grid.cols; c++) {
        if (tileWorld.grid.canPlaceTower(c, r)) {
          grassCol = c;
          grassRow = r;
          break;
        }
      }
    }
    expect(grassCol).toBeGreaterThanOrEqual(0);
    expect(tileWorld.grid.isInside(grassCol + 0.5, grassRow)).toBe(false);
    expect(tileWorld.placeTower(grassCol + 0.5, grassRow, 'archer')).toBeNull();
    expect(tileWorld.grid.getTowerIdAt(grassCol, grassRow)).toBe(-1);
  });

  it('settles moving heroes on victory and skips spurious armorCracked on lethal slow hits', () => {
    const events = new EventBus();
    const world = new SimWorld(LEVEL_L1C, events, {
      heroId: 'wren',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('wren'),
    });
    world.gold = 5000;
    world.placeTowerOnPlot(0, 'frost');
    world.startNextWave();

    // Reject partial-NaN / ±Infinity hero skill & targetless Meteor coordinates cleanly.
    expect(world.castHeroSkill(0, Infinity, 0)).toBe(false);
    expect(world.castHeroSkill(0, 1, NaN)).toBe(false);
    expect(world.castAbility('meteor')).toBe(false);

    // Start a long hero move order and win mid-walk: hero settles to 'idle' with 0 waypoints.
    const farPt = world.groundPath.points[0];
    expect(world.commandHeroMove(farPt.x, farPt.z)).toBe(true);
    expect(world.hero!.state).toBe('moving');
    world.debugForceWin();
    expect(world.hero!.state).toBe('idle');
    expect(world.hero!.waypoints).toHaveLength(0);

    // Lethal slow hit on a low-HP Golem does not emit spurious armorCracked on its corpse.
    const crackEvents: number[] = [];
    const golemEvents = new EventBus();
    golemEvents.on('armorCracked', (ev) => crackEvents.push(ev.enemyId));
    const golemWorld = new SimWorld(LEVEL_L1C, golemEvents);
    golemWorld.gold = 2000;
    const frostTower = golemWorld.placeTowerOnPlot(0, 'frost')!;
    golemWorld.startNextWave();
    const golem = golemWorld.enemySystem.spawnEnemy('golem', 1, false, 0)!;
    golem.hp = 1;
    golem.x = frostTower.x + 1.0;
    golem.z = frostTower.z;
    golemWorld.spatialHash.clear();
    golemWorld.spatialHash.insert(golem.poolIndex, golem.x, golem.z);
    const frostBolt = golemWorld.projectileSystem.spawnProjectile(frostTower, golem, 0.75)!;
    frostBolt.progress = 1;
    golemWorld.projectileSystem.update(BALANCE.fixedDt, golemWorld.towers);
    expect(golem.hp).toBe(0);
    expect(crackEvents).toHaveLength(0);
  });

  it('backs up 2D saves on reset/import, remaps 2D save codes across island insertions, walks mergeProgress frontiers, and guards NaN geometry queries', () => {
    const store = installMemoryStorage();
    const subsetOld = LEVELS_2D.slice(1, 4); // ['i01', 'i02', 'i03']
    const subsetNew = LEVELS_2D.slice(0, 4); // ['l1c', 'i01', 'i02', 'i03'] (l1c inserted at index 0)

    const pOld = createDefaultProgress(subsetOld.length);
    pOld.unlockedLevelIndex = 2;
    pOld.bestStars = [3, 2, 0];
    pOld.clears = [1, 1, 0];
    pOld.heroes = {
      selectedHero: 'wren',
      roster: {
        bran: { xp: 150, skills: ['bran_oak_1'] },
        wren: { xp: xpForHeroLevel(5), skills: ['wren_bow_1', 'wren_bow_2'] },
      },
    };
    saveProgress2D(pOld, subsetOld);

    // 1. Export 2D save code from 3-island list, reset (creating backup), verify empty second reset preserves backup.
    const code2d = exportSaveCode2D(subsetOld);
    resetProgress2D(subsetOld);
    const savedBackup = store.get(PROGRESS_2D_RESET_BACKUP_KEY);
    expect(savedBackup).toBeTruthy();
    expect(store.get(PROGRESS_2D_KEY)).toBeUndefined();
    // Second reset on empty storage must NOT overwrite the backup!
    resetProgress2D(subsetOld);
    expect(store.get(PROGRESS_2D_RESET_BACKUP_KEY)).toBe(savedBackup);

    // 2. Import that old 3-island code onto the 4-island list (with 'l1c' inserted before 'i01'):
    //    stars & unlocks remap cleanly by island ID onto indices 1 & 2, and hero XP/skills survive!
    saveProgress2D(createDefaultProgress(subsetNew.length), subsetNew);
    const imported = importSaveCode2D(code2d, subsetNew);
    expect(imported.ok).toBe(true);
    expect(store.get(PROGRESS_2D_IMPORT_BACKUP_KEY)).toBeTruthy();
    const afterImport = loadProgress2D(subsetNew);
    expect(afterImport.bestStars).toEqual([0, 3, 2, 0]);
    expect(afterImport.unlockedLevelIndex).toBe(3);
    expect(afterImport.heroes?.selectedHero).toBe('wren');
    expect(afterImport.heroes?.roster.wren?.xp).toBe(xpForHeroLevel(5));

    const roundTrip2d = decodeSaveCode2D(encodeSaveCode2D(afterImport, subsetNew), subsetNew);
    expect(roundTrip2d.ok).toBe(true);
    if (roundTrip2d.ok) expect(roundTrip2d.progress).toEqual(afterImport);

    // 3. mergeProgress walks unlockedLevelIndex forward across merged clears & sanitizes workshop junk.
    const shortSave = createDefaultProgress(3);
    shortSave.unlockedLevelIndex = 2;
    shortSave.bestStars = [3, 3, 3];
    shortSave.clears = [1, 1, 1];
    (shortSave.workshop as Record<string, number>).bogusUpgrade = 99;
    const mergedExpanded = mergeProgress(createDefaultProgress(5), shortSave, 5);
    expect(mergedExpanded.unlockedLevelIndex).toBe(3);
    expect(mergedExpanded.workshop).toEqual({});

    // 4. resolveQueryRun2D and recordDailyWin2D handle NaN nowMs cleanly.
    const clearedProg = createDefaultProgress(LEVELS_2D.length);
    clearedProg.clears[0] = 1;
    const dailyRun = resolveQueryRun2D(new URLSearchParams('daily=1'), clearedProg, {
      nowMs: NaN,
      levels: LEVELS_2D,
    });
    expect(dailyRun.runConfig.daily).not.toBeNull();
    const todayDay = utcDayNumber(Date.now());
    expect(recordDailyWin2D(todayDay, NaN, LEVELS_2D).counted).toBe(true);

    // 5. Geometry & SpatialHashGrid guard non-finite coordinates and negative slack/radius.
    expect(worldToGridCoord(NaN, 0, 16, 10)).toBeNull();
    expect(worldToGridCoord(0, Infinity, 16, 10)).toBeNull();
    const sim = new SimWorld(LEVEL_L1C, new EventBus());
    const p0 = LEVEL_L1C.layout2d!.plots[0];
    expect(sim.grid.findPlotAt(p0.x, p0.z, -1)).toBe(-1);
    expect(sim.grid.findPlotAt(NaN, p0.z, 1)).toBe(-1);

    const sampleOut = { x: 99, y: 99, z: 99 };
    const yawNan = sim.groundPath.sample(NaN, sampleOut);
    expect(Number.isFinite(yawNan)).toBe(true);
    expect(Number.isFinite(sampleOut.x) && Number.isFinite(sampleOut.z)).toBe(true);
    expect(sim.groundPath.nearestDist(NaN, 0)).toBe(0);

    const qOut = [1, 2];
    sim.spatialHash.insert(-1, 0, 0);
    sim.spatialHash.insert(0, NaN, 0);
    sim.spatialHash.query(NaN, 0, 3, qOut);
    expect(qOut).toEqual([]);
    sim.spatialHash.query(0, 0, -5, qOut);
    expect(qOut).toEqual([]);
  });

  it('preserves cross-device selectedHero unlocks in importSaveCode2D, validates Barracks road-reach in placement previews, and guards pool/modifier/clamp bounds', () => {
    installMemoryStorage();

    // 1. Cross-device importSaveCode2D: Device B had 10 cleared islands across an older 12-island roster
    //    ('sela' unlocks at 10 islands & was selected); 4 of those old islands vanished, while Device A
    //    cleared 4 new islands (6 remapped + 4 local = 10 combined cleared islands -> 'sela' stays selected!).
    const oldLevels = [
      ...LEVELS_2D.slice(0, 6),
      ...Array.from({ length: 6 }, (_, k) => ({ ...LEVEL_L1C, id: `retired_${k}` })),
    ];
    const newLevels = LEVELS_2D.slice(0, 12);

    const deviceBSave = createDefaultProgress(oldLevels.length);
    deviceBSave.unlockedLevelIndex = 10;
    for (let i = 0; i < 10; i++) {
      deviceBSave.bestStars[i] = 3;
      deviceBSave.clears[i] = 1;
    }
    deviceBSave.heroes = {
      selectedHero: 'sela',
      roster: { sela: { xp: xpForHeroLevel(8), skills: ['sela_tide_1'] } },
    };
    const codeFromB = encodeSaveCode2D(deviceBSave, oldLevels);

    // Standalone decode onto newLevels only has 6 cleared islands (< 10), so standalone clamps to 'bran'.
    const standalone = decodeSaveCode2D(codeFromB, newLevels);
    expect(standalone.ok).toBe(true);
    if (standalone.ok) expect(standalone.progress.heroes?.selectedHero).toBe('bran');

    // Device A already cleared islands 6..9 (4 islands): 6 + 4 = 10 combined clears -> 'sela' stays selected!
    const deviceASave = createDefaultProgress(newLevels.length);
    for (let i = 6; i < 10; i++) {
      deviceASave.bestStars[i] = 2;
      deviceASave.clears[i] = 1;
    }
    saveProgress2D(deviceASave, newLevels);
    const mergedImport = importSaveCode2D(codeFromB, newLevels);
    expect(mergedImport.ok).toBe(true);
    if (mergedImport.ok) {
      expect(mergedImport.progress.heroes?.selectedHero).toBe('sela');
      expect(mergedImport.progress.heroes?.roster.sela?.xp).toBe(xpForHeroLevel(8));
    }

    // 2. SimWorld.canPlaceTowerAt + updatePlacementPreviewFromNdc reject out-of-reach Barracks & banned towers.
    const bannedArcherMods = challengeModifiers(['bowless']);
    const tileSim = new SimWorld(LEVELS[0], new EventBus(), bannedArcherMods);
    tileSim.gold = 5000;
    let farCol = -1;
    let farRow = -1;
    let nearCol = -1;
    let nearRow = -1;
    for (let r = 0; r < tileSim.grid.rows; r++) {
      for (let c = 0; c < tileSim.grid.cols; c++) {
        if (!tileSim.grid.canPlaceTower(c, r)) continue;
        if (tileSim.canPlaceTowerAt(c, r, 'barracks')) {
          if (nearCol === -1) {
            nearCol = c;
            nearRow = r;
          }
        } else if (farCol === -1) {
          farCol = c;
          farRow = r;
        }
      }
    }
    expect(nearCol).toBeGreaterThanOrEqual(0);
    expect(farCol).toBeGreaterThanOrEqual(0);
    expect(tileSim.canPlaceTowerAt(farCol, farRow, 'cannon')).toBe(true);
    expect(tileSim.canPlaceTowerAt(farCol, farRow, 'barracks')).toBe(false);
    expect(tileSim.canPlaceTowerAt(nearCol, nearRow, 'archer')).toBe(false); // banned by 'bowless'

    const previews: boolean[] = [];
    const mockRenderWorld = {
      cameraController: {
        screenNdcToPlane: () => ({
          x: tileSim.grid.gridToWorldX(farCol),
          z: tileSim.grid.gridToWorldZ(farRow),
        }),
      },
      setPlacementPreview: (_vis: boolean, _t: unknown, _x: number, _z: number, valid: boolean) => {
        previews.push(valid);
      },
    };
    updatePlacementPreviewFromNdc(true, 'cannon', 0, 0, mockRenderWorld as never, tileSim);
    updatePlacementPreviewFromNdc(true, 'barracks', 0, 0, mockRenderWorld as never, tileSim);
    updatePlacementPreviewFromNdc(true, 'archer', 0, 0, mockRenderWorld as never, tileSim);
    expect(previews).toEqual([true, false, false]);

    // 3. migrateProgress walks clears-only frontiers, combineRunModifiers drops non-positive/unknown rates & bans,
    //    GroundGraph.clampToGround guards NaN/negative maxOffRoad, and ObjectPool guards out-of-bounds release.
    const clearsOnly = migrateProgress(
      { version: 2, unlockedLevelIndex: 0, bestStars: [0, 0, 0], clears: [1, 1, 0] },
      3,
    );
    expect(clearsOnly.unlockedLevelIndex).toBe(2);

    const modClean = combineRunModifiers({
      bannedTowers: ['archer', 'notATower' as never],
      towerFireRateMul: { archer: 0, cannon: -2, frost: 1.1 },
    });
    expect(modClean.bannedTowers).toEqual(['archer']);
    expect(modClean.towerFireRateMul).toEqual({ frost: 1.1 });

    const sim2d = new SimWorld(LEVEL_L1C, new EventBus());
    const gg = sim2d.heroSystem.groundGraph;
    const cNeg = gg.clampToGround(5, 5, -10);
    expect(cNeg.x).toBeCloseTo(cNeg.roadX, 6);
    expect(cNeg.z).toBeCloseTo(cNeg.roadZ, 6);
    const cNan = gg.clampToGround(5, 5, NaN);
    expect(Number.isFinite(cNan.x) && Number.isFinite(cNan.z)).toBe(true);

    const pool = new ObjectPool(2, (id) => ({ id, active: false }));
    const a0 = pool.acquire()!;
    pool.releaseAtActivePos(-1);
    pool.releaseAtActivePos(99);
    expect(pool.getActiveCount()).toBe(1);
    expect(a0.active).toBe(true);
    pool.releaseAtActivePos(0);
    expect(pool.getActiveCount()).toBe(0);
  });

  it('re-attaches readSafeArea probe after DOM resets and deduplicates initDeviceClass media listeners', async () => {
    const { readSafeArea } = await import('../../src/platform/safeArea.ts');
    const { initDeviceClass } = await import('../../src/platform/deviceClass.ts');

    // Without DOM globals, readSafeArea safely returns zeros.
    expect(readSafeArea()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });

    // Minimal mocked document/window to verify detached-probe recovery and listener deduplication.
    let connected = false;
    let appendCount = 0;
    const mockProbe = {
      style: { cssText: '' },
      get isConnected(): boolean {
        return connected;
      },
      setAttribute: () => {},
    };
    const prevDoc = (globalThis as Record<string, unknown>).document;
    const prevWin = (globalThis as Record<string, unknown>).window;
    const prevGetCS = (globalThis as Record<string, unknown>).getComputedStyle;
    let addCalls = 0;
    let removeCalls = 0;
    try {
      (globalThis as Record<string, unknown>).document = {
        body: {
          appendChild: () => {
            connected = true;
            appendCount++;
          },
        },
        createElement: () => mockProbe,
        documentElement: { classList: { toggle: () => {} } },
      };
      (globalThis as Record<string, unknown>).getComputedStyle = () =>
        connected
          ? { paddingTop: '12px', paddingRight: '4px', paddingBottom: '20px', paddingLeft: '8px' }
          : { paddingTop: '', paddingRight: '', paddingBottom: '', paddingLeft: '' };
      (globalThis as Record<string, unknown>).window = {
        matchMedia: () => ({
          matches: true,
          addEventListener: () => void addCalls++,
          removeEventListener: () => void removeCalls++,
        }),
      };

      expect(readSafeArea()).toEqual({ top: 12, right: 4, bottom: 20, left: 8 });
      expect(appendCount).toBe(1);
      // Simulate document.body.innerHTML = '' detaching probe: next readSafeArea re-attaches it!
      connected = false;
      expect(readSafeArea()).toEqual({ top: 12, right: 4, bottom: 20, left: 8 });
      expect(appendCount).toBe(2);

      initDeviceClass();
      initDeviceClass();
      expect(addCalls).toBe(2);
      expect(removeCalls).toBe(1);
    } finally {
      if (prevDoc === undefined) delete (globalThis as Record<string, unknown>).document;
      else (globalThis as Record<string, unknown>).document = prevDoc;
      if (prevWin === undefined) delete (globalThis as Record<string, unknown>).window;
      else (globalThis as Record<string, unknown>).window = prevWin;
      if (prevGetCS === undefined) delete (globalThis as Record<string, unknown>).getComputedStyle;
      else (globalThis as Record<string, unknown>).getComputedStyle = prevGetCS;
    }
  });

  it('hardens mergeProgress NaN/workshop fallbacks, combineRunModifiers bounds, platform listener snapshots, QualityController frame guards, and v1 modes2d clears', async () => {
    const { createPlatformAdapter, sanitizeCloudSlot } = await import('../../src/platform/platform.ts');
    const { QualityController } = await import('../../src/platform/qualityController.ts');
    const { availableChallenges, canPlayEndless } = await import('../../src/render2d/ui/modes2d.ts');

    // 1. mergeProgress sanitizes NaN/out-of-range array entries, infers clears from v1 bestStars,
    //    and falls back to the affordable side's workshop when the higher-spent side is unaffordable.
    const goodLocal = createDefaultProgress(4);
    goodLocal.bestStars = [3, 0, 0, 0]; // 3 earned stars, v1-style clears = 0
    goodLocal.clears = [0, 0, 0, 0];
    goodLocal.workshop = { treasury: 1 }; // costs 1 star (affordable!)

    const corruptRemote = createDefaultProgress(4);
    corruptRemote.version = NaN;
    corruptRemote.bestStars = [NaN, 99, -4, 0]; // clamps to [0, 3, 0, 0] -> merged has 3 + 3 = 6 stars
    corruptRemote.bestEndlessWaves = [NaN, 18.9, -2, 0];
    corruptRemote.bestLives = [NaN, 20, -1, 0];
    corruptRemote.challengeClears = [['bowless', 42 as unknown as string, ''], 'bad' as unknown as string[], [], []];
    corruptRemote.workshop = { treasury: 2, bastion: 2, storm: 2 }; // costs 3 + 5 + 5 = 13 stars (> 6 earned!)

    const mergedSafe = mergeProgress(goodLocal, corruptRemote, 4);
    expect(mergedSafe.version).toBeGreaterThanOrEqual(2);
    expect(mergedSafe.bestStars).toEqual([3, 3, 0, 0]);
    expect(mergedSafe.clears).toEqual([1, 1, 0, 0]);
    expect(mergedSafe.unlockedLevelIndex).toBe(2);
    expect(mergedSafe.bestEndlessWaves).toEqual([0, 18, 0, 0]);
    expect(mergedSafe.challengeClears[0]).toEqual(['bowless']);
    // Kept goodLocal's affordable { treasury: 1 } instead of wiping workshop to {} (3 + 3 campaign + 1 badge - 1 spent = 6)!
    expect(mergedSafe.workshop).toEqual({ treasury: 1 });
    expect(starWallet(mergedSafe).available).toBe(6);

    // describeMergeGain reports 'hero skills' when XP is unchanged but new nodes are unlocked.
    const beforeSkills = createDefaultProgress(4);
    beforeSkills.heroes = { selectedHero: 'bran', roster: { bran: { xp: xpForHeroLevel(5), skills: [] } } };
    const afterSkills = createDefaultProgress(4);
    afterSkills.heroes = {
      selectedHero: 'bran',
      roster: { bran: { xp: xpForHeroLevel(5), skills: ['bran_oak_1', 'bran_oak_2'] } },
    };
    expect(describeMergeGain(beforeSkills, afterSkills)).toContain('hero skills');

    // 2. combineRunModifiers clamps/ignores zero or negative multipliers and non-positive maxLives.
    const clampedMods = combineRunModifiers({
      startGoldBonus: 9.6,
      startGoldMul: -2,
      bonusLives: 1.8,
      maxLives: 0,
      abilityCooldownMul: 0,
      killGoldMul: -0.5,
      waveBonusMul: -1,
      enemySpeedMul: -3,
      enemyHpMul: 0,
    });
    expect(clampedMods.startGoldBonus).toBe(10);
    expect(clampedMods.startGoldMul).toBe(1);
    expect(clampedMods.bonusLives).toBe(2);
    expect(clampedMods.maxLives).toBeNull();
    expect(clampedMods.abilityCooldownMul).toBe(1);
    expect(clampedMods.killGoldMul).toBe(1);
    expect(clampedMods.waveBonusMul).toBe(1);
    expect(clampedMods.enemySpeedMul).toBe(1);
    expect(clampedMods.enemyHpMul).toBe(1);

    // 3. PlatformAdapter snapshots listener sets so mid-dispatch subscriptions do not fire in-flight.
    expect(sanitizeCloudSlot(null as unknown as string)).toBeNull();
    let overlayTrigger: ((active: boolean) => void) | null = null;
    const steamAdapter = createPlatformAdapter({
      bridge: {
        isSteam: true,
        unlockAchievement: async () => true,
        cloudRead: async () => null,
        cloudWrite: async () => true,
        onOverlayChange: (cb) => {
          overlayTrigger = cb;
          return () => {};
        },
      },
      storage: null,
    });
    expect(await steamAdapter.achievements.unlock(null as unknown as string)).toBe(false);
    let lateOverlayCalls = 0;
    steamAdapter.onOverlayChange(() => {
      steamAdapter.onOverlayChange(() => void lateOverlayCalls++);
    });
    overlayTrigger!(true);
    expect(lateOverlayCalls).toBe(0);
    overlayTrigger!(false);
    expect(lateOverlayCalls).toBe(1);

    // 4. QualityController ignores NaN / Infinity frame samples without poisoning governor clock.
    const appliedTiers: string[] = [];
    const qc = new QualityController((tier) => appliedTiers.push(tier), () => false);
    qc.setSetting('invalid' as never);
    expect(qc.isAuto).toBe(true);
    qc.frame(Infinity);
    qc.frame(NaN);
    qc.frame(-16);
    for (let i = 0; i < 120; i++) qc.frame(50); // slow frames still step down cleanly after Infinity
    expect(qc.tier).not.toBe('high');

    // 5. modes2d helpers recognize v1 star-only clears (bestStars > 0 with clears = 0).
    const v1Prog = createDefaultProgress(LEVELS_2D.length);
    v1Prog.bestStars[0] = 2;
    expect(canPlayEndless(LEVELS_2D[0].id, v1Prog, LEVELS_2D)).toBe(true);
    expect(availableChallenges(LEVELS_2D[0].id, v1Prog, LEVELS_2D)).toHaveLength(2);
  });

  it('guards non-object JSON in hydrateProgressFromCloud, preserves pre-remap Workshop on 2D merges, and persists 0-XP selectedHero switches', async () => {
    const { hydrateProgressFromCloud } = await import('../../src/platform/cloudSync.ts');
    const { hydrateProgress2DFromCloud, recordRunResult2D } = await import('../../src/render2d/ui/progress2d.ts');
    const { applyHeroXp } = await import('../../src/render2d/heroes2d.ts');
    installMemoryStorage();

    // 1. hydrateProgressFromCloud rejects "null" / primitive / array JSON without overwriting cloud when local is empty.
    const cloudWrites: string[] = [];
    const emptyLocal = createDefaultProgress(LEVELS.length);
    for (const nonObjJson of ['null', '42', '"hello"', '[1,2,3]']) {
      const res = await hydrateProgressFromCloud(
        emptyLocal,
        LEVELS.length,
        {
          id: 'steam',
          isSteam: true,
          isMobile: false,
          achievements: { unlock: async () => false, isUnlocked: async () => false },
          cloudSave: {
            read: async () => nonObjJson,
            write: async (_slot, data) => {
              cloudWrites.push(data);
              return true;
            },
          },
          onOverlayChange: () => () => {},
          onPause: () => () => {},
          onResume: () => () => {},
        },
        LEVELS,
      );
      expect(res.updated).toBe(false);
    }
    expect(cloudWrites).toEqual([]);

    // 2. importSaveCode2D & hydrateProgress2DFromCloud keep pre-remap Workshop upgrades when combined stars can afford them.
    const oldLevels = [
      ...LEVELS_2D.slice(0, 2),
      { ...LEVEL_L1C, id: 'retired_isle_a' },
      { ...LEVEL_L1C, id: 'retired_isle_b' },
    ];
    const curLevels = LEVELS_2D.slice(0, 4);

    // Remote save earned 6★ (3★ on l1c + 3★ on retired_isle_a) and bought { treasury: 2, bastion: 1 } = 1+2+2 = 5★.
    // Remapped alone onto curLevels it has only 3★ (< 5★), which standalone decode refunds to {}.
    const remoteSave = createDefaultProgress(oldLevels.length);
    remoteSave.bestStars = [3, 0, 3, 0];
    remoteSave.clears = [1, 0, 1, 0];
    remoteSave.workshop = { treasury: 2, bastion: 1 };
    const code = encodeSaveCode2D(remoteSave, oldLevels);
    const standalone = decodeSaveCode2D(code, curLevels);
    expect(standalone.ok).toBe(true);
    if (standalone.ok) expect(standalone.progress.workshop).toEqual({});

    // Local save earned 3★ on curLevels[1] (with workshop = {}): combined 3★ + 3★ = 6★ >= 5★ -> Workshop preserved!
    const localSave = createDefaultProgress(curLevels.length);
    localSave.bestStars = [0, 3, 0, 0];
    localSave.clears = [0, 1, 0, 0];
    saveProgress2D(localSave, curLevels);
    const imported = importSaveCode2D(code, curLevels);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.progress.workshop).toEqual({ treasury: 2, bastion: 1 });
      expect(starWallet(imported.progress).available).toBe(1);
    }

    // Same preservation through hydrateProgress2DFromCloud:
    saveProgress2D(localSave, curLevels);
    const cloudBlob = JSON.stringify({ ids: oldLevels.map((l) => l.id), progress: remoteSave });
    const hydrated2d = await hydrateProgress2DFromCloud(
      undefined,
      curLevels,
      {
        id: 'steam',
        isSteam: true,
        isMobile: false,
        achievements: { unlock: async () => false, isUnlocked: async () => false },
        cloudSave: {
          read: async () => cloudBlob,
          write: async () => true,
        },
        onOverlayChange: () => () => {},
        onPause: () => () => {},
        onResume: () => () => {},
      },
    );
    expect(hydrated2d.merged.workshop).toEqual({ treasury: 2, bastion: 1 });

    // 3. recordRunResult2D persists selectedHero switch even when xpGained === 0, and applyHeroXp guards invalid heroId.
    const twoCleared = createDefaultProgress(curLevels.length);
    twoCleared.bestStars = [3, 3, 0, 0];
    twoCleared.clears = [1, 1, 0, 0];
    twoCleared.unlockedLevelIndex = 2; // unlocks 'wren' (2 islands cleared)
    saveProgress2D(twoCleared, curLevels);
    expect(loadProgress2D(curLevels).heroes?.selectedHero).toBe('bran');

    recordRunResult2D(
      {
        levelId: curLevels[0].id,
        won: false,
        stars: 0,
        livesRemaining: 0,
        waveReached: 1,
        heroId: 'wren',
        heroXpEarned: 0,
      },
      curLevels,
    );
    expect(loadProgress2D(curLevels).heroes?.selectedHero).toBe('wren');

    const unchanged = applyHeroXp(twoCleared, 'not_a_hero' as never, 250, curLevels);
    expect(unchanged.progress).toBe(twoCleared);
    expect(unchanged.record.xpGained).toBe(0);
  });

  it('unions affordable cross-device Workshop upgrades commutatively, folds concurrent local writes during cloud hydration, and hardens ContentStore/IAP', async () => {
    const { hydrateProgressFromCloud } = await import('../../src/platform/cloudSync.ts');
    const { saveLocalProgress } = await import('../../src/platform/storage.ts');
    const { ContentStore, inferSeenFromProgress } = await import('../../src/platform/contentStorage.ts');
    const { createIapStore, isUnlocked: isMobileLevelUnlocked } = await import('../../src/platform/iap.ts');
    const { hydrateProgress2DFromCloud } = await import('../../src/render2d/ui/progress2d.ts');
    installMemoryStorage();

    // 1. mergeProgress unions non-overlapping Workshop upgrades when combined stars can afford both,
    //    is strictly commutative across Workshop & Hero ties, and describeMergeGain reports 'workshop upgrades'.
    const devA = createDefaultProgress(6);
    devA.bestStars = [3, 3, 0, 0, 0, 0]; // 6★
    devA.clears = [1, 1, 0, 0, 0, 0];
    devA.unlockedLevelIndex = 2;
    devA.workshop = { treasury: 2, fletcher: 1 }; // 3 + 2 = 5★
    devA.heroes = { selectedHero: 'wren', roster: { wren: { xp: 300, skills: ['wren_bow_1'] } } };

    const devB = createDefaultProgress(6);
    devB.bestStars = [0, 0, 3, 3, 0, 0]; // 6★ -> combined 12★!
    devB.clears = [0, 0, 1, 1, 0, 0];
    devB.unlockedLevelIndex = 4;
    devB.workshop = { bastion: 2 }; // 5★ -> union costs 10★ <= 12★!
    devB.heroes = { selectedHero: 'mira', roster: { mira: { xp: 300, skills: ['mira_emb_1'] } } };

    const ab = mergeProgress(devA, devB, 6);
    const ba = mergeProgress(devB, devA, 6);
    expect(ab.workshop).toEqual({ treasury: 2, fletcher: 1, bastion: 2 });
    expect(ba.workshop).toEqual(ab.workshop);
    expect(ab.heroes?.selectedHero).toBe('mira');
    expect(ba.heroes?.selectedHero).toBe('mira');

    // Equal-star save gaining Workshop upgrades reports 'workshop upgrades' in describeMergeGain.
    const sameStarsBase = createDefaultProgress(4);
    sameStarsBase.bestStars = [3, 3, 0, 0];
    sameStarsBase.clears = [1, 1, 0, 0];
    const sameStarsBought = { ...sameStarsBase, workshop: { treasury: 2 } };
    expect(describeMergeGain(sameStarsBase, mergeProgress(sameStarsBase, sameStarsBought, 4))).toContain(
      'workshop upgrades',
    );

    // 2. Concurrent localStorage writes while cloudSave.read is awaiting IPC are folded in monotonically (zero data loss)!
    const initial2d = createDefaultProgress(LEVELS_2D.length);
    saveProgress2D(initial2d, LEVELS_2D);
    const remote2d = createDefaultProgress(LEVELS_2D.length);
    remote2d.bestStars[1] = 3;
    remote2d.clears[1] = 1;
    const remote2dBlob = JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: remote2d });

    const race2d = await hydrateProgress2DFromCloud(
      undefined,
      LEVELS_2D,
      {
        id: 'steam',
        isSteam: true,
        isMobile: false,
        achievements: { unlock: async () => false, isUnlocked: async () => false },
        cloudSave: {
          read: async () => {
            // Simulate player winning l1c and selecting a skill while cloudSave.read is in flight!
            const midFlight = loadProgress2D(LEVELS_2D);
            midFlight.bestStars[0] = 3;
            midFlight.clears[0] = 1;
            midFlight.workshop = { treasury: 1 };
            saveProgress2D(midFlight, LEVELS_2D);
            return remote2dBlob;
          },
          write: async () => true,
        },
        onOverlayChange: () => () => {},
        onPause: () => () => {},
        onResume: () => () => {},
      },
    );
    expect(race2d.merged.bestStars[0]).toBe(3); // mid-flight local win preserved!
    expect(race2d.merged.bestStars[1]).toBe(3); // remote cloud win merged!
    expect(race2d.merged.workshop).toEqual({ treasury: 1 });
    expect(loadProgress2D(LEVELS_2D).bestStars.slice(0, 2)).toEqual([3, 3]);

    // Same concurrent-write protection in 3D hydrateProgressFromCloud:
    const initial3d = createDefaultProgress(LEVELS.length);
    saveLocalProgress(initial3d);
    const remote3d = createDefaultProgress(LEVELS.length);
    remote3d.bestStars[1] = 2;
    remote3d.clears[1] = 1;
    const race3d = await hydrateProgressFromCloud(
      initial3d,
      LEVELS.length,
      {
        id: 'steam',
        isSteam: true,
        isMobile: false,
        achievements: { unlock: async () => false, isUnlocked: async () => false },
        cloudSave: {
          read: async () => {
            const concurrent3d = createDefaultProgress(LEVELS.length);
            concurrent3d.bestStars[0] = 3;
            concurrent3d.clears[0] = 1;
            saveLocalProgress(concurrent3d);
            return JSON.stringify(remote3d);
          },
          write: async () => true,
        },
        onOverlayChange: () => () => {},
        onPause: () => () => {},
        onResume: () => () => {},
      },
      LEVELS,
    );
    expect(race3d.merged.bestStars[0]).toBe(3);
    expect(race3d.merged.bestStars[1]).toBe(2);

    // 3. ContentStore & IAP guard non-finite unlockedLevelIndex, clears-only saves, and non-string IDs.
    const infProg = { unlockedLevelIndex: Infinity, bestStars: [0, 0] };
    expect(inferSeenFromProgress(LEVELS.slice(0, 2), infProg)).toEqual([]);
    const clearsProg = { unlockedLevelIndex: 0, bestStars: [0], clears: [1] };
    expect(inferSeenFromProgress(LEVELS.slice(0, 1), clearsProg).length).toBeGreaterThan(0);

    const cs = new ContentStore(null);
    expect(cs.markSeen('' as never)).toBe(false);
    expect(cs.markSeen(null as never)).toBe(false);
    cs.setOnboardingStatus('bogus' as never);
    expect(cs.getOnboardingStatus()).toBe('pending');
    cs.adoptProgress(LEVELS.slice(0, 1), clearsProg);
    expect(cs.getOnboardingStatus()).toBe('done');

    expect(isMobileLevelUnlocked(null as never, ['full_unlock'])).toBe(false);
    const mockIap = createIapStore({ mode: 'mock', storage: null });
    expect(mockIap.owned(null as never)).toBe(false);
    expect((await mockIap.purchase(null as never)).status).toBe('unknown_product');
  });

  it('guards WaveSystem waveCompleted/spawning re-entrancy, GroundGraph disconnected NaN paths, mid-tick transient splices, concurrent cloud updated flags, and achievement/gesture edge cases', async () => {
    installMemoryStorage();
    const { syncAchievementsFromProgress } = await import('../../src/platform/achievements.ts');
    const { hydrateProgressFromCloud } = await import('../../src/platform/cloudSync.ts');
    const { loadProgress, saveLocalProgress } = await import('../../src/platform/storage.ts');
    const { hydrateProgress2DFromCloud } = await import('../../src/render2d/ui/progress2d.ts');
    const { GroundGraph } = await import('../../src/sim/groundGraph.ts');
    const { CompiledPath } = await import('../../src/sim/path.ts');

    // 1a. WaveSystem transitions to 'betweenWaves' (with positive countdown) BEFORE emitting 'waveCompleted',
    //     so listeners calling startNextWave() or setAutoWave() inside 'waveCompleted' never get clobbered.
    const chainEvents = new EventBus();
    const chainWorld = new SimWorld(LEVEL_L1C, chainEvents);
    const observedStates: string[] = [];
    chainEvents.on('waveCompleted', (ev) => {
      observedStates.push(chainWorld.waveSystem.state);
      if (ev.waveIndex === 0) {
        expect(chainWorld.waveSystem.interWaveTimer).toBeGreaterThan(0);
        // Calling startNextWave() right inside waveCompleted must start wave 2 cleanly in 'spawning' state!
        expect(chainWorld.startNextWave()).toBe(true);
      } else if (ev.waveIndex === 1) {
        // Calling setAutoWave(true) inside waveCompleted shortens the betweenWaves countdown cleanly.
        chainWorld.setAutoWave(true);
        expect(chainWorld.waveSystem.getAutoShortenedBy()).toBeGreaterThan(0);
      }
    });
    expect(chainWorld.startNextWave()).toBe(true);
    for (let t = 0; t < 60 * 120 && chainWorld.waveSystem.currentWaveIndex < 2; t++) {
      for (let i = 0; i < chainWorld.enemyPool.getActiveCount(); i++) {
        const e = chainWorld.enemyPool.items[chainWorld.enemyPool.getActiveIndex(i)];
        chainWorld.enemySystem.applyDamage(e, 99_999, true);
      }
      chainWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(observedStates[0]).toBe('betweenWaves');
    expect(observedStates[1]).toBe('betweenWaves');
    expect(chainWorld.waveSystem.currentWaveIndex).toBe(2);
    expect(chainWorld.waveSystem.state).toBe('spawning');
    chainWorld.dispose();

    // 1b. Calling debugForceWin() inside 'enemySpawned' must NOT be clobbered back to 'allSpawned'/'clearing'.
    const spawnWinEvents = new EventBus();
    const spawnWinWorld = new SimWorld(LEVEL_L1C, spawnWinEvents);
    spawnWinEvents.on('enemySpawned', () => {
      spawnWinWorld.debugForceWin();
    });
    spawnWinWorld.startNextWave();
    spawnWinWorld.fixedTick(BALANCE.fixedDt);
    expect(spawnWinWorld.outcome).toBe('won');
    expect(spawnWinWorld.waveSystem.state).toBe('finished');
    spawnWinWorld.dispose();

    // 2. GroundGraph.findPath handles non-finite target/source coords & negative maxOffRoad across disconnected components.
    const laneA = CompiledPath.fromWorld(
      [
        { x: -10, z: -10 },
        { x: -6, z: -10 },
      ],
      0,
      false,
    );
    const laneB = CompiledPath.fromWorld(
      [
        { x: 10, z: 10 },
        { x: 14, z: 10 },
      ],
      0,
      false,
    );
    const disconnectedGraph = new GroundGraph([laneA, laneB]);
    const nanTargetPath = disconnectedGraph.findPath(12, 10, NaN, 0);
    expect(nanTargetPath.length).toBeGreaterThan(0);
    for (const wp of nanTargetPath) {
      expect(Number.isFinite(wp.x)).toBe(true);
      expect(Number.isFinite(wp.z)).toBe(true);
    }
    const negMaxOffPath = disconnectedGraph.findPath(12, 10, -8, -10, -5);
    for (const wp of negMaxOffPath) {
      expect(Number.isFinite(wp.x)).toBe(true);
      expect(Number.isFinite(wp.z)).toBe(true);
    }

    // 3. Re-entrant Meteor & Wren double-volley casts inside 'enemyHit' preserve newly queued strikes.
    const reEvents = new EventBus();
    const reWorld = new SimWorld(LEVEL_L1C, reEvents, {
      heroId: 'wren',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('wren'),
    });
    reWorld.startNextWave();
    const dummy = reWorld.enemySystem.spawnEnemy('brute', 10, false, 0)!;
    dummy.speed = 0;
    reWorld.commandHeroMove(dummy.x, dummy.z);
    for (let t = 0; t < 60 * 12 && reWorld.hero!.state === 'moving'; t++) {
      reWorld.fixedTick(BALANCE.fixedDt);
    }
    dummy.hp = dummy.maxHp;

    let recastMeteor = false;
    let recastVolley = false;
    reEvents.on('enemyHit', () => {
      if (!recastMeteor && reWorld.abilitySystem.getPendingMeteorCount() === 0) {
        recastMeteor = true;
        reWorld.abilitySystem.reset();
        expect(reWorld.castMeteor(dummy.x, dummy.z)).toBe(true);
      }
    });
    expect(reWorld.castMeteor(dummy.x, dummy.z)).toBe(true);
    for (let t = 0; t < 90 && !recastMeteor; t++) {
      reWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(recastMeteor).toBe(true);
    expect(reWorld.abilitySystem.getPendingMeteorCount()).toBe(1);

    reWorld.abilitySystem.reset();
    reEvents.clear();
    expect(reWorld.castHeroSkill(0, dummy.x, dummy.z)).toBe(true);
    expect(reWorld.heroSystem.getPendingVolleys().length).toBe(1);
    reEvents.on('enemyHit', () => {
      if (!recastVolley && reWorld.heroSystem.getPendingVolleys().length === 0) {
        recastVolley = true;
        reWorld.hero!.skillCooldowns[0] = 0;
        expect(reWorld.castHeroSkill(0, dummy.x, dummy.z)).toBe(true);
      }
    });
    for (let t = 0; t < 40 && !recastVolley; t++) {
      reWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(recastVolley).toBe(true);
    expect(reWorld.heroSystem.getPendingVolleys().length).toBe(1);
    reWorld.dispose();

    // 4. Async cloud hydration reports updated=true and writes the full union to disk even when cloud is null/offline!
    const caller2d = createDefaultProgress(LEVELS_2D.length);
    caller2d.bestStars[2] = 2; // in-memory caller progress on i02
    caller2d.clears[2] = 1;
    saveProgress2D(createDefaultProgress(LEVELS_2D.length), LEVELS_2D);

    const offlineRace2d = await hydrateProgress2DFromCloud(caller2d, LEVELS_2D, {
      id: 'steam',
      isSteam: true,
      isMobile: false,
      achievements: { unlock: async () => false, isUnlocked: async () => false },
      cloudSave: {
        read: async () => {
          const diskWin = loadProgress2D(LEVELS_2D);
          diskWin.bestStars[0] = 3;
          diskWin.clears[0] = 1;
          saveProgress2D(diskWin, LEVELS_2D);
          return null; // cloud empty / offline!
        },
        write: async () => true,
      },
      onOverlayChange: () => () => {},
      onPause: () => () => {},
      onResume: () => () => {},
    });
    expect(offlineRace2d.updated).toBe(true);
    expect(offlineRace2d.merged.bestStars[0]).toBe(3);
    expect(offlineRace2d.merged.bestStars[2]).toBe(2);
    expect(loadProgress2D(LEVELS_2D).bestStars[2]).toBe(2); // caller's in-memory progress persisted to disk union!

    const caller3d = createDefaultProgress(LEVELS.length);
    caller3d.bestStars[2] = 2;
    caller3d.clears[2] = 1;
    saveLocalProgress(createDefaultProgress(LEVELS.length));
    const offlineRace3d = await hydrateProgressFromCloud(
      caller3d,
      LEVELS.length,
      {
        id: 'steam',
        isSteam: true,
        isMobile: false,
        achievements: { unlock: async () => false, isUnlocked: async () => false },
        cloudSave: {
          read: async () => {
            const diskWin3d = createDefaultProgress(LEVELS.length);
            diskWin3d.bestStars[0] = 3;
            diskWin3d.clears[0] = 1;
            saveLocalProgress(diskWin3d);
            return null;
          },
          write: async () => true,
        },
        onOverlayChange: () => () => {},
        onPause: () => () => {},
        onResume: () => () => {},
      },
      LEVELS,
    );
    expect(offlineRace3d.updated).toBe(true);
    expect(offlineRace3d.merged.bestStars[0]).toBe(3);
    expect(offlineRace3d.merged.bestStars[2]).toBe(2);
    expect(loadProgress(LEVELS.length).bestStars[2]).toBe(2);

    // 5. syncAchievementsFromProgress isolates per-achievement IPC rejections, and DoubleTapDetector ignores rolled-back timestamps.
    const achProg = createDefaultProgress(LEVELS.length);
    achProg.bestStars[0] = 3;
    achProg.clears[0] = 1;
    let achAttempt = 0;
    const unlockedAfterFault = await syncAchievementsFromProgress(
      achProg,
      {
        id: 'steam',
        isSteam: true,
        isMobile: false,
        achievements: {
          unlock: async () => {
            achAttempt++;
            if (achAttempt === 1) throw new Error('transient IPC error');
            return true;
          },
          isUnlocked: async () => false,
        },
        cloudSave: { read: async () => null, write: async () => true },
        onOverlayChange: () => () => {},
        onPause: () => () => {},
        onResume: () => () => {},
      },
      LEVELS,
    );
    expect(achAttempt).toBeGreaterThanOrEqual(2);
    expect(unlockedAfterFault.length).toBeGreaterThanOrEqual(1);

    const dtd = new DoubleTapDetector();
    expect(dtd.register(100, 100, 5000)).toBe(false);
    expect(dtd.register(102, 102, 4800)).toBe(false); // rolled-back timestamp must NOT trigger double-tap!
    expect(dtd.register(103, 103, 4950)).toBe(true); // valid follow-up within 300ms of 4800ms succeeds!
  });

  it('wires mobile onResume in GameSession, hardens stepPendingSpawns & introOnScreen clock rollback, resets key-pan on InputManager.dispose, and guards Workshop/Challenges/xpForRun edge inputs', async () => {
    installMemoryStorage();
    const { setPlatformAdapter } = await import('../../src/platform/platform.ts');
    const { GameSession } = await import('../../src/platform/gameSession.ts');
    const { bindSimEventBridge, stepPendingSpawns } = await import('../../src/platform/sessionBridge.ts');
    const { InputManager } = await import('../../src/platform/input.ts');
    const { rankOf, workshopModifiers, workshopStarsSpent } = await import('../../src/data/workshop.ts');
    const { challengeModifiers, runModifiersFor, sanitizeChallengeSelection } = await import(
      '../../src/data/challenges.ts'
    );
    const { NEUTRAL_RUN_MODIFIERS } = await import('../../src/data/runModifiers.ts');
    const { MAX_HERO_XP, xpForRun } = await import('../../src/render2d/heroes2d.ts');

    // 1. GameSession wires platform.onPause -> suspendForBackground AND platform.onResume -> resumeFromBackground,
    //    and unbinds both on dispose().
    let triggerPause: (() => void) | null = null;
    let triggerResume: (() => void) | null = null;
    let pauseUnbound = false;
    let resumeUnbound = false;
    setPlatformAdapter({
      isSteam: false,
      isMobile: true,
      mobilePlatform: 'ios',
      overlayActive: false,
      achievements: { unlock: async () => false },
      cloudSave: { read: async () => null, write: async () => false },
      triggerHaptic: async () => false,
      onOverlayChange: () => () => {},
      onPause: (cb) => {
        triggerPause = cb;
        return () => {
          pauseUnbound = true;
          triggerPause = null;
        };
      },
      onResume: (cb) => {
        triggerResume = cb;
        return () => {
          resumeUnbound = true;
          triggerResume = null;
        };
      },
    });
    let suspended = 0;
    let resumed = 0;
    const mockRenderWorld = {
      setQuality: () => {},
      overlayIndicators: { setSelectedTowerRing: () => {} },
      setFlightPathHighlight: () => {},
      setRoutesPinned: () => {},
      setPlacementGridActive: () => {},
      setPlacementPreview: () => {},
      setMeteorTargetPreview: () => {},
      setHoveredTowerId: () => {},
      setCanvasCursor: () => {},
      loadLevel: () => {},
      cameraController: { setShowcaseMode: () => {}, setHudRects: () => {}, getViewVersion: () => 0 },
    } as never;
    const mockSound = {
      suspendForBackground: () => void suspended++,
      resumeFromBackground: () => void resumed++,
      setMusicDucked: () => {},
      setMusicContext: () => {},
      unlock: () => {},
      bindEvents: () => () => {},
    } as never;
    const session = new GameSession(mockRenderWorld, mockSound);
    try {
      expect(triggerPause).not.toBeNull();
      expect(triggerResume).not.toBeNull();
      triggerPause!();
      expect(suspended).toBe(1);
      triggerResume!();
      expect(resumed).toBe(1);
    } finally {
      session.dispose();
      setPlatformAdapter(null);
    }
    expect(pauseUnbound).toBe(true);
    expect(resumeUnbound).toBe(true);

    // 2. stepPendingSpawns clears queue on terminal worlds & handles re-entrant queue mutation;
    //    bindSimEventBridge introOnScreen recovers when realClock rolls backward.
    const spawnBus = new EventBus();
    const spawnW = new SimWorld(LEVEL_L1C, spawnBus);
    const pending: Array<{ type: 'grunt'; delay: number }> = [
      { type: 'grunt', delay: 0.01 },
      { type: 'grunt', delay: 0.01 },
    ];
    spawnBus.on('enemySpawned', () => {
      spawnW.debugForceWin(); // transitions world to 'won' and clears enemyPool mid-queue!
    });
    stepPendingSpawns(pending, spawnW, 0.05);
    expect(pending).toHaveLength(0);
    expect(spawnW.enemyPool.getActiveCount()).toBe(0);

    let clockSec = 100;
    const toasts: string[] = [];
    const bridgeBus = new EventBus();
    const unbindBridge = bindSimEventBridge({
      bus: bridgeBus,
      soundManager: { bindEvents: () => () => {} } as never,
      overlays: {
        toast: { show: (msg: string) => toasts.push(msg) },
        floatingTextPool: { spawnUpgradeTier: () => {}, spawnDamage: () => {}, spawnGold: () => {} },
      } as never,
      getSettings: () => ({
        masterVolume: 0.5,
        muted: false,
        cameraShake: true,
        damageNumbers: false,
        quality: 'auto',
        haptics: false,
      }),
      getSimClock: () => 0,
      getRealClock: () => clockSec,
      onSyncUi: () => {},
      onGameWon: () => {},
      onGameLost: () => {},
    });
    bridgeBus.emit('enemySpawned', { enemyId: 1, enemyType: 'warden', flying: false });
    expect(toasts).toHaveLength(1);
    clockSec = 10; // rolled-back realClock (10 < 100) must NOT suppress future intro toasts!
    bridgeBus.emit('enemySpawned', { enemyId: 2, enemyType: 'hexer', flying: false });
    expect(toasts).toHaveLength(2);
    unbindBridge();

    // 3. InputManager.dispose() zeroes key-pan state if disposed while WASD is held.
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const panEvents: Array<[number, number]> = [];
      const canvas = document.createElement('canvas');
      const im = new InputManager(canvas, {
        onPanScreenDelta: () => {},
        onZoomDelta: () => {},
        onRotateCamera: () => {},
        onPointerMoveNdc: () => {},
        onPointerLeave: () => {},
        onPrimaryTapNdc: () => {},
        onSecondaryAction: () => {},
        onHotkeyTower: () => {},
        onHotkeyAbility: () => {},
        onToggleAutoWave: () => {},
        onToggleRoutes: () => {},
        onTowerActionHotkey: () => false,
        onTogglePause: () => {},
        onKeyPanState: (px, pz) => panEvents.push([px, pz]),
      });
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      expect(panEvents[panEvents.length - 1]).toEqual([0, -1]);
      im.dispose();
      expect(panEvents[panEvents.length - 1]).toEqual([0, 0]);
    }

    // 4. Workshop, Challenges, and xpForRun guard null/non-array/extreme inputs cleanly.
    expect(rankOf(null as never, 'treasury')).toBe(0);
    expect(workshopStarsSpent(undefined as never)).toBe(0);
    expect(workshopModifiers(null as never)).toEqual(NEUTRAL_RUN_MODIFIERS);
    expect(sanitizeChallengeSelection(LEVEL_L1C, null as never)).toEqual([]);
    expect(challengeModifiers(['not_a_challenge' as never])).toEqual(NEUTRAL_RUN_MODIFIERS);
    expect(runModifiersFor(NEUTRAL_RUN_MODIFIERS, ['not_a_challenge' as never])).toBe(NEUTRAL_RUN_MODIFIERS);
    expect(xpForRun({ won: true, stars: 3, enemiesKilled: Number.MAX_VALUE, wavesCleared: Number.MAX_VALUE })).toBe(
      MAX_HERO_XP,
    );
  });

  it('repairs NaN DailyRecord fields, guards GameLoop stop/restart RAF generations & ObjectPool NaN capacity, and keeps planPrecache order-independent', async () => {
    const { GameLoop } = await import('../../src/platform/browserLoop.ts');
    const { GameSession } = await import('../../src/platform/gameSession.ts');
    const { planPrecache } = await import('../../scripts/pwa/swBuilder.ts');
    installMemoryStorage();

    // 1. DailyRecord with NaN fields never returns or persists NaN across liveStreak / normalizeDailyRecord / applyDailyWin.
    const nanDaily = { lastDay: NaN, streak: NaN, bestStreak: NaN, total: NaN };
    expect(liveStreak(nanDaily, 20_500)).toBe(0);
    normalizeDailyRecord(nanDaily, 20_500);
    expect(nanDaily).toEqual({ lastDay: -1, streak: 0, bestStreak: 0, total: 0 });
    const nanDaily2 = { lastDay: NaN, streak: NaN, bestStreak: NaN, total: NaN };
    const winRes = applyDailyWin(nanDaily2, 20_500, 20_500);
    expect(winRes).toEqual({ counted: true, streak: 1 });
    expect(nanDaily2).toEqual({ lastDay: 20_500, streak: 1, bestStreak: 1, total: 1 });

    // 2. ObjectPool constructor safely clamps negative / NaN capacity to 0 without RangeError.
    const zeroPoolA = new ObjectPool(NaN, (id) => ({ id, active: false }));
    const zeroPoolB = new ObjectPool(-5, (id) => ({ id, active: false }));
    expect(zeroPoolA.items).toHaveLength(0);
    expect(zeroPoolA.acquire()).toBeNull();
    expect(zeroPoolB.items).toHaveLength(0);

    // 3. GameLoop.stop() inside onFixedTick skips onRender in that frame, and stale RAF callbacks cannot resurrect a stopped loop.
    const prevRaf = (globalThis as Record<string, unknown>).requestAnimationFrame;
    const prevCaf = (globalThis as Record<string, unknown>).cancelAnimationFrame;
    const queuedRaf = new Map<number, (now: number) => void>();
    let nextRaf = 1;
    try {
      (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: (now: number) => void): number => {
        const id = nextRaf++;
        queuedRaf.set(id, cb);
        return id;
      };
      (globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number): void => {
        queuedRaf.delete(id);
      };

      let renderCount = 0;
      let fixedCount = 0;
      const loopRef: InstanceType<typeof GameLoop> = new GameLoop({
        onFixedTick: () => {
          fixedCount++;
          loopRef.stop();
        },
        onRender: () => {
          renderCount++;
        },
      });
      loopRef.simActive = true;
      const t0 = performance.now();
      loopRef.start();
      expect(queuedRaf.size).toBe(1);
      const firstCb = [...queuedRaf.values()][0]!;
      queuedRaf.clear();
      // Advance 50ms -> runs 1 fixed tick which calls stop() -> onRender MUST be skipped and no new RAF remains!
      firstCb(t0 + 50);
      expect(fixedCount).toBe(1);
      expect(renderCount).toBe(0);
      expect(queuedRaf.size).toBe(0);

      // Invoking the stale firstCb again after stop() is a complete no-op (cannot resurrect RAF).
      firstCb(t0 + 100);
      expect(queuedRaf.size).toBe(0);
    } finally {
      if (prevRaf === undefined) delete (globalThis as Record<string, unknown>).requestAnimationFrame;
      else (globalThis as Record<string, unknown>).requestAnimationFrame = prevRaf;
      if (prevCaf === undefined) delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
      else (globalThis as Record<string, unknown>).cancelAnimationFrame = prevCaf;
    }

    // 4. GameSession.importSaveCode updates currentLevelIndex and refreshes open menu/levelSelect/workshop overlays.
    const levelSelectOpens: boolean[] = [];
    const mockRw = {
      setQuality: () => {},
      overlayIndicators: { setSelectedTowerRing: () => {} },
      setPlacementPreview: () => {},
      setPlacementGridActive: () => {},
      setFlightPathHighlight: () => {},
      setRoutesPinned: () => {},
      setMeteorTargetPreview: () => {},
      setHoveredTowerId: () => {},
      setCanvasCursor: () => {},
      loadLevel: () => {},
      cameraController: { setShowcaseMode: () => {}, setHudRects: () => {}, getViewVersion: () => 0 },
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
    gs.viewMode = 'levelSelect';
    gs.attachRuntime({
      overlays: {
        isModalOpen: () => false,
        setPlayVisibility: () => {},
        syncInPlay: () => {},
        closeModals: () => {},
        mainMenu: { setOpen: () => {} },
        levelSelect: { setOpen: (open: boolean) => levelSelectOpens.push(open) },
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
    });
    const importedProg = createDefaultProgress(LEVELS.length);
    importedProg.bestStars[0] = 3;
    importedProg.bestStars[1] = 3;
    importedProg.clears[0] = 1;
    importedProg.clears[1] = 1;
    importedProg.unlockedLevelIndex = 2;
    const resImport = gs.importSaveCode(encodeSaveCode(importedProg));
    expect(resImport.ok).toBe(true);
    expect(gs.currentLevelIndex).toBe(2);
    expect(levelSelectOpens).toContain(true);
    gs.dispose();

    // 5. planPrecache produces deterministic version hashes regardless of publicUrls order or duplicate bundleFiles.
    const planA = planPrecache({
      bundleFiles: ['index.html', 'assets/app.js', 'assets/app.js'],
      publicUrls: ['/icons/b.png', '/icons/a.png'],
      publicContent: (u) => new TextEncoder().encode(u),
      salt: 'v1',
    });
    const planB = planPrecache({
      bundleFiles: ['assets/app.js'],
      publicUrls: ['/icons/a.png', '/icons/b.png'],
      publicContent: (u) => new TextEncoder().encode(u),
      salt: 'v1',
    });
    expect(planA.version).toBe(planB.version);
    expect(planA.core).toEqual(['/', '/index.html', '/assets/app.js']);

    // 6. recordEndlessProgress writes to localStorage only when a new best wave record is set.
    const { recordEndlessProgress } = await import('../../src/platform/sessionBridge.ts');
    const store = installMemoryStorage();
    const eProg = createDefaultProgress(LEVELS.length);
    eProg.bestEndlessWaves[0] = 20;
    store.clear();
    const unchanged = recordEndlessProgress(eProg, 0, 18);
    expect(unchanged).toEqual({ best: 20, previousBest: 20, isNewBest: false });
    expect(store.size).toBe(0);
    const improved = recordEndlessProgress(eProg, 0, 24);
    expect(improved).toEqual({ best: 24, previousBest: 20, isNewBest: true });
    expect(store.size).toBe(1);
  });
});
