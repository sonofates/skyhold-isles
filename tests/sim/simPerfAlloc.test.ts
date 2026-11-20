import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { defaultLevel20Skills, HERO_IDS } from '../../src/data/heroes.ts';
import { getLevelById } from '../../src/data/levels2d/index.ts';
import { maxedWorkshopRanks } from '../../src/data/workshop.ts';
import { composeRunModifiers2D } from '../../src/render2d/ui/modes2d.ts';
import { SimWorld } from '../../src/sim/world.ts';

describe('Low-end sim performance & zero per-tick allocation invariants', () => {
  it('WaveSystem.getNextWavePreview caches per-(wave, endless) preview without allocating every HUD frame', () => {
    const i24 = getLevelById('i24')!;
    const world = new SimWorld(i24, new EventBus());
    const ws = world.waveSystem;

    // Repeated 60 Hz calls during preFirstWave return the exact cached reference
    const p1 = ws.getNextWavePreview();
    const p2 = ws.getNextWavePreview();
    expect(p1).not.toBeNull();
    expect(p2).toBe(p1);
    expect(p1!.waveOneBased).toBe(1);

    // Advancing to wave 1 updates cache cleanly to wave 2 and reuses it across repeated calls
    world.startNextWave();
    const w2a = ws.getNextWavePreview();
    const w2b = ws.getNextWavePreview();
    expect(w2a).not.toBeNull();
    expect(w2a!.waveOneBased).toBe(2);
    expect(w2b).toBe(w2a);

    // At the final story wave (wave 14), story mode returns null, while entering endless switches to wave 15
    world.debugSkipToWave(i24.waves.length);
    expect(ws.getNextWavePreview()).toBeNull();
    expect(ws.getNextWavePreview()).toBeNull();

    ws.enterEndlessMode();
    const e15a = ws.getNextWavePreview();
    const e15b = ws.getNextWavePreview();
    expect(e15a).not.toBeNull();
    expect(e15a!.waveOneBased).toBe(15);
    expect(e15b).toBe(e15a);
    world.dispose();
  });

  it('maintains sub-0.5ms per-tick sim cost and bounded scratch/pool state on Hard i16 & i24 boss with heroes + abilities spam', () => {
    const hardMods = composeRunModifiers2D(maxedWorkshopRanks(), [], 'hard');

    for (const [levelId, targetWave, heroId] of [
      ['i16', 16, 'mira'],
      ['i24', 14, 'sela'],
      ['i24', 14, 'tobb'],
    ] as const) {
      const level = getLevelById(levelId)!;
      const bus = new EventBus();
      // Mute listener dispatch to isolate pure sim tick execution & verify zero listener churn
      bus.muted = true;
      const world = new SimWorld(level, bus, {
        modifiers: hardMods,
        heroId,
        heroLevel: 20,
        heroSkills: defaultLevel20Skills(heroId),
        seed: 777,
      });

      world.gold = 999_999;
      world.lives = 999;
      const types = ['barracks', 'tesla', 'mortar', 'archer', 'cannon', 'frost', 'ballista'] as const;
      for (let p = 0; p < world.grid.plotCount; p++) {
        const t = world.placeTowerOnPlot(p, types[p % types.length]);
        if (t) {
          world.upgradeTower(t.id);
          world.upgradeTower(t.id);
        }
      }

      expect(world.debugSkipToWave(targetWave)).toBe(true);
      const fallbackPost = world.heroSystem.getFallbackRespawnPoint();
      world.commandHeroMove(fallbackPost.x, fallbackPost.z);

      // Warm up 120 ticks so JIT tiers up, hero reaches chokepoint, and pools settle
      for (let t = 0; t < 120; t++) {
        world.fixedTick(BALANCE.fixedDt);
      }

      const enemyPoolCapBefore = world.enemyPool.items.length;
      const projPoolCapBefore = world.projectilePool.items.length;
      const soldierCountBefore = world.soldierSystem.soldiers.length;

      let totalCasts = 0;
      const ticks = 2400; // 40 simulated seconds of peak Hard combat + ability/hero spam
      const t0 = performance.now();
      for (let t = 0; t < ticks; t++) {
        world.lives = 999;
        if (world.enemyPool.getActiveCount() === 0 && world.waveSystem.state !== 'spawning') {
          world.debugSkipToWave(targetWave);
        }
        const activeCount = world.enemyPool.getActiveCount();
        if (activeCount > 0) {
          const lead = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
          if (world.castMeteor(lead.x, lead.z)) totalCasts++;
          if (world.castOvercharge()) totalCasts++;
          if (world.castHeroSkill(0, lead.x, lead.z)) totalCasts++;
          if (world.castHeroSkill(1, lead.x, lead.z)) totalCasts++;
          if (t % 120 === 60) world.commandHeroMove(lead.x, lead.z);
        }
        world.fixedTick(BALANCE.fixedDt);
      }
      const elapsedMs = performance.now() - t0;
      const avgTickMs = elapsedMs / ticks;

      expect(totalCasts).toBeGreaterThanOrEqual(8);
      expect(avgTickMs, `${levelId} ${heroId} avg tick ms`).toBeLessThan(0.5);
      // Fixed-capacity pools and squad arrays never grow past initial allocation
      expect(world.enemyPool.items.length).toBe(enemyPoolCapBefore);
      expect(world.projectilePool.items.length).toBe(projPoolCapBefore);
      expect(world.soldierSystem.soldiers.length).toBe(soldierCountBefore);
      expect(world.heroSystem.gizmos.length).toBeLessThanOrEqual(3);
      world.dispose();
    }

    // Verify all 5 heroes execute non-recording commandMove & castSkill cleanly without closures
    const l1c = getLevelById('l1c')!;
    for (const hid of HERO_IDS) {
      const w = new SimWorld(l1c, new EventBus(), {
        heroId: hid,
        heroLevel: 20,
        heroSkills: defaultLevel20Skills(hid),
      });
      w.startNextWave();
      w.enemySystem.spawnEnemy('brute', 5, false, 0);
      expect(w.commandHeroMove(0, 0)).toBe(true);
      w.fixedTick(BALANCE.fixedDt);
      w.castHeroSkill(0, 0, 0);
      w.castHeroSkill(1, 0, 0);
      w.dispose();
    }
  });

  it('HeroSystem.getRuntimeState caches immutable HUD snapshots across unchanged frames and reuses skill tuples on movement', () => {
    const l1c = getLevelById('l1c')!;
    const bus = new EventBus();
    const world = new SimWorld(l1c, bus, {
      heroId: 'mira',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('mira'),
    });

    // Repeated 60/120 Hz HUD polls while paused / preFirstWave return the exact same object reference (0 allocs)
    const s1 = world.getHeroState()!;
    const s2 = world.getHeroState()!;
    expect(s1).not.toBeNull();
    expect(s2).toBe(s1);

    // Moving the hero produces a distinct immutable snapshot (preserving s1.x/z) while reusing s1.skills when cooldowns are unchanged
    const fallback = world.heroSystem.getFallbackRespawnPoint();
    expect(world.commandHeroMove(fallback.x, fallback.z)).toBe(true);
    world.fixedTick(BALANCE.fixedDt);
    const sMoved = world.getHeroState()!;
    expect(sMoved).not.toBe(s1);
    expect(sMoved.skills).toBe(s1.skills);
    expect(world.getHeroState()).toBe(sMoved);

    // Casting a skill produces a new skills tuple reflecting the active cooldown, and Overcharge with 0 stunned towers reuses empty cleansed list
    world.startNextWave();
    expect(world.castHeroSkill(0, fallback.x, fallback.z)).toBe(true);
    const sCast = world.getHeroState()!;
    expect(sCast).not.toBe(sMoved);
    expect(sCast.skills).not.toBe(sMoved.skills);
    expect(sCast.skills[0].cooldown).toBeGreaterThan(0);

    let cleansedA: readonly number[] | null = null;
    let cleansedB: readonly number[] | null = null;
    bus.on('overchargeActivated', (ev) => {
      if (!cleansedA) cleansedA = ev.cleansedTowerIds;
      else cleansedB = ev.cleansedTowerIds;
    });
    expect(world.castOvercharge()).toBe(true);
    world.abilitySystem.reset();
    expect(world.castOvercharge()).toBe(true);
    expect(cleansedA).toEqual([]);
    expect(cleansedB).toBe(cleansedA);

    world.dispose();
  });
});
