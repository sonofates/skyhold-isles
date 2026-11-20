import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { getLevelById, LEVEL_L1C } from '../../src/data/levels2d/index.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { NEUTRAL_RUN_MODIFIERS } from '../../src/data/runModifiers.ts';
import { SimWorld } from '../../src/sim/world.ts';
import {
  applyRunCommand,
  ReplayCursor,
  RunRecorder,
  runFingerprint,
  sameFingerprint,
  type RunCommand,
  type RunReplay,
} from '../../src/render2d/ui/replay2d.ts';

function newWorld(level: LevelDef, hero: string | null): SimWorld {
  return new SimWorld(level, new EventBus(), NEUTRAL_RUN_MODIFIERS, hero ? { heroId: hero, heroLevel: 6, seed: 1234 } : undefined);
}

/** A scripted "player": decides commands from the live world state at fixed tick marks. */
function decide(world: SimWorld, tick: number): RunCommand[] {
  const out: RunCommand[] = [];
  const plots = world.level.layout2d!.plots.length;
  if (tick === 0) {
    out.push({ k: 'build', plot: 0, type: 'archer' }, { k: 'build', plot: 1, type: 'cannon' }, { k: 'speed', s: 2 });
  }
  if (tick % 300 === 30 && world.waveSystem.canStartNextWave()) out.push({ k: 'wave' });
  if (tick % 420 === 100) {
    const free = Array.from({ length: plots }, (_, i) => i).find((i) => world.grid.getTowerIdAt(i, 0) === -1);
    if (free !== undefined) out.push({ k: 'build', plot: free, type: tick % 840 === 100 ? 'barracks' : 'archer' });
  }
  if (tick % 500 === 250 && world.towers.length > 0) out.push({ k: 'upgrade', id: world.towers[tick % world.towers.length].id });
  if (tick === 900 && world.towers.length > 0) out.push({ k: 'target', id: world.towers[0].id, mode: 'strongest' });
  if (tick === 1500 && world.towers.length > 2) out.push({ k: 'sell', id: world.towers[world.towers.length - 1].id });
  if (tick % 360 === 200 && world.hero) {
    const lane = world.level.layout2d!.paths[0];
    const p = lane[Math.floor((tick / 360) % lane.length)];
    out.push({ k: 'heroMove', x: p.x, z: p.z });
  }
  if (tick % 700 === 650 && world.hero) out.push({ k: 'heroSkill', slot: 0, x: world.hero.x, z: world.hero.z }, { k: 'heroSkill', slot: 1, x: null, z: null });
  if (tick === 1300) out.push({ k: 'meteor', x: world.level.layout2d!.paths[0][2].x, z: world.level.layout2d!.paths[0][2].z }, { k: 'overcharge' });
  return out;
}

function liveRun(level: LevelDef, hero: string | null, maxTicks: number): { replay: RunReplay; state: string } {
  const world = newWorld(level, hero);
  world.gold += 600;
  const rec = new RunRecorder(level.id);
  let tick = 0;
  for (; tick < maxTicks && world.outcome === 'ongoing'; tick++) {
    for (const c of decide(world, tick)) {
      rec.push(tick, c);
      applyRunCommand(world, c);
    }
    world.fixedTick(BALANCE.fixedDt);
  }
  return { replay: rec.finish(world, tick), state: snapshot(world) };
}

function replayRun(level: LevelDef, hero: string | null, replay: RunReplay): { world: SimWorld; state: string } {
  const world = newWorld(level, hero);
  world.gold += 600;
  const cursor = new ReplayCursor(replay);
  let tick = 0;
  for (; tick < replay.endTick && world.outcome === 'ongoing'; tick++) {
    cursor.applyDue(world, tick);
    world.fixedTick(BALANCE.fixedDt);
  }
  expect(cursor.applied).toBe(replay.commands.length);
  expect(sameFingerprint(runFingerprint(world, tick), replay.end)).toBe(true);
  return { world, state: snapshot(world) };
}

function snapshot(w: SimWorld): string {
  return JSON.stringify({
    gold: w.gold,
    lives: w.lives,
    wave: w.waveSystem.currentWaveOneBased,
    kills: w.enemiesKilledTotal,
    towers: w.towers.map((t) => [t.id, t.type, t.tier, t.targetingMode, t.kills, Math.round(t.totalDamageDealt * 1000)]),
    hero: w.hero ? [Math.round(w.hero.x * 1000), Math.round(w.hero.z * 1000), Math.round(w.hero.hp), w.hero.state] : null,
  });
}

describe('run replay (replay2d.ts)', () => {
  it('records every command with its tick and replays to the identical world (l1c, with a hero)', () => {
    const live = liveRun(LEVEL_L1C, 'bran', 60 * 60);
    const kinds = new Set(live.replay.commands.map((c) => c.c.k));
    for (const k of ['build', 'wave', 'upgrade', 'target', 'heroMove', 'heroSkill', 'meteor', 'overcharge', 'speed']) expect(kinds.has(k as RunCommand['k'])).toBe(true);
    const again = replayRun(LEVEL_L1C, 'bran', live.replay);
    expect(again.state).toBe(live.state);
  });

  it('replays to the identical world on a two-lane island without a hero, twice', () => {
    const level = getLevelById('i05') ?? LEVEL_L1C;
    const live = liveRun(level, null, 60 * 50);
    expect(replayRun(level, null, live.replay).state).toBe(live.state);
    expect(replayRun(level, null, live.replay).state).toBe(live.state);
  });

  it('a replay with a dropped command diverges (the fingerprint catches it)', () => {
    const live = liveRun(LEVEL_L1C, 'wren', 60 * 40);
    const cut: RunReplay = { ...live.replay, commands: live.replay.commands.filter((c) => c.c.k !== 'build') };
    const world = newWorld(LEVEL_L1C, 'wren');
    world.gold += 600;
    const cursor = new ReplayCursor(cut);
    let tick = 0;
    for (; tick < cut.endTick; tick++) {
      cursor.applyDue(world, tick);
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(sameFingerprint(runFingerprint(world, tick), cut.end)).toBe(false);
  });

  it('specialization and ability purchases go through the command layer and replay identically', () => {
    const run = (cmds: (w: SimWorld, tick: number) => RunCommand[], ticks: number, replay?: RunReplay) => {
      const world = newWorld(LEVEL_L1C, null);
      world.gold += 2000;
      const rec = new RunRecorder('l1c');
      const cursor = replay ? new ReplayCursor(replay) : null;
      let tick = 0;
      for (; tick < ticks; tick++) {
        if (cursor) cursor.applyDue(world, tick);
        else
          for (const c of cmds(world, tick)) {
            rec.push(tick, c);
            expect(applyRunCommand(world, c), `${c.k} @${tick}`).toBe(true);
          }
        world.fixedTick(BALANCE.fixedDt);
      }
      return { world, replay: rec.finish(world, tick) };
    };
    const script = (w: SimWorld, tick: number): RunCommand[] => {
      const id = w.towers[0]?.id ?? -1;
      if (tick === 0) return [{ k: 'build', plot: 0, type: 'archer' }];
      if (tick === 5 || tick === 10) return [{ k: 'upgrade', id }];
      if (tick === 20) return [{ k: 'spec', id, spec: 'swallow' }];
      if (tick === 30) return [{ k: 'wave' }];
      if (tick === 300) return [{ k: 'ability', id, ability: 'flock' }];
      return [];
    };
    const live = run(script, 900);
    const t = live.world.towers[0];
    expect(t.specialization?.id).toBe('swallow');
    expect(t.specialization?.abilities).toEqual(['flock']);
    // Rejected: a second branch, an ability twice, an ability from the other branch.
    expect(applyRunCommand(live.world, { k: 'spec', id: t.id, spec: 'farwatch' })).toBe(false);
    expect(applyRunCommand(live.world, { k: 'ability', id: t.id, ability: 'flock' })).toBe(false);
    expect(applyRunCommand(live.world, { k: 'ability', id: t.id, ability: 'throughshot' })).toBe(false);
    const again = run(() => [], 900, live.replay);
    expect(again.world.towers[0].specialization).toEqual(t.specialization);
    expect(snapshot(again.world)).toBe(snapshot(live.world));
  });

  it('progress runs 0..1 over the recorded length', () => {
    const r: RunReplay = { levelId: 'l1c', commands: [], endTick: 200, end: { outcome: 'won', tick: 200, gold: 0, lives: 0, wave: 0, kills: 0, towers: 0 } };
    const c = new ReplayCursor(r);
    expect(c.progress(0)).toBe(0);
    expect(c.progress(100)).toBe(0.5);
    expect(c.progress(400)).toBe(1);
  });
});
