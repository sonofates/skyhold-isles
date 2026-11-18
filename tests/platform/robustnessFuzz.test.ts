import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { SeededRng } from '../../src/core/rng.ts';
import type { HeroId, ProgressData } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { CHALLENGE_IDS, challengeModifiers, runModifiersFor } from '../../src/data/challenges.ts';
import {
  applyDailyWin,
  createDailyRecord,
  dailyChallengeFor,
  liveStreak,
  normalizeDailyRecord,
  utcDayNumber,
} from '../../src/data/daily.ts';
import {
  countHeroSkillPointsSpent,
  defaultLevel20Skills,
  HERO_IDS,
  heroLevelFromXp,
  heroSkillPointsForLevel,
  xpForHeroLevel,
} from '../../src/render2d/heroes2d.ts';
import { LEVEL_L1C, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { maxedWorkshopRanks, WORKSHOP_UPGRADES, workshopModifiers } from '../../src/data/workshop.ts';
import { starWallet } from '../../src/game/progression.ts';
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
  islandStates,
  loadProgress2D,
  PROGRESS_2D_KEY,
  recordWin2D,
  remapProgress,
} from '../../src/render2d/ui/progress2d.ts';
import { buildEndlessWaveDef } from '../../src/sim/waveSystem.ts';
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
});
