import type { EnemyType, TowerType } from '../core/types.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../data/enemies.ts';
import type { EnemyEntity } from '../sim/entities.ts';
import type { SimWorld } from '../sim/world.ts';
import type { Game2D, Game2DHooks } from './game2d.ts';
import { enemyArtFor } from './manifest.ts';

/**
 * QA / recording scenes on the real SimWorld (no fakes, so the event wiring is exercised):
 *   ?zoo=1               all 15 enemy types (+ elites) walking L1c, specials triggered periodically
 *   ?towers=1[&tier=N]   every tower type built and firing at a stream of tough enemies; without
 *                        `tier` the whole set cycles T1 → T2 → T3 every 9 s
 * Both keep lives/gold topped up and never end.
 */

/** Plots near the lanes, one per tower type, around the Beacon (10) so it buffs a neighbour. */
export const DEMO_PLOTS: ReadonlyArray<readonly [number, TowerType]> = [
  [10, 'beacon'],
  [9, 'archer'],
  [12, 'cannon'],
  [16, 'mortar'],
  [11, 'frost'],
  [6, 'tesla'],
  [18, 'ballista'],
  [20, 'barracks'],
];

interface ZooSlot {
  readonly type: EnemyType;
  readonly elite: boolean;
  readonly lane: number;
  uid: number;
  born: number;
  nextSpawn: number;
  /** Forced specials already fired for this life. */
  fired: number;
}

const ZOO_HP = 9;
const TICKS_PER_SEC = 60;

/** `?zoo=1`: every type walking, specials forced on a timetable (seconds since spawn). */
export function zooHooks(): Game2DHooks {
  const slots: ZooSlot[] = [];
  ENEMY_TYPES.forEach((type, i) => slots.push({ type, elite: false, lane: i % 2, uid: -1, born: 0, nextSpawn: i * 58, fired: 0 }));
  for (const [i, type] of (['grunt', 'brute', 'healer'] as const).entries()) {
    slots.push({ type, elite: true, lane: (i + 1) % 2, uid: -1, born: 0, nextSpawn: 900 + i * 58, fired: 0 });
  }
  const byUid = new Map<number, ZooSlot>();
  const alive = new Set<number>();
  let setup = false;
  let tick = 0;
  return {
    endless: true,
    beforeTick(world: SimWorld): void {
      tick++;
      world.lives = 999;
      world.gold = 9999;
      if (!setup) {
        setup = true;
        for (const [plot, type] of DEMO_PLOTS) world.placeTowerOnPlot(plot, type);
      }
      const pool = world.enemyPool;
      alive.clear();
      for (let i = 0; i < pool.getActiveCount(); i++) {
        const e: EnemyEntity = pool.items[pool.getActiveIndex(i)];
        alive.add(e.uid);
        const slot = byUid.get(e.uid);
        if (slot) force(world, e, slot, (tick - slot.born) / TICKS_PER_SEC);
      }
      for (const slot of slots) {
        if (slot.uid >= 0 && alive.has(slot.uid)) continue;
        if (slot.uid >= 0) byUid.delete(slot.uid);
        slot.uid = -1;
        if (tick < slot.nextSpawn) continue;
        const e = world.enemySystem.spawnEnemy(slot.type, ZOO_HP, slot.elite, slot.lane);
        if (!e) continue;
        slot.uid = e.uid;
        slot.born = tick;
        slot.fired = 0;
        slot.nextSpawn = tick + 150;
        byUid.set(e.uid, slot);
      }
    },
  };
}

/** One forced special per (type, age) so a screenshot catches each effect without waiting for luck. */
function force(world: SimWorld, e: EnemyEntity, slot: ZooSlot, age: number): void {
  const sys = world.enemySystem;
  const step = (n: number, at: number): boolean => {
    if (slot.fired >= n || age < at) return false;
    slot.fired = n;
    return true;
  };
  switch (slot.type) {
    case 'tempest':
      if (step(1, 7)) e.hp = Math.min(e.hp, e.maxHp * 0.64);
      else if (step(2, 15)) e.hp = Math.min(e.hp, e.maxHp * 0.31);
      break;
    case 'boss':
      if (step(1, 8)) e.hp = Math.min(e.hp, e.maxHp * 0.48);
      break;
    case 'carrier':
      if (step(1, 9)) e.hp = Math.min(e.hp, 2);
      break;
    case 'splitter':
      if (step(1, 10)) e.hp = Math.min(e.hp, 2);
      break;
    case 'golem':
    case 'brute':
    case 'runner':
    case 'mite':
      // Chill it: frost tint, and the golem's shell cracks.
      if (step(1, 3) || step(2, 9)) sys.applySlow(e, 0.4, 3);
      break;
    default:
      break;
  }
}

/** `?towers=1`: all demo towers at a tier, firing at a steady stream of tough enemies. */
export function towersHooks(fixedTier: number | null): Game2DHooks {
  let setup = false;
  let tick = 0;
  let k = 0;
  const ids: number[] = [];
  const TYPES: readonly EnemyType[] = ['grunt', 'brute', 'flyer', 'runner', 'grunt', 'flyer'];
  const setTier = (world: SimWorld, tier: number): void => {
    for (const id of ids) {
      const t = world.getTowerById(id);
      while (t && t.tier < tier) if (!world.upgradeTower(id)) break;
    }
  };
  return {
    endless: true,
    beforeTick(world: SimWorld): void {
      tick++;
      world.lives = 999;
      world.gold = 9999;
      if (!setup) {
        setup = true;
        for (const [plot, type] of DEMO_PLOTS) {
          const t = world.placeTowerOnPlot(plot, type);
          if (t) ids.push(t.id);
        }
      }
      const sec = tick / TICKS_PER_SEC;
      if (fixedTier) {
        if (tick === 3) setTier(world, fixedTier);
      } else {
        // 0-9 s T1, 9-18 s T2, 18-36 s T3, then sell everything and start over at T1.
        const phase = Math.floor(sec / 9) % 4;
        if (tick % (9 * TICKS_PER_SEC) === 0 && tick > 0) {
          if (phase === 0) {
            for (const id of ids) world.sellTower(id);
            ids.length = 0;
            for (const [plot, type] of DEMO_PLOTS) {
              const t = world.placeTowerOnPlot(plot, type);
              if (t) ids.push(t.id);
            }
          } else if (phase < 3) setTier(world, phase + 1);
        }
      }
      const pool = world.enemyPool;
      const lanes = world.enemySystem.groundLaneCount;
      if (pool.getActiveCount() < 14 && tick % 30 === 0) {
        const type = TYPES[k % TYPES.length];
        world.enemySystem.spawnEnemy(type, ZOO_HP * 3, false, k % lanes);
        k++;
      }
    },
  };
}

/** Floating DOM labels over zoo walkers: art key and, while art is pending, the stand-in. */
export class ZooLabels {
  private readonly root = document.createElement('div');
  private readonly nodes: HTMLDivElement[] = [];
  private readonly game: Game2D;

  constructor(game: Game2D) {
    this.game = game;
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden';
    document.body.appendChild(this.root);
  }

  update(): void {
    const g = this.game;
    const pool = g.world.enemyPool;
    const n = pool.getActiveCount();
    for (let i = 0; i < n; i++) {
      const e = pool.items[pool.getActiveIndex(i)];
      let node = this.nodes[i];
      if (!node) {
        node = document.createElement('div');
        node.style.cssText =
          'position:absolute;transform:translate(-50%,0);font:700 10px/1 system-ui,sans-serif;color:#fff4dc;text-shadow:0 1px 0 #3a2412,0 0 3px #3a2412;white-space:nowrap';
        this.root.appendChild(node);
        this.nodes[i] = node;
      }
      const entry = enemyArtFor(g.art.manifest, e.type, ENEMY_DEFS[e.type].flying);
      const art = g.art.enemies[entry.art];
      const text = `${e.elite ? '★ ' : ''}${e.type}${art?.fallbackOf ? ` → ${art.fallbackOf}` : ''}`;
      if (node.textContent !== text) node.textContent = text;
      const ppu = g.map.layout.pxPerUnit;
      const x = g.map.screenX(g.map.pxX(e.x));
      const y = g.map.screenY(g.map.pxY(e.z) + ppu * 0.28);
      node.style.left = `${x.toFixed(1)}px`;
      node.style.top = `${y.toFixed(1)}px`;
      node.style.display = e.burrowed ? 'none' : 'block';
    }
    for (let i = n; i < this.nodes.length; i++) this.nodes[i].style.display = 'none';
  }
}
