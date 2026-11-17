import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENDLESS_MUTATOR_PRESETS, ENDLESS_MUTATORS } from '../../src/data/challenges.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';
import { getTowerTierStats, TOWER_DEFS } from '../../src/data/towers.ts';
import {
  computeDailyStreaks,
  generateDailyChallenge,
  getRecentDailySpecs,
  isValidDateString,
} from '../../src/sim/meta/daily.ts';
import {
  describeActiveModifiers,
  getAllowedTowerTypes,
  hasActiveRunModifiers,
  isAdvantageousModifiers,
  isTowerTypeAllowed,
  mergeRunModifiers,
  resolveRunModifiers,
} from '../../src/sim/meta/modifiers.ts';
import {
  buildEndlessMutatorLoadout,
  computeCampaignRunScore,
  computeEndlessScore,
  getMutatorPresetRoll,
  hashSeedString,
  resolveMutatorSelection,
  selectEndlessMutators,
} from '../../src/sim/meta/mutators.ts';
import { RunObserver } from '../../src/sim/meta/runObserver.ts';
import { SimWorld } from '../../src/sim/world.ts';

describe('Endless mutators determinism & scoring', () => {
  it('selects identical mutator sets and score multipliers for identical numeric or string seeds', () => {
    const rollA1 = selectEndlessMutators(424242, 2);
    const rollA2 = selectEndlessMutators(424242, 2);
    expect(rollA1).toEqual(rollA2);
    expect(rollA1.mutators).toHaveLength(2);
    expect(rollA1.scoreMultiplier).toBeGreaterThan(1);

    const rollStr1 = selectEndlessMutators('skyhold-season-1', 3);
    const rollStr2 = selectEndlessMutators('skyhold-season-1', 3);
    expect(rollStr1).toEqual(rollStr2);
    expect(rollStr1.seed).toBe(hashSeedString('skyhold-season-1'));
    expect(rollStr1.mutators).toHaveLength(3);
  });

  it('never picks two mutators from the same conflict group', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const roll = selectEndlessMutators(seed, 4);
      const groups = new Set<string>();
      for (const m of roll.mutators) {
        if (m.conflictGroup) {
          expect(groups.has(m.conflictGroup)).toBe(false);
          groups.add(m.conflictGroup);
        }
      }
      // Verify scoreMultiplier matches sum of bonuses
      const expectedMult = +(
        1 + roll.mutators.reduce((sum, m) => sum + m.scoreMultiplierBonus, 0)
      ).toFixed(2);
      expect(roll.scoreMultiplier).toBe(expectedMult);
    }
    expect(ENDLESS_MUTATORS.length).toBeGreaterThanOrEqual(6);
  });

  it('computes endless score with mutator multiplier', () => {
    const base = computeEndlessScore(4, 120, 1);
    expect(base.baseScore).toBe(4 * 150 + 120 * 2);
    expect(base.totalScore).toBe(base.baseScore);

    const boosted = computeEndlessScore(4, 120, 1.55);
    expect(boosted.baseScore).toBe(base.baseScore);
    expect(boosted.totalScore).toBe(Math.round(base.baseScore * 1.55));
  });
});

describe('SimWorld integration with RunModifiers', () => {
  it('applies speed, armor, HP, gold drought, tower cost scaling, and tower bans', () => {
    const testLevel: LevelDef = {
      ...LEVELS[0],
      startingGold: 400,
      waves: [
        {
          clearBonus: 40,
          groups: [
            { enemyType: 'grunt', count: 2, spawnInterval: 0.5, startDelay: 0 },
            { enemyType: 'flyer', count: 2, spawnInterval: 0.5, startDelay: 0 },
          ],
        },
      ],
    };

    const modifiers = {
      enemySpeedMultiplier: 1.5,
      enemyHpMultiplier: 1.5,
      enemyArmorBonus: 4,
      flyerCountMultiplier: 2,
      goldRewardMultiplier: 0.5,
      towerCostMultiplier: 1.2,
      forbiddenTowerTypes: ['frost'] as const,
      scoreMultiplier: 2.0,
    };

    const events = new EventBus();
    const world = new SimWorld(testLevel, events, modifiers);
    const observer = new RunObserver(testLevel, events, modifiers);

    // Forbidden tower is rejected
    expect(world.placeTower(4, 2, 'frost')).toBeNull();
    // Cost helpers reflect towerCostMultiplier (50 * 1.2 = 60, T2 55 * 1.2 = 66)
    expect(world.getTowerBuildCost('archer')).toBe(60);
    // Allowed tower pays scaled cost (50 * 1.2 = 60)
    const archer = world.placeTower(4, 2, 'archer');
    expect(archer).not.toBeNull();
    expect(archer!.totalInvested).toBe(Math.round(getTowerTierStats('archer', 1).upgradeCost * 1.2));
    expect(world.getTowerUpgradeCost(archer!)).toBe(66);
    expect(world.gold).toBe(400 - 60);

    // Wave flyer count doubled (2 -> 4 flyers + 2 grunts = 6 total enemies)
    let spawnedFlyers = 0;
    let spawnedGrunts = 0;
    events.on('enemySpawned', (e) => {
      if (e.enemyType === 'flyer') spawnedFlyers++;
      if (e.enemyType === 'grunt') spawnedGrunts++;
    });

    world.startNextWave();
    for (let i = 0; i < 60 * 6; i++) {
      world.fixedTick(BALANCE.fixedDt);
    }

    expect(spawnedGrunts).toBe(2);
    expect(spawnedFlyers).toBe(4);

    // Verify active spawned enemy has modified speed, hp, armor, reward
    const idx = world.enemyPool.getActiveIndex(0);
    const sampleEnemy = world.enemyPool.items[idx];
    const baseDef = ENEMY_DEFS[sampleEnemy.type];
    expect(sampleEnemy.speed).toBeCloseTo(baseDef.speed * 1.5, 4);
    expect(sampleEnemy.maxHp).toBe(Math.round(baseDef.maxHp * 1.5));
    expect(sampleEnemy.armor).toBe(baseDef.armor + 4);
    expect(sampleEnemy.reward).toBe(Math.max(1, Math.round(baseDef.reward * 0.5)));

    observer.dispose();
  });

  it('spawns extra flyers and applies modifiers when entering endless mode with mutators', () => {
    const miniLevel: LevelDef = {
      ...LEVELS[0],
      startingGold: 800,
      waves: [
        {
          clearBonus: 20,
          groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.5, startDelay: 0 }],
        },
      ],
    };

    const events = new EventBus();
    const world = new SimWorld(miniLevel, events);
    world.placeTower(4, 2, 'archer');
    world.startNextWave();
    for (let i = 0; i < 60 * 30 && world.outcome === 'ongoing'; i++) {
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.outcome).toBe('won');

    const roll = {
      enemySpeedMultiplier: 1.22,
      flyerCountMultiplier: 2,
      activeMutatorIds: ['swift_march', 'sky_swarm'],
      scoreMultiplier: 1.55,
    };
    expect(world.enterEndlessMode(roll)).toBe(true);
    let endlessFlyers = 0;
    events.on('enemySpawned', (e) => {
      if (e.enemyType === 'flyer') endlessFlyers++;
    });

    world.startNextWave();
    // Tick until all enemies in wave 2 have spawned (buildEndlessWaveDef at offset 0 has 6 flyers -> 12 with 2x)
    for (let i = 0; i < 60 * 15; i++) {
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(endlessFlyers).toBe(12);

    // debugForceWin must be a no-op once inside Endless Mode
    world.debugForceWin();
    expect(world.outcome).toBe('ongoing');
  });
});

describe('Daily challenge pure date-seeded generator', () => {
  it('validates YYYY-MM-DD calendar strings accurately', () => {
    expect(isValidDateString('2026-11-17')).toBe(true);
    expect(isValidDateString('2024-02-29')).toBe(true);
    expect(isValidDateString('2025-02-29')).toBe(false);
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
    expect(isValidDateString('2026-11-7')).toBe(false);
    expect(isValidDateString('invalid')).toBe(false);
    expect(() => generateDailyChallenge('2026-02-30')).toThrow(RangeError);
  });

  it('produces deterministic daily specs for a given date string and always retains anti-air', () => {
    const spec1 = generateDailyChallenge('2026-11-17', LEVELS);
    const spec2 = generateDailyChallenge('2026-11-17', LEVELS);
    expect(spec1).toEqual(spec2);
    expect(spec1.date).toBe('2026-11-17');
    expect(spec1.levelIndex).toBeGreaterThanOrEqual(0);
    expect(spec1.levelIndex).toBeLessThan(LEVELS.length);
    expect(spec1.mutators.length).toBeGreaterThanOrEqual(1);
    expect(spec1.scoreMultiplier).toBeGreaterThan(1);

    // Check 60 consecutive dates to ensure diversity and anti-air viability on every single day
    const islandsSeen = new Set<string>();
    for (let day = 1; day <= 30; day++) {
      const d1 = `2026-03-${String(day).padStart(2, '0')}`;
      const d2 = `2026-04-${String(day).padStart(2, '0')}`;
      for (const d of [d1, d2]) {
        const spec = generateDailyChallenge(d, LEVELS);
        islandsSeen.add(spec.levelId);
        const allowed = spec.modifiers.allowedTowerTypes;
        const forbidden = spec.modifiers.forbiddenTowerTypes;
        const legalTowers = (allowed ?? (Object.keys(TOWER_DEFS) as Array<keyof typeof TOWER_DEFS>)).filter(
          (t) => !forbidden.includes(t),
        );
        expect(legalTowers.some((t) => TOWER_DEFS[t].hitsFlyers)).toBe(true);
      }
    }
    expect(islandsSeen.size).toBeGreaterThanOrEqual(6);
  });

  it('computes daily calendar streaks accurately across month boundaries and pending today', () => {
    const completed = [
      '2026-01-29',
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      // gap
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ];
    // On 2026-03-02 (yesterday completed, today not yet played): current streak stays alive at 3
    expect(computeDailyStreaks(completed, '2026-03-02')).toEqual({
      currentStreak: 3,
      bestStreak: 4,
    });
    // Completing 2026-03-02 bumps current streak to 4
    expect(computeDailyStreaks([...completed, '2026-03-02'], '2026-03-02')).toEqual({
      currentStreak: 4,
      bestStreak: 4,
    });
    // Missing two days resets currentStreak to 0 while preserving bestStreak
    expect(computeDailyStreaks(completed, '2026-03-03')).toEqual({
      currentStreak: 0,
      bestStreak: 4,
    });
  });

  it('resolves allowed and forbidden towers cleanly for build bar restrictions', () => {
    const spec = generateDailyChallenge('2026-11-17', LEVELS);
    const allowed = getAllowedTowerTypes(spec.modifiers);
    expect(allowed.length).toBeGreaterThanOrEqual(1);
    for (const t of allowed) {
      expect(isTowerTypeAllowed(t, spec.modifiers)).toBe(true);
    }
    for (const banned of spec.modifiers.forbiddenTowerTypes) {
      expect(isTowerTypeAllowed(banned, spec.modifiers)).toBe(false);
      expect(allowed).not.toContain(banned);
    }
  });

  it('keeps spec.scoreMultiplier synced with modifiers and balances Master daily rules', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 120; i++) {
      const ds = start.toISOString().slice(0, 10);
      const spec = generateDailyChallenge(ds, LEVELS);
      expect(spec.scoreMultiplier).toBe(spec.modifiers.scoreMultiplier);
      const lvl = LEVELS[spec.levelIndex];
      if (lvl.difficulty === 'Master') {
        expect(spec.mutators).toHaveLength(1);
        expect(spec.mutators.some((m) => m.id === 'gold_drought')).toBe(false);
        expect(spec.towerRestriction.kind).not.toBe('limited_arsenal');
        expect(spec.modifiers.forbiddenTowerTypes.length).toBeLessThanOrEqual(1);
      }
      const badges = describeActiveModifiers(spec.modifiers);
      expect(badges.length).toBeGreaterThanOrEqual(spec.mutators.length);
      start.setUTCDate(start.getUTCDate() + 1);
    }
  });

  it('always retains primary anti-air DPS, anti-armor coverage, and never stacks bans across 365 dailies', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 365; i++) {
      const ds = start.toISOString().slice(0, 10);
      const spec = generateDailyChallenge(ds, LEVELS);
      const lvl = LEVELS[spec.levelIndex];
      const legalTowers = getAllowedTowerTypes(spec.modifiers);
      expect(
        legalTowers.some((t) => TOWER_DEFS[t].hitsFlyers && TOWER_DEFS[t].tiers[0].damage >= 15),
      ).toBe(true);

      // Never stack multiple tower bans or mix ban_one + limited_arsenal
      expect(spec.modifiers.forbiddenTowerTypes.length).toBeLessThanOrEqual(1);
      if (spec.modifiers.allowedTowerTypes !== null) {
        expect(spec.modifiers.forbiddenTowerTypes).toHaveLength(0);
      }

      // Never ban anti-air towers when Sky Swarm (2x flyers) is active
      if (spec.modifiers.flyerCountMultiplier > 1) {
        expect(spec.modifiers.forbiddenTowerTypes.some((t) => TOWER_DEFS[t].hitsFlyers)).toBe(false);
      }

      // Heroic dailies never combine gold_drought with limited_arsenal, and heavy-armored limited_arsenal retains splash/heavy damage
      if (lvl.difficulty === 'Heroic' && spec.modifiers.goldRewardMultiplier < 1) {
        expect(spec.towerRestriction.kind).not.toBe('limited_arsenal');
      }
      const hasHeavyArmored = lvl.waves.some((w) =>
        w.groups.some((g) => (g.enemyType === 'brute' && g.count >= 6) || g.enemyType === 'boss'),
      );
      if (
        lvl.difficulty === 'Heroic' ||
        (lvl.difficulty !== 'Breezy' && hasHeavyArmored) ||
        spec.modifiers.enemyArmorBonus > 0
      ) {
        expect(legalTowers.some((t) => TOWER_DEFS[t].tiers[0].damage >= 35)).toBe(true);
      }

      start.setUTCDate(start.getUTCDate() + 1);
    }

    const recent = getRecentDailySpecs('2026-03-02', 5, LEVELS);
    expect(recent.map((s) => s.date)).toEqual([
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  it('validates custom mutator loadouts and curated mutator presets cleanly', () => {
    // Conflict group 'economy-squeeze' prevents stacking gold_drought + tight_budget
    const custom = buildEndlessMutatorLoadout(['gold_drought', 'tight_budget', 'swift_march', 'gold_drought', 'unknown']);
    expect(custom.mutators.map((m) => m.id)).toEqual(['gold_drought', 'swift_march']);
    expect(custom.scoreMultiplier).toBe(1.6);

    expect(ENDLESS_MUTATOR_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const preset of ENDLESS_MUTATOR_PRESETS) {
      const roll = getMutatorPresetRoll(preset.id);
      expect(roll).not.toBeNull();
      expect(roll!.mutators.map((m) => m.id)).toEqual(preset.mutatorIds);
      expect(roll!.scoreMultiplier).toBeGreaterThan(1);
    }
    expect(getMutatorPresetRoll('non-existent')).toBeNull();
  });

  it('plays and wins a full restricted Daily Watch in SimWorld while preserving economy integrity', () => {
    const spec = generateDailyChallenge('2026-07-13', LEVELS);
    const level = LEVELS[spec.levelIndex];
    const events = new EventBus();
    const world = new SimWorld(level, events, spec.modifiers);
    const obs = new RunObserver(level, events, spec.modifiers);

    // Banned towers cannot be built under this Daily Watch's limited arsenal
    expect(world.placeTower(4, 2, 'cannon')).toBeNull();

    const spots: Array<[number, number, 'archer' | 'frost' | 'tesla']> = [
      [4, 2, 'archer'],
      [7, 5, 'frost'],
      [4, 3, 'tesla'],
      [8, 5, 'archer'],
      [10, 4, 'tesla'],
      [5, 7, 'tesla'],
    ];
    let idx = 0;
    world.startNextWave();
    for (let t = 0; t < 60 * 1200 && world.outcome === 'ongoing'; t++) {
      while (idx < spots.length) {
        const [c, r, type] = spots[idx];
        if (world.gold < world.getTowerBuildCost(type)) break;
        world.placeTower(c, r, type);
        idx++;
      }
      if (idx >= spots.length) {
        for (const tw of world.towers) {
          const uc = world.getTowerUpgradeCost(tw);
          if (uc !== null && world.gold >= uc) {
            world.upgradeTower(tw.id);
            break;
          }
        }
      }
      if (world.waveSystem.state !== 'preFirstWave') {
        if (
          world.abilitySystem.canCast('overcharge') &&
          (world.towers.some((tw) => tw.stunTimer > 0) || world.enemyPool.getActiveCount() >= 10)
        ) {
          world.castOvercharge();
        }
        if (world.abilitySystem.canCast('meteor') && world.enemyPool.getActiveCount() > 0) {
          let best = null;
          for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
            const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
            if (!e.flying && (!best || e.dist > best.dist)) best = e;
          }
          if (best && (best.type === 'boss' || best.type === 'brute' || best.dist / best.totalDist > 0.5)) {
            world.castMeteor(best.x, best.z);
          }
        }
      }
      obs.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }

    expect(world.outcome).toBe('won');
    expect(obs.verifyEconomyIntegrity(world.gold, world.lives)).toBe(true);
    obs.dispose();
  });

  it('keeps RunObserver economy integrity exact across builds, upgrades, sells, early calls, and clear bonuses under tight_budget + gold_drought', () => {
    const level: LevelDef = {
      ...LEVELS[0],
      startingGold: 1000,
      waves: [
        { clearBonus: 31, groups: [{ enemyType: 'grunt', count: 3, spawnInterval: 0.3, startDelay: 0 }] },
        { clearBonus: 43, groups: [{ enemyType: 'flyer', count: 2, spawnInterval: 0.3, startDelay: 0 }] },
      ],
    };
    const combinedMods = {
      towerCostMultiplier: 1.15,
      goldRewardMultiplier: 0.75,
      flyerCountMultiplier: 2,
      activeMutatorIds: ['tight_budget', 'gold_drought', 'sky_swarm'],
      scoreMultiplier: 1.9,
    };

    const events = new EventBus();
    const world = new SimWorld(level, events, combinedMods);
    const obs = new RunObserver(level, events, combinedMods);

    const a = world.placeTower(4, 2, 'archer')!;
    const b = world.placeTower(4, 3, 'cannon')!;
    expect(world.upgradeTower(a.id)).toBe(true);
    expect(world.upgradeTower(a.id)).toBe(true);
    expect(world.sellTower(b.id)).toBeGreaterThan(0);

    world.startNextWave();
    for (let i = 0; i < 60 * 30 && world.waveSystem.state !== 'betweenWaves'; i++) {
      obs.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(obs.verifyEconomyIntegrity(world.gold, world.lives)).toBe(true);

    // Call Wave 2 early with scaled earlyBonus and finish run
    expect(world.startNextWave()).toBe(true);
    for (let i = 0; i < 60 * 60 && world.outcome === 'ongoing'; i++) {
      obs.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.outcome).toBe('won');
    expect(obs.verifyEconomyIntegrity(world.gold, world.lives)).toBe(true);
    obs.dispose();
  });

  it('resolves mutator selections uniformly, preserves disjoint empty arsenals, and computes campaign scores', () => {
    // Disjoint allowedTowerTypes intersection stays empty even after re-resolving
    const disjoint = mergeRunModifiers(
      { allowedTowerTypes: ['archer'] },
      { allowedTowerTypes: ['cannon'] },
    );
    expect(disjoint.allowedTowerTypes).toEqual([]);
    const reResolved = resolveRunModifiers(disjoint);
    expect(reResolved.allowedTowerTypes).toEqual([]);
    expect(getAllowedTowerTypes(reResolved)).toEqual([]);
    expect(isTowerTypeAllowed('archer', reResolved)).toBe(false);
    expect(describeActiveModifiers(reResolved)[0]?.label).toBe('No Towers Allowed');

    // resolveMutatorSelection supports presetId, seed, mutator ID list, and raw modifiers
    const fromPreset = resolveMutatorSelection({ presetId: 'iron-skies' });
    expect(fromPreset.activeMutatorIds).toEqual(['iron_clad', 'sky_swarm']);
    expect(fromPreset.scoreMultiplier).toBe(1.6);

    const fromIds = resolveMutatorSelection(['swift_march', 'titan_tide']);
    expect(fromIds.activeMutatorIds).toEqual(['swift_march', 'titan_tide']);

    const fromSeed1 = resolveMutatorSelection({ seed: 'weekly-alpha', count: 2 });
    const fromSeed2 = resolveMutatorSelection({ seed: 'weekly-alpha', count: 2 });
    expect(fromSeed1).toEqual(fromSeed2);
    expect(() => resolveMutatorSelection({ presetId: 'does-not-exist' })).toThrow(RangeError);

    expect(isAdvantageousModifiers(fromPreset)).toBe(false);
    expect(isAdvantageousModifiers(resolveRunModifiers({ towerCostMultiplier: 0.8 }))).toBe(true);
    expect(hasActiveRunModifiers(resolveRunModifiers(null))).toBe(false);
    expect(hasActiveRunModifiers(resolveRunModifiers({ enemyHpMultiplier: 1.3 }))).toBe(true);
    expect(hasActiveRunModifiers(resolveRunModifiers({ forbiddenTowerTypes: ['frost'] }))).toBe(true);

    // Campaign score combines wave/kill base * multiplier + 25 per remaining life
    expect(computeCampaignRunScore(10, 80, 18, 1.5)).toBe(
      Math.round((10 * 150 + 80 * 2) * 1.5) + 18 * 25,
    );
  });
});
