import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import type { EnemyEntity, TowerEntity } from '../../src/sim/entities.ts';
import { buildEndlessWaveDef } from '../../src/sim/waveSystem.ts';
import { SimWorld } from '../../src/sim/world.ts';

const DT = BALANCE.fixedDt;
const HEX = ENEMY_DEFS.hexer;
const R = HEX.hexRadius!;

interface Setup {
  world: SimWorld;
  events: EventBus;
  hexer: EnemyEntity;
  /** One tower id per requested distance band (undefined if no buildable tile in that band). */
  placed: (number | undefined)[];
}

/** Parks a hexer a little way down L1's road and places one archer inside each distance band. */
function setup(bands: readonly (readonly [number, number])[]): Setup {
  const events = new EventBus();
  const world = new SimWorld(LEVELS[0], events);
  const hexer = world.enemySystem.spawnEnemy('hexer')!;
  hexer.dist = 8;
  hexer.speed = 0;
  step(world, DT); // resample the position at the new distance (no towers yet)
  world.gold = 99999;
  const placed: (number | undefined)[] = bands.map(() => undefined);
  for (let r = 0; r < world.level.rows; r++) {
    for (let c = 0; c < world.level.cols; c++) {
      if (!world.grid.canPlaceTower(c, r)) continue;
      const d = Math.hypot(world.grid.gridToWorldX(c) - hexer.x, world.grid.gridToWorldZ(r) - hexer.z);
      const b = bands.findIndex(([lo, hi], i) => d >= lo && d <= hi && placed[i] === undefined);
      if (b < 0) continue;
      if (world.placeTower(c, r, 'archer')) placed[b] = world.towers[world.towers.length - 1].id;
    }
  }
  return { world, events, hexer, placed };
}

/** Enemy-system-only stepping: tower stun timers are NOT ticked down (that lives in combat). */
function step(world: SimWorld, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    world.enemySystem.update(DT, () => {}, () => {}, world.towers, 1);
  }
}

function tower(world: SimWorld, id: number | undefined): TowerEntity {
  const t = world.towers.find((x) => x.id === id);
  if (!t) throw new Error(`tower ${id} missing`);
  return t;
}

describe('Gloam Hexer', () => {
  it('stops to channel (telegraph), then hexes the nearest tower in reach on a cadence', () => {
    const { world, events, hexer, placed } = setup([
      [0, R - 0.2],
      [R + 1.2, 99],
    ]);
    const [near, far] = placed;
    const charges: number[] = [];
    const hexes: { towerId: number; duration: number }[] = [];
    events.on('hexCharge', (e) => charges.push(e.towerId));
    events.on('towerHexed', (e) => hexes.push({ towerId: e.towerId, duration: e.duration }));

    step(world, 1.0);
    expect(charges).toEqual([near]);
    expect(hexes).toEqual([]);
    // Channelling: rooted in place even though it can walk.
    hexer.speed = HEX.speed;
    const distAtCharge = hexer.dist;
    step(world, HEX.hexChannelSec! * 0.5);
    expect(hexer.dist).toBe(distAtCharge);
    hexer.speed = 0;
    step(world, HEX.hexChannelSec! * 0.5 + 2 * DT);
    expect(hexes).toEqual([{ towerId: near, duration: HEX.hexStunSec }]);
    expect(tower(world, near).stunTimer).toBeCloseTo(HEX.hexStunSec!, 5);
    expect(tower(world, far).stunTimer).toBe(0);

    // The only tower in reach is still hexed (stuns don't tick here) → no new charge.
    step(world, HEX.hexInterval! + 1);
    expect(charges.length).toBe(1);
    tower(world, near).stunTimer = 0;
    step(world, HEX.hexChannelSec! + 0.5);
    expect(charges).toEqual([near, near]);
    expect(hexes.length).toBe(2);
    expect(tower(world, far).stunTimer).toBe(0);
  });

  it('prefers un-hexed towers and never reaches past its radius', () => {
    const { world, events, placed } = setup([
      [0, 2.3],
      [2.5, R - 0.1],
    ]);
    const [a, b] = placed;
    tower(world, a).stunTimer = 10; // already jammed (e.g. by a boss)
    const hexed: number[] = [];
    events.on('towerHexed', (e) => hexed.push(e.towerId));
    step(world, 1.0 + HEX.hexChannelSec! + 0.1);
    expect(hexed).toEqual([b]);
  });

  it('killing it mid-channel cancels the hex', () => {
    const { world, events, hexer } = setup([[0, R - 0.2]]);
    const hexed: number[] = [];
    events.on('towerHexed', (e) => hexed.push(e.towerId));
    step(world, 1.0);
    expect(hexer.hexTargetId).toBeGreaterThanOrEqual(0);
    world.enemySystem.applyDamage(hexer, 9999, true);
    step(world, HEX.hexChannelSec! + 0.2);
    expect(hexed).toEqual([]);
    expect(world.towers.every((t) => t.stunTimer === 0)).toBe(true);
  });

  it('a target sold mid-channel falls back to another tower in reach', () => {
    const { world, events, placed } = setup([
      [0, 2.3],
      [2.5, R - 0.1],
    ]);
    let charged = -1;
    const hexed: number[] = [];
    events.on('hexCharge', (e) => (charged = e.towerId));
    events.on('towerHexed', (e) => hexed.push(e.towerId));
    step(world, 1.0);
    expect(charged).toBe(placed[0]);
    world.sellTower(charged);
    step(world, HEX.hexChannelSec! + 0.1);
    expect(hexed).toEqual([placed[1]]);
  });

  it('a re-used pool slot starts with no hex lock', () => {
    const { world, hexer } = setup([[0, R - 0.2]]);
    step(world, 1.0);
    expect(hexer.hexTargetId).toBeGreaterThanOrEqual(0);
    world.enemySystem.applyDamage(hexer, 9999, true);
    step(world, DT);
    const fresh = world.enemySystem.spawnEnemy('hexer')!;
    expect(fresh.poolIndex).toBe(hexer.poolIndex);
    expect(fresh.hexTargetId).toBe(-1);
    expect(fresh.channelTimer).toBe(0);
  });

  it('lands through the full world tick and combat ticks the stun down', () => {
    const { world, events, hexer, placed } = setup([[0, R - 0.2]]);
    let hexed = false;
    events.on('towerHexed', () => (hexed = true));
    hexer.maxHp = hexer.hp = 1e6; // the archer must not kill it before the hex lands
    for (let i = 0; i < Math.round(3 / DT) && !hexed; i++) world.fixedTick(DT);
    expect(hexed).toBe(true);
    const t = tower(world, placed[0]);
    expect(t.stunTimer).toBeGreaterThan(0);
    // Combat ticks the stun down.
    for (let i = 0; i < Math.round(1 / DT); i++) world.fixedTick(DT);
    expect(t.stunTimer).toBeLessThan(HEX.hexStunSec! - 0.9);
  });

  it('shows up in the endless spotlight rotation', () => {
    const level = LEVELS[0];
    let found = 0;
    for (let k = 0; k < 12; k++) {
      for (const g of buildEndlessWaveDef(level.waves.length + k, level).groups) {
        if (g.enemyType === 'hexer') found++;
      }
    }
    expect(found).toBeGreaterThanOrEqual(2);
  });
});
