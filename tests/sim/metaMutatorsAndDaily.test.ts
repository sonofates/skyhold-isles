import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENDLESS_MUTATOR_PRESETS, ENDLESS_MUTATORS } from '../../src/data/challenges.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';
import { getTowerTierStats, TOWER_DEFS, TOWER_TYPES } from '../../src/data/towers.ts';
import {
  computeDailyStreaks,
  generateDailyChallenge,
  getRecentDailySpecs,
  isValidDateString,
} from '../../src/sim/meta/daily.ts';
import {
  applyModifiersToLevel,
  describeActiveModifiers,
  getAllowedTowerTypes,
  hasActiveRunModifiers,
  isAdvantageousModifiers,
  isTowerTypeAllowed,
  mergeRunModifiers,
  resolveRunModifiers,
  scaleGoldCost,
  scaleGoldReward,
} from '../../src/sim/meta/modifiers.ts';
import {
  buildEndlessMutatorLoadout,
  computeCampaignRunScore,
  computeEndlessScore,
  getConflictingMutatorIds,
  getMutatorPresetRoll,
  hashSeedString,
  previewMutatorSelection,
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

      // Never ban anti-air towers when Sky Swarm (2x flyers) is active,
      // and include >= 2 anti-air towers if limited_arsenal coincides with Sky Swarm
      if (spec.modifiers.flyerCountMultiplier > 1) {
        expect(spec.modifiers.forbiddenTowerTypes.some((t) => TOWER_DEFS[t].hitsFlyers)).toBe(false);
        if (spec.towerRestriction.kind === 'limited_arsenal') {
          expect(legalTowers.filter((t) => TOWER_DEFS[t].hitsFlyers).length).toBeGreaterThanOrEqual(2);
        }
      }

      // Heroic dailies never combine economy-squeeze mutators (gold_drought/tight_budget) with limited_arsenal,
      // nor 2 mutators + economy squeeze/HP boost with any tower ban; Master dailies never stack an extra ban
      // on top of HP/speed/flyer/economy mutators; heavy-armored limited_arsenal retains splash/heavy damage
      const hasEconomySqueeze =
        spec.modifiers.goldRewardMultiplier < 1 || spec.modifiers.towerCostMultiplier > 1;
      if (lvl.difficulty === 'Master') {
        const hasMasterIntensity =
          hasEconomySqueeze ||
          spec.modifiers.enemyHpMultiplier > 1 ||
          spec.modifiers.enemySpeedMultiplier > 1 ||
          spec.modifiers.flyerCountMultiplier > 1;
        if (hasMasterIntensity && spec.modifiers.forbiddenTowerTypes.length === 0) {
          expect(spec.towerRestriction.kind).toBe('none');
        }
      }
      if (lvl.difficulty === 'Heroic') {
        expect(spec.towerRestriction.kind).not.toBe('limited_arsenal');
        expect(spec.mutators.some((m) => m.id === 'gold_drought') && spec.mutators.length >= 2).toBe(false);
        if (
          (hasEconomySqueeze ||
            spec.modifiers.enemyHpMultiplier > 1 ||
            spec.mutators.length >= 2) &&
          spec.modifiers.forbiddenTowerTypes.length === 0
        ) {
          expect(spec.towerRestriction.kind).toBe('none');
        }
      }
      if (lvl.difficulty === 'Challenging') {
        expect(spec.mutators.some((m) => m.id === 'gold_drought') && spec.mutators.length >= 2).toBe(false);
        if (
          spec.mutators.length >= 2 ||
          hasEconomySqueeze ||
          spec.modifiers.enemyHpMultiplier > 1 ||
          spec.modifiers.flyerCountMultiplier > 1
        ) {
          expect(spec.towerRestriction.kind).not.toBe('limited_arsenal');
        }
        if (
          spec.mutators.length >= 2 &&
          hasEconomySqueeze &&
          spec.modifiers.forbiddenTowerTypes.length === 0
        ) {
          expect(spec.towerRestriction.kind).toBe('none');
        }
      }
      // Never contradict a mutator tower ban with 'Full Arsenal' label
      if (spec.modifiers.forbiddenTowerTypes.length > 0 && spec.towerRestriction.kind === 'none') {
        expect(spec.towerRestriction.label).toBe('No Extra Ban');
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
    const coreLevels = LEVELS.slice(0, 9);
    const spec = generateDailyChallenge('2026-07-13', coreLevels);
    const level = coreLevels[spec.levelIndex];
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

  it('wins Challenging, Heroic, and Master Daily Watch runs in SimWorld with mutators, tower bans, and economy integrity intact', () => {
    const coreLevels = LEVELS.slice(0, 9);
    for (const dateStr of [
      '2026-11-15',
      '2026-11-04',
      '2026-01-02',
      '2026-02-26',
      '2026-01-28',
      '2026-03-20',
      '2026-12-06',
      '2026-10-21',
      '2026-08-26',
    ] as const) {
      const spec = generateDailyChallenge(dateStr, coreLevels);
      const level = coreLevels[spec.levelIndex];
      const legal = getAllowedTowerTypes(spec.modifiers);
      const events = new EventBus();
      const world = new SimWorld(level, events, spec.modifiers);
      const obs = new RunObserver(level, events, spec.modifiers);

      const substituteTower = (type: keyof typeof TOWER_DEFS) => {
        if (legal.includes(type)) return type;
        if (TOWER_DEFS[type].hitsFlyers) {
          return legal.find((c) => TOWER_DEFS[c].hitsFlyers) ?? legal[0];
        }
        return legal.find((c) => TOWER_DEFS[c].tiers[0].damage >= 35) ?? legal[0];
      };

      const queue = (level.scriptedBuildOrder ?? []).map((a) =>
        a.action === 'build' && a.towerType
          ? { ...a, towerType: substituteTower(a.towerType) }
          : a,
      );
      const tryStep = (): boolean => {
        while (queue.length > 0) {
          const a = queue[0];
          if (a.action === 'build') {
            const cost = world.getTowerBuildCost(a.towerType!);
            if (world.gold < cost) return false;
            if (!world.placeTower(a.col, a.row, a.towerType!, a.targetingMode ?? 'first')) {
              queue.shift();
              continue;
            }
            queue.shift();
            return true;
          }
          const tid = world.grid.getTowerIdAt(a.col, a.row);
          const tw = tid === -1 ? null : world.getTowerById(tid);
          if (!tw || tw.tier >= 3) {
            queue.shift();
            continue;
          }
          const uc = world.getTowerUpgradeCost(tw);
          if (uc === null || world.gold < uc) return false;
          if (world.upgradeTower(tid)) {
            queue.shift();
            return true;
          }
          queue.shift();
        }
        for (const tw of world.towers) {
          const uc = world.getTowerUpgradeCost(tw);
          if (uc !== null && world.gold >= uc) {
            world.upgradeTower(tw.id);
            return true;
          }
        }
        return false;
      };

      while (tryStep()) {
        // pre-wave setup
      }
      world.startNextWave();

      for (let t = 0; t < 60 * 2400 && world.outcome === 'ongoing'; t++) {
        if (world.waveSystem.state === 'betweenWaves') {
          while (tryStep()) {
            // between-wave build/upgrade
          }
          if (world.waveSystem.canStartNextWave()) {
            world.startNextWave();
          }
        } else if (t % (60 * 4) === 0) {
          tryStep();
        }
        if (world.waveSystem.state !== 'preFirstWave') {
          if (
            world.abilitySystem.canCast('overcharge') &&
            (world.towers.some((tw) => tw.stunTimer > 0) || world.enemyPool.getActiveCount() >= 8)
          ) {
            world.castOvercharge();
          }
          if (world.abilitySystem.canCast('meteor') && world.enemyPool.getActiveCount() > 0) {
            let best = null;
            for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
              const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
              if (!e.flying && (!best || e.dist > best.dist)) best = e;
            }
            if (best) world.castMeteor(best.x, best.z);
          }
        }
        obs.onTick(BALANCE.fixedDt, 3);
        world.fixedTick(BALANCE.fixedDt);
      }

      expect(world.outcome).toBe('won');
      expect(obs.verifyEconomyIntegrity(world.gold, world.lives)).toBe(true);
      expect(obs.getTelemetry().eligibleForChallenges).toBe(true);
      obs.dispose();
    }
  }, 15_000);

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

  it('previews mutator badges, legal towers, score multipliers, and conflict exclusions before launch', () => {
    expect(getConflictingMutatorIds(['sky_swarm'])).toEqual(['no_frost', 'no_tesla']);
    expect(getConflictingMutatorIds(['gold_drought'])).toEqual(['tight_budget']);

    const presetPreview = previewMutatorSelection({ presetId: 'iron-skies' });
    expect(presetPreview.scoreMultiplier).toBe(1.6);
    expect(presetPreview.badges.map((b) => b.id)).toEqual(['iron_clad', 'sky_swarm']);
    expect(presetPreview.allowedTowerTypes).toEqual(TOWER_TYPES);
    expect(presetPreview.conflictingMutatorIds).toEqual(['no_frost', 'no_tesla']);

    const customPreview = previewMutatorSelection(['gold_drought', 'tight_budget', 'no_frost']);
    expect(customPreview.modifiers.activeMutatorIds).toEqual(['gold_drought', 'no_frost']);
    expect(customPreview.scoreMultiplier).toBe(1.6);
    expect(customPreview.allowedTowerTypes).not.toContain('frost');
    expect(customPreview.conflictingMutatorIds).toEqual(['sky_swarm', 'tight_budget', 'no_tesla']);

    const rawPreview = previewMutatorSelection({ forbiddenTowerTypes: ['mortar'], scoreMultiplier: 1.25 });
    expect(rawPreview.scoreMultiplier).toBe(1.25);
    expect(rawPreview.badges.map((b) => b.id)).toEqual(['restricted-towers']);
    expect(rawPreview.allowedTowerTypes).not.toContain('mortar');
    expect(rawPreview.conflictingMutatorIds).toEqual([]);

    const customScalarPreview = previewMutatorSelection({
      enemyHpMultiplier: 1.35,
      enemySpeedMultiplier: 1.2,
      enemyArmorBonus: 2,
      flyerCountMultiplier: 2,
      goldRewardMultiplier: 0.8,
      startingGoldMultiplier: 0.9,
      towerCostMultiplier: 1.15,
    });
    expect(customScalarPreview.badges.map((b) => b.id)).toEqual([
      'custom-enemy-hp',
      'custom-enemy-speed',
      'custom-enemy-armor',
      'custom-flyer-count',
      'custom-gold-reward',
      'custom-starting-gold',
      'custom-tower-cost',
    ]);
    expect(customScalarPreview.badges[0].label).toBe('Enemy HP +35%');
    expect(customScalarPreview.badges[3].label).toBe('2x Flyers');
  });

  it('generates fair deterministic Daily Watch challenges when Islands 10+ are appended', () => {
    const island10: LevelDef = {
      ...LEVELS[6],
      id: 'obsidian-aerie',
      index: 9,
      name: 'Obsidian Aerie',
      difficulty: 'Heroic',
    };
    const island11: LevelDef = {
      ...LEVELS[8],
      id: 'storm-crown',
      index: 10,
      name: 'Storm Crown',
      difficulty: 'Master',
    };
    const expandedLevels = [...LEVELS, island10, island11];

    const seenExpanded = new Set<string>();
    const start = new Date('2026-08-01T00:00:00Z');
    for (let i = 0; i < 60; i++) {
      const ds = start.toISOString().slice(0, 10);
      const spec = generateDailyChallenge(ds, expandedLevels);
      expect(spec).toEqual(generateDailyChallenge(ds, expandedLevels));
      expect(spec.scoreMultiplier).toBe(spec.modifiers.scoreMultiplier);
      if (spec.levelIndex >= 9) seenExpanded.add(spec.levelId);

      const lvl = expandedLevels[spec.levelIndex];
      const legal = getAllowedTowerTypes(spec.modifiers);
      expect(legal.some((t) => TOWER_DEFS[t].hitsFlyers && TOWER_DEFS[t].tiers[0].damage >= 15)).toBe(true);
      if (lvl.difficulty === 'Master') {
        expect(spec.mutators).toHaveLength(1);
        expect(spec.towerRestriction.kind).not.toBe('limited_arsenal');
      }
      start.setUTCDate(start.getUTCDate() + 1);
    }
    expect(seenExpanded.size).toBe(2);

    expect(selectEndlessMutators('nan-safe', Number.NaN).mutators).toHaveLength(2);
    expect(getRecentDailySpecs('2026-11-17', Number.NaN)).toHaveLength(7);

    // Non-finite score inputs & 0/negative/non-finite scaleGoldCost / scaleGoldReward safety
    expect(computeEndlessScore(Number.NaN, Number.POSITIVE_INFINITY, 1.5)).toEqual({
      baseScore: 0,
      scoreMultiplier: 1.5,
      totalScore: 0,
    });
    expect(computeCampaignRunScore(5, 20, Number.NaN, 1.2)).toBe(Math.round((5 * 150 + 20 * 2) * 1.2));
    const costMod = resolveRunModifiers({ towerCostMultiplier: 1.25, goldRewardMultiplier: 0.75 });
    expect(scaleGoldCost(0, costMod)).toBe(0);
    expect(scaleGoldCost(-15, costMod)).toBe(0);
    expect(scaleGoldCost(Number.NaN, costMod)).toBe(0);
    expect(scaleGoldCost(Number.POSITIVE_INFINITY, costMod)).toBe(0);
    expect(scaleGoldReward(0, costMod)).toBe(0);
    expect(scaleGoldReward(-10, costMod)).toBe(0);
    expect(scaleGoldReward(Number.NaN, costMod)).toBe(0);
    expect(scaleGoldReward(Number.POSITIVE_INFINITY, costMod)).toBe(0);

    // Split-group heavy armored waves on Challenging islands also retain armor-breakers (>=35 dmg)
    const splitArmorChallenging: LevelDef = {
      ...LEVELS[1],
      id: 'split-armor-isle',
      difficulty: 'Challenging',
      waves: [
        {
          clearBonus: 30,
          groups: [
            { enemyType: 'brute', count: 3, spawnInterval: 0.9, startDelay: 0 },
            { enemyType: 'brute', count: 2, spawnInterval: 0.9, startDelay: 1.5 },
          ],
        },
      ],
    };
    for (let i = 1; i <= 30; i++) {
      const ds = `2026-09-${String(i).padStart(2, '0')}`;
      const spec = generateDailyChallenge(ds, [splitArmorChallenging]);
      const legal = getAllowedTowerTypes(spec.modifiers);
      expect(legal.some((t) => TOWER_DEFS[t].tiers[0].damage >= 35)).toBe(true);
    }

    // Leap-day and year-boundary daily calendar streak continuity
    expect(
      computeDailyStreaks(
        ['2024-02-28', '2024-02-29', '2024-03-01', '2025-12-31', '2026-01-01'],
        '2026-01-01',
      ),
    ).toEqual({
      currentStreak: 2,
      bestStreak: 3,
    });

    // Fractional flyerCountMultiplier rounds cleanly to an integer >= 1
    const smallFlyerMod = resolveRunModifiers({ flyerCountMultiplier: 1.2 });
    expect(smallFlyerMod.flyerCountMultiplier).toBe(1);
    expect(hasActiveRunModifiers(smallFlyerMod)).toBe(false);
    expect(describeActiveModifiers(smallFlyerMod)).toEqual([]);

    const roundedFlyerMod = resolveRunModifiers({ flyerCountMultiplier: 2.4 });
    expect(roundedFlyerMod.flyerCountMultiplier).toBe(2);
    expect(describeActiveModifiers(roundedFlyerMod)[0]?.label).toBe('2x Flyers');

    // Non-array runtime forbiddenTowerTypes/activeMutatorIds & null selection safely normalize, and near-1 floats don't emit +0% badges
    const nonArrayMod = resolveRunModifiers({
      forbiddenTowerTypes: 'frost' as unknown as readonly ('frost')[],
      activeMutatorIds: 'swift_march' as unknown as readonly string[],
      enemySpeedMultiplier: 1.001,
    });
    expect(nonArrayMod.forbiddenTowerTypes).toEqual([]);
    expect(nonArrayMod.activeMutatorIds).toEqual([]);
    expect(describeActiveModifiers(nonArrayMod)).toEqual([]);
    expect(resolveMutatorSelection(null as unknown as string[])).toEqual(resolveRunModifiers(null));

    // debugForceLose during Endless Mode marks gameLost event with endless: true
    const loseEv = new EventBus();
    const miniLvl: LevelDef = {
      ...LEVELS[0],
      startingGold: 1000,
      waves: [{ clearBonus: 20, groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.3, startDelay: 0 }] }],
    };
    const loseWorld = new SimWorld(miniLvl, loseEv);
    loseWorld.placeTower(4, 2, 'archer');
    loseWorld.startNextWave();
    for (let i = 0; i < 60 * 30 && loseWorld.outcome === 'ongoing'; i++) {
      loseWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(loseWorld.outcome).toBe('won');
    expect(loseWorld.enterEndlessMode()).toBe(true);
    let lostPayload: { waveIndex: number; endless?: boolean } | null = null;
    loseEv.on('gameLost', (ev) => {
      lostPayload = ev;
    });
    loseWorld.debugForceLose();
    expect(lostPayload).toEqual({ waveIndex: 0, endless: true });
    expect(loseWorld.debugTainted).toBe(true);

    // Future Master islands without bosses still preserve an armor-breaker tower in Daily Watch
    const bosslessMaster: LevelDef = {
      ...LEVELS[1],
      id: 'bossless-master-isle',
      difficulty: 'Master',
      waves: [
        {
          clearBonus: 30,
          groups: [{ enemyType: 'grunt', count: 5, spawnInterval: 0.5, startDelay: 0 }],
        },
      ],
    };
    for (let i = 1; i <= 30; i++) {
      const ds = `2026-10-${String(i).padStart(2, '0')}`;
      const spec = generateDailyChallenge(ds, [bosslessMaster]);
      const legal = getAllowedTowerTypes(spec.modifiers);
      expect(legal.some((t) => TOWER_DEFS[t].tiers[0].damage >= 35)).toBe(true);
    }

    // Hybrid mutators (catalog ID + extra custom scalar) surface custom scalar badges without duplicating catalog mutators
    const hybridMods = mergeRunModifiers(
      resolveMutatorSelection(['swift_march']),
      { enemyHpMultiplier: 1.5, enemyArmorBonus: 2 },
    );
    const hybridBadges = describeActiveModifiers(hybridMods);
    expect(hybridBadges.map((b) => b.id)).toEqual([
      'swift_march',
      'custom-enemy-hp',
      'custom-enemy-armor',
    ]);
    expect(hybridBadges[1].label).toBe('Enemy HP +50%');

    // Non-string/non-array runtime inputs fail safely without TypeError
    expect(isValidDateString(null as unknown as string)).toBe(false);
    expect(() => generateDailyChallenge(null as unknown as string)).toThrow(RangeError);
    expect(() => generateDailyChallenge('2026-11-17', null as unknown as readonly LevelDef[])).toThrow(Error);
    expect(computeDailyStreaks(null as unknown as readonly string[], '2026-11-17')).toEqual({
      currentStreak: 0,
      bestStreak: 0,
    });
    expect(buildEndlessMutatorLoadout(null as unknown as readonly string[]).mutators).toEqual([]);
    expect(getConflictingMutatorIds(null as unknown as readonly string[])).toEqual([]);

    // Mixed allowedTowerTypes + forbiddenTowerTypes filters banned towers out of Limited Arsenal badge,
    // and unresolved fractional flyerCountMultiplier < 1.5 never emits a '1x Flyers' badge
    const overlapMods = mergeRunModifiers(
      { allowedTowerTypes: ['archer', 'frost', 'cannon'] },
      { activeMutatorIds: ['no_frost'], forbiddenTowerTypes: ['frost'] },
    );
    const overlapArsenal = describeActiveModifiers(overlapMods).find((b) => b.id === 'allowed-arsenal');
    expect(overlapArsenal?.detail).toBe('Only Archer Tower, Cannon Bastion can be built.');

    const blockedAllMods = mergeRunModifiers(
      { allowedTowerTypes: ['frost'] },
      { activeMutatorIds: ['no_frost'], forbiddenTowerTypes: ['frost'] },
    );
    expect(
      describeActiveModifiers(blockedAllMods).find((b) => b.id === 'allowed-arsenal')?.label,
    ).toBe('No Towers Allowed');

    expect(
      describeActiveModifiers({
        ...resolveRunModifiers(null),
        flyerCountMultiplier: 1.4,
      }),
    ).toEqual([]);

    // getRecentDailySpecs clamps cleanly at 0000-01-01 without generating negative-year RangeError
    expect(getRecentDailySpecs('0000-01-01', 7, LEVELS).map((s) => s.date)).toEqual(['0000-01-01']);
    expect(getRecentDailySpecs('0000-01-03', 7, LEVELS).map((s) => s.date)).toEqual([
      '0000-01-01',
      '0000-01-02',
      '0000-01-03',
    ]);

    // Non-array catalog/preset inputs to mutator/modifier helpers fail safely
    const badCatalog = null as unknown as typeof ENDLESS_MUTATORS;
    const badPresets = null as unknown as typeof ENDLESS_MUTATOR_PRESETS;
    expect(selectEndlessMutators('safe', 2, badCatalog).mutators).toEqual([]);
    expect(buildEndlessMutatorLoadout(['swift_march'], badCatalog).mutators).toEqual([]);
    expect(getMutatorPresetRoll('iron-skies', badPresets, badCatalog)).toBeNull();
    expect(getConflictingMutatorIds(['swift_march'], badCatalog)).toEqual([]);
    expect(
      describeActiveModifiers(
        resolveRunModifiers({ activeMutatorIds: ['swift_march'] }),
        badCatalog,
      )[0]?.id,
    ).toBe('swift_march');

    // Catalogs containing null/malformed entries, NaN/negative scoreMultiplierBonus, and non-string modifier arrays stay consistent
    const sparseCatalog = [
      null,
      {
        id: 'nan_bonus',
        name: 'NaN Bonus',
        description: 'Custom test mutator.',
        scoreMultiplierBonus: Number.NaN,
        modifiers: { enemyArmorBonus: 1, scoreMultiplier: 1.5 },
      },
      {
        id: 'neg_bonus',
        name: 'Negative Bonus',
        description: 'Custom negative bonus mutator.',
        scoreMultiplierBonus: -0.8,
        modifiers: { enemyHpMultiplier: 1.1 },
      },
    ] as unknown as typeof ENDLESS_MUTATORS;
    const sparseRoll = selectEndlessMutators('sparse', 2, sparseCatalog);
    expect(sparseRoll.scoreMultiplier).toBe(sparseRoll.modifiers.scoreMultiplier);
    expect(sparseRoll.scoreMultiplier).toBe(1);
    expect(buildEndlessMutatorLoadout(['nan_bonus', 123 as unknown as string], sparseCatalog).mutators).toHaveLength(1);
    expect(getConflictingMutatorIds(['nan_bonus'], sparseCatalog)).toEqual([]);
    expect(describeActiveModifiers(sparseRoll.modifiers, sparseCatalog).length).toBeGreaterThanOrEqual(1);

    const messyArraysMod = resolveRunModifiers({
      allowedTowerTypes: ['archer', 42 as unknown as 'archer', ''] as unknown as typeof TOWER_TYPES,
      forbiddenTowerTypes: [null as unknown as 'frost', 'frost'],
      activeMutatorIds: [undefined as unknown as string, 'swift_march'],
    });
    expect(messyArraysMod.allowedTowerTypes).toEqual(['archer']);
    expect(messyArraysMod.forbiddenTowerTypes).toEqual(['frost']);
    expect(messyArraysMod.activeMutatorIds).toEqual(['swift_march']);

    // Sparse level list & sparse mutator catalog on Master level in generateDailyChallenge,
    // missing waves in applyModifiersToLevel, and NaN unresolved scalar badges in describeActiveModifiers stay safe
    const noWavesLevel = { ...LEVELS[0], waves: null } as unknown as LevelDef;
    expect(applyModifiersToLevel(noWavesLevel, { flyerCountMultiplier: 2 })).toBe(noWavesLevel);
    const sparseDaily = generateDailyChallenge('2026-11-17', [null as unknown as LevelDef, LEVELS[0]]);
    expect(sparseDaily.levelId).toBe(LEVELS[0].id);

    const masterSparseDaily = generateDailyChallenge(
      '2026-11-17',
      [bosslessMaster],
      sparseCatalog,
    );
    expect(masterSparseDaily.levelId).toBe('bossless-master-isle');

    const namelessLevel = { ...LEVELS[0], name: undefined as unknown as string };
    expect(generateDailyChallenge('2026-11-17', [namelessLevel]).title).toBe(`Daily Watch · ${LEVELS[0].id}`);

    expect(
      describeActiveModifiers({
        ...resolveRunModifiers(null),
        enemyHpMultiplier: Number.NaN,
        enemySpeedMultiplier: Number.POSITIVE_INFINITY,
        enemyArmorBonus: Number.NaN,
        flyerCountMultiplier: Number.NaN,
        goldRewardMultiplier: -1,
      }),
    ).toEqual([]);

    // Partial custom mutator catalog entry without `modifiers`, malformed wave groups in applyModifiersToLevel,
    // and NaN wave group counts in generateDailyChallenge stay safe
    const partialMutatorCatalog = [
      { id: 'story_flavor', name: 'Story Flavor', description: 'Cosmetic.', scoreMultiplierBonus: 0 },
    ] as unknown as typeof ENDLESS_MUTATORS;
    expect(
      describeActiveModifiers(
        resolveRunModifiers({ activeMutatorIds: ['story_flavor'] }),
        partialMutatorCatalog,
      ),
    ).toEqual([{ id: 'story_flavor', label: 'Story Flavor', detail: 'Cosmetic.' }]);

    const badWaveGroupsLvl = {
      ...LEVELS[0],
      waves: [{ clearBonus: 10, groups: null }],
    } as unknown as LevelDef;
    expect(applyModifiersToLevel(badWaveGroupsLvl, { flyerCountMultiplier: 2 }).waves[0].groups).toEqual([]);

    const nanBruteMaster = {
      ...bosslessMaster,
      waves: [
        {
          clearBonus: 30,
          groups: [{ enemyType: 'brute', count: Number.NaN, spawnInterval: 0.5, startDelay: 0 }],
        },
      ],
    } as LevelDef;
    expect(generateDailyChallenge('2026-11-17', [nanBruteMaster]).levelId).toBe(nanBruteMaster.id);
  });
});
