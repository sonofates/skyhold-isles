/**
 * Run recording + deterministic replay (owner, 2026-11-18: "there's no replay in the game").
 *
 * The sim is deterministic (fixed 60 Hz ticks, seeded hero RNG, no Math.random), so a run is fully
 * described by its starting setup (island, run modifiers, hero config — all owned by the Game2D
 * hooks, unchanged between a run and its replay) plus every player command with the sim tick it was
 * given on. Commands are recorded at the Game2D command layer (no sim hook needed): live input
 * reaches the world between frames, i.e. after `t` fixed ticks have run and before tick `t + 1`; the
 * replay applies the same command at the same point (`ReplayCursor.applyDue` before tick `t + 1`).
 *
 * Pure: no DOM / Pixi, unit-tested against SimWorld in tests/render/replay2d.test.ts.
 */
import type { HeroSkillSlot, TargetingMode, TowerType } from '../../core/types.ts';
import type { SimWorld } from '../../sim/world.ts';
import { castMeteor2D, castOvercharge2D } from './abilities2d.ts';

/** One player command, as the UI gives it to the sim. */
export type RunCommand =
  | { readonly k: 'build'; readonly plot: number; readonly type: TowerType }
  | { readonly k: 'upgrade'; readonly id: number }
  | { readonly k: 'sell'; readonly id: number }
  | { readonly k: 'target'; readonly id: number; readonly mode: TargetingMode }
  | { readonly k: 'rally'; readonly id: number; readonly x: number; readonly z: number }
  | { readonly k: 'wave' }
  | { readonly k: 'heroMove'; readonly x: number; readonly z: number }
  /** `x` / `z` null = cast without a point (self skills). */
  | { readonly k: 'heroSkill'; readonly slot: HeroSkillSlot; readonly x: number | null; readonly z: number | null }
  | { readonly k: 'meteor'; readonly x: number; readonly z: number }
  | { readonly k: 'overcharge' }
  /** Game speed (render-side only; kept for the record, the replay viewer picks its own speed). */
  | { readonly k: 'speed'; readonly s: number };

export interface RecordedCommand {
  /** Fixed sim ticks completed when the command was given. */
  readonly t: number;
  readonly c: RunCommand;
}

/** What the run ended with — the replay checks it reproduced the same result. */
export interface RunFingerprint {
  readonly outcome: 'won' | 'lost' | 'ongoing';
  readonly tick: number;
  readonly gold: number;
  readonly lives: number;
  readonly wave: number;
  readonly kills: number;
  readonly towers: number;
}

export interface RunReplay {
  readonly levelId: string;
  readonly commands: readonly RecordedCommand[];
  /** Tick the run ended on (the replay's length). */
  readonly endTick: number;
  readonly end: RunFingerprint;
}

/** Applies a command to the world. Same code path for live play and the replay. */
export function applyRunCommand(world: SimWorld, c: RunCommand): boolean {
  switch (c.k) {
    case 'build':
      return world.placeTowerOnPlot(c.plot, c.type) !== null;
    case 'upgrade':
      return world.upgradeTower(c.id);
    case 'sell':
      return world.sellTower(c.id) > 0;
    case 'target': {
      if (!world.getTowerById(c.id)) return false;
      world.setTowerTargeting(c.id, c.mode);
      return true;
    }
    case 'rally':
      return world.setRallyPoint(c.id, c.x, c.z);
    case 'wave':
      return world.startNextWave();
    case 'heroMove':
      return world.commandHeroMove(c.x, c.z);
    case 'heroSkill':
      return world.castHeroSkill(c.slot, c.x ?? NaN, c.z ?? NaN);
    case 'meteor':
      return castMeteor2D(world, c.x, c.z);
    case 'overcharge':
      return castOvercharge2D(world);
    case 'speed':
      return true;
  }
}

/** True for commands that change the sim (the rest are only kept for the record). */
export function isSimCommand(c: RunCommand): boolean {
  return c.k !== 'speed';
}

export function runFingerprint(world: SimWorld, tick: number): RunFingerprint {
  return {
    outcome: world.outcome,
    tick,
    gold: world.gold,
    lives: world.lives,
    wave: world.waveSystem.currentWaveOneBased,
    kills: world.enemiesKilledTotal,
    towers: world.towers.length,
  };
}

export function sameFingerprint(a: RunFingerprint, b: RunFingerprint): boolean {
  return a.outcome === b.outcome && a.tick === b.tick && a.gold === b.gold && a.lives === b.lives && a.wave === b.wave && a.kills === b.kills && a.towers === b.towers;
}

/** Collects the commands of the run being played. */
export class RunRecorder {
  private commands: RecordedCommand[] = [];

  constructor(readonly levelId: string) {}

  push(tick: number, c: RunCommand): void {
    this.commands.push({ t: tick, c });
  }

  get count(): number {
    return this.commands.length;
  }

  finish(world: SimWorld, tick: number): RunReplay {
    return { levelId: this.levelId, commands: this.commands.slice(), endTick: tick, end: runFingerprint(world, tick) };
  }
}

/** Feeds a recorded run back into a fresh world, tick by tick. */
export class ReplayCursor {
  private next = 0;

  constructor(readonly replay: RunReplay) {}

  /** Applies every command given after `tick` ticks (call before running tick `tick + 1`). */
  applyDue(world: SimWorld, tick: number): number {
    const cmds = this.replay.commands;
    let n = 0;
    while (this.next < cmds.length && cmds[this.next].t <= tick) {
      const rc = cmds[this.next++];
      if (isSimCommand(rc.c)) applyRunCommand(world, rc.c);
      n++;
    }
    return n;
  }

  /** 0..1 through the run (by tick). */
  progress(tick: number): number {
    return this.replay.endTick > 0 ? Math.max(0, Math.min(1, tick / this.replay.endTick)) : 1;
  }

  get applied(): number {
    return this.next;
  }
}
