import { Graphics } from 'pixi.js';
import type { EnemyType, TowerType } from '../core/types.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../data/enemies.ts';
import { getTowerTierStats, TOWER_DEFS } from '../data/towers.ts';
import type { EnemyEntity } from '../sim/entities.ts';
import type { SimWorld } from '../sim/world.ts';
import type { Game2D, Game2DHooks } from './game2d.ts';
import { enemyArtFor } from './manifest.ts';
import { sectorOf, yawToScreenAngle } from './turret.ts';

/**
 * QA / recording scenes on the real SimWorld (no fakes, so the event wiring is exercised):
 *   ?zoo=1[&types=a,b]   every enemy type (+ elites), or only `types`, walking L1c, specials triggered periodically
 *   ?towers=1[&tier=N]   every tower type built and firing at a stream of tough enemies; without
 *                        `tier` the whole set cycles T1 → T2 → T3 every 9 s
 *   ?towers=aim&type=T[&tier=N]  one directional tower, one immortal target hopping around it by
 *                        compass sector (turret aim QA; AimOverlay marks the sim's aim + muzzle)
 *   ?melee=1[&tier=N][&types=grunt,brute,golem,mite][&plot=N][&die=1][&kill=1]  one barracks
 *                        fighting a rotating mix of melee enemies walked into its rally point
 *                        (melee animation QA; enemies and soldiers are topped up unless kill / die)
 * Both keep lives/gold topped up and never end.
 */

/** Plots near the lanes, one per tower type, around the Beacon (11) so it buffs its neighbours. */
export const DEMO_PLOTS: ReadonlyArray<readonly [number, TowerType]> = [
  [11, 'beacon'],
  [10, 'archer'],
  [9, 'cannon'],
  [13, 'mortar'],
  [12, 'frost'],
  [5, 'tesla'],
  [18, 'ballista'],
  [21, 'barracks'],
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
export function zooHooks(only?: readonly EnemyType[]): Game2DHooks {
  const slots: ZooSlot[] = [];
  (only ?? ENEMY_TYPES).forEach((type, i) => slots.push({ type, elite: false, lane: i % 2, uid: -1, born: 0, nextSpawn: i * 58, fired: 0 }));
  if (!only) {
    for (const [i, type] of (['grunt', 'brute', 'healer'] as const).entries()) {
      slots.push({ type, elite: true, lane: (i + 1) % 2, uid: -1, born: 0, nextSpawn: 900 + i * 58, fired: 0 });
    }
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
    case 'glacier_warden':
      // Both phases: tower freeze + 3 Rime Beetles each.
      if (step(1, 6)) e.hp = Math.min(e.hp, e.maxHp * 0.64);
      else if (step(2, 13)) e.hp = Math.min(e.hp, e.maxHp * 0.31);
      break;
    case 'rimebeetle':
      // Dies mid-road: frost patch decal + snowflakes on the towers it covers.
      if (step(1, 8)) e.hp = Math.min(e.hp, 1);
      break;
    case 'sledguard':
      // Crack the shield to half so the ice bar reads, then let it refreeze.
      if (step(1, 3)) sys.applyDamage(e, Math.round(e.shield * 0.5), true);
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

/** One standing spot for the aim scene's target: a path point at a known screen sector from the tower. */
interface AimSpot {
  readonly flying: boolean;
  readonly lane: number;
  readonly dist: number;
  readonly sector: number;
}

/** QA state of `?towers=aim` (exposed on window.__aim by main2d). */
export interface AimSceneState {
  type: TowerType;
  tier: number;
  plot: number;
  /** Sectors (turret.ts SECTORS index) the scene can put a target in, in visiting order. */
  sectors: number[];
  /** Sector the target stands in now (-1 = none yet) and since when (sim s). */
  current: number;
  since: number;
}

const AIM_HOLD_SEC = 1.6;

/**
 * `?towers=aim&type=cannon[&tier=N][&hold=S]`: ONE directional tower and ONE immortal target that
 * is moved, every `hold` s (default 1.6, sim time), to a path point in the next compass sector around it (real sim targeting, so the
 * turret must follow the sim's target). The tower goes on the plot whose surroundings cover the
 * most sectors. Path points come from the sim's own lanes (ground, plus the flight lane for towers
 * that hit flyers), at 35-90 % of the tower's range. The level's own wave enemies are retired at
 * the goal as they appear, so the tower can only aim at the scene's target.
 */
export function aimHooks(type: TowerType, tier: number, state: AimSceneState, holdSec = AIM_HOLD_SEC): Game2DHooks {
  let setup = false;
  let tick = 0;
  let spots: AimSpot[] = [];
  let order: number[] = [];
  let towerId = -1;
  let dummy: { uid: number; flying: boolean; lane: number } | null = null;
  const spotsFor = (world: SimWorld, x: number, z: number): AimSpot[] => {
    const st = getTowerTierStats(type, Math.max(1, Math.min(3, tier)) as 1 | 2 | 3);
    const best = new Map<number, AimSpot & { err: number }>();
    const lanes: { flying: boolean; lane: number }[] = [];
    for (let l = 0; l < world.enemySystem.groundLaneCount; l++) lanes.push({ flying: false, lane: l });
    if (TOWER_DEFS[type].hitsFlyers) lanes.push({ flying: true, lane: 0 });
    const v = { x: 0, y: 0, z: 0 };
    for (const ln of lanes) {
      const path = world.enemySystem.getPath(ln.flying, ln.lane);
      for (let d = 0.5; d < path.totalLength - 0.5; d += 0.15) {
        path.sample(d, v);
        const r = Math.hypot(v.x - x, v.z - z);
        if (r < st.range * 0.35 || r > st.range * 0.9 || r < st.minRange * 1.2) continue;
        const sector = sectorOf(Math.atan2(v.z - z, v.x - x));
        const err = Math.abs(r - st.range * 0.62) + Math.abs(Math.atan2(v.z - z, v.x - x) - sector * (Math.PI / 4)) * 0.01;
        const prev = best.get(sector);
        if (!prev || err < prev.err) best.set(sector, { ...ln, dist: d, sector, err });
      }
    }
    return [...best.values()].map((s) => ({ flying: s.flying, lane: s.lane, dist: s.dist, sector: s.sector }));
  };
  return {
    endless: true,
    beforeTick(world: SimWorld): void {
      tick++;
      world.lives = 999;
      world.gold = 99999;
      if (!setup) {
        setup = true;
        // Pick the plot with the widest sector coverage.
        let bestPlot = -1;
        let bestSpots: AimSpot[] = [];
        (world.level.layout2d?.plots ?? []).forEach((p, i) => {
          const s = spotsFor(world, p.x, p.z);
          if (s.length > bestSpots.length) {
            bestSpots = s;
            bestPlot = i;
          }
        });
        const t = bestPlot >= 0 ? world.placeTowerOnPlot(bestPlot, type) : null;
        if (!t) return;
        towerId = t.id;
        while (t.tier < tier) if (!world.upgradeTower(t.id)) break;
        spots = bestSpots;
        // Visit clockwise from E so neighbouring frames (and the mirrored ones) all show up.
        order = spots.map((s) => s.sector).sort((a, b) => a - b);
        state.plot = bestPlot;
        state.sectors = order;
      }
      if (towerId < 0 || order.length === 0) return;
      const sec = tick / TICKS_PER_SEC;
      const slot = Math.floor(sec / holdSec) % order.length;
      const spot = spots.find((s) => s.sector === order[slot])!;
      if (state.current !== spot.sector) {
        state.current = spot.sector;
        state.since = sec;
      }
      const pool = world.enemyPool;
      let e: EnemyEntity | null = null;
      for (let i = 0; i < pool.getActiveCount(); i++) {
        const c = pool.items[pool.getActiveIndex(i)];
        if (dummy && c.uid === dummy.uid) e = c;
        // Anything else (the level's own waves) is retired at the goal: one target only.
        else c.dist = c.totalDist;
      }
      if (e && (e.flying !== spot.flying || e.lane !== spot.lane)) {
        // Wrong lane: retire it at the goal (lives are topped up).
        e.dist = e.totalDist;
        e = null;
      }
      if (!e) {
        e = world.enemySystem.spawnEnemy(spot.flying ? 'flyer' : 'brute', 1e6, false, spot.lane);
        if (!e) return;
        dummy = { uid: e.uid, flying: spot.flying, lane: spot.lane };
      }
      // Stand still on the spot (the sim then samples its position from dist), never die.
      e.dist = spot.dist - e.speed / TICKS_PER_SEC;
      e.hp = e.maxHp;
    },
  };
}

/**
 * Aim QA overlay (map px): per aimable turret, a red line along the sim's aim (targetYaw), a line
 * from the drawn muzzle to the sim's target direction, and a yellow ring on the drawn muzzle.
 */
export class AimOverlay {
  private readonly g = new Graphics();
  private readonly game: Game2D;

  constructor(game: Game2D) {
    this.game = game;
    game.map.world.addChild(this.g);
  }

  update(): void {
    const g = this.g;
    g.clear();
    const ppu = this.game.map.layout.pxPerUnit;
    for (const r of this.game.towers.turretReport()) {
      if (!r.aimed) continue;
      const a = yawToScreenAngle(r.targetYaw);
      const len = ppu * 1.6;
      g.moveTo(r.px, r.py).lineTo(r.px + Math.cos(a) * len, r.py + Math.sin(a) * len).stroke({ width: 3, color: 0xff3030, alpha: 0.9 });
      if (r.muzzle) {
        g.circle(r.muzzle.x, r.muzzle.y, 5).stroke({ width: 2, color: 0xffff40 });
        g.moveTo(r.muzzle.x, r.muzzle.y).lineTo(r.muzzle.x + Math.cos(a) * len * 0.6, r.muzzle.y + Math.sin(a) * len * 0.6).stroke({ width: 1.5, color: 0xffff40, alpha: 0.8 });
      }
      // Agreement check for QA: the drawn sector vs the nearest sector to the sim's aim.
      if (sectorOf(a) !== r.sector) g.circle(r.mount.x, r.mount.y - 10, 8).fill({ color: 0xff00ff, alpha: 0.8 });
    }
  }
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

export interface MeleeSceneOptions {
  readonly tier: number;
  readonly types: readonly EnemyType[];
  /** Plot for the barracks (-1 = the demo barracks plot, else the first that takes one). */
  readonly plot: number;
  /** Soldiers may die (death + respawn QA). */
  readonly die: boolean;
  /** Enemies may die (kill FX QA). */
  readonly kill: boolean;
  /** Enemies kept in the fight at once. */
  readonly crowd: number;
}

/** QA state of `?melee=1` (exposed on window.__meleeScene by main2d). */
export interface MeleeSceneState {
  towerId: number;
  rally: { x: number; z: number } | null;
  lane: number;
  spawned: number;
}

/** `?melee=1`: a barracks holding a rotating mix of melee enemies at its rally point. */
export function meleeHooks(opts: MeleeSceneOptions, state: MeleeSceneState): Game2DHooks {
  let setup = false;
  let tick = 0;
  let k = 0;
  let rallyDist = 0;
  let nextSpawn = 0;
  const ours = new Set<number>();
  const v = { x: 0, y: 0, z: 0 };
  return {
    endless: true,
    beforeTick(world: SimWorld): void {
      tick++;
      world.lives = 999;
      world.gold = 99999;
      if (!setup) {
        setup = true;
        const demo = DEMO_PLOTS.find(([, t]) => t === 'barracks')?.[0] ?? 0;
        const plots = world.level.layout2d?.plots ?? [];
        const order = [opts.plot >= 0 ? opts.plot : demo, ...plots.map((_, i) => i)];
        for (const plot of order) {
          const t = world.placeTowerOnPlot(plot, 'barracks');
          if (!t) continue;
          state.towerId = t.id;
          while (t.tier < opts.tier) if (!world.upgradeTower(t.id)) break;
          break;
        }
        const b = world.soldierSystem.getBarracks(state.towerId);
        if (!b) return;
        state.rally = { x: b.rallyX, z: b.rallyZ };
        // Lane and path distance of the rally point.
        let best = Infinity;
        for (let lane = 0; lane < world.enemySystem.groundLaneCount; lane++) {
          const path = world.enemySystem.getPath(false, lane);
          for (let d = 0; d < path.totalLength; d += 0.05) {
            path.sample(d, v);
            const e = Math.hypot(v.x - b.rallyX, v.z - b.rallyZ);
            if (e < best) {
              best = e;
              state.lane = lane;
              rallyDist = d;
            }
          }
        }
        nextSpawn = tick + 30;
      }
      if (!state.rally) return;
      const pool = world.enemyPool;
      let alive = 0;
      for (let i = 0; i < pool.getActiveCount(); i++) {
        const e = pool.items[pool.getActiveIndex(i)];
        if (!ours.has(e.uid)) {
          // The level's own waves are retired at the goal: only the scene's fighters.
          e.dist = e.totalDist;
          continue;
        }
        alive++;
        if (!opts.kill && e.hp < e.maxHp * 0.35) e.hp = e.maxHp;
        // Walked through (blinked / let go): send it back up the road.
        if (e.dist > rallyDist + 2.4) {
          e.dist = Math.max(0, rallyDist - 2.6);
          world.enemySystem.getPath(false, e.lane).sample(e.dist, v);
          e.x = e.prevX = v.x;
          e.z = e.prevZ = v.z;
        }
      }
      if (!opts.die) {
        const b = world.soldierSystem.getBarracks(state.towerId);
        for (const so of b?.squad ?? []) if (so.state !== 'dead' && so.hp < so.maxHp * 0.4) so.hp = so.maxHp;
      }
      if (alive < opts.crowd && tick >= nextSpawn) {
        const type = opts.types[k % opts.types.length];
        k++;
        const e = world.enemySystem.spawnEnemy(type, 1, false, state.lane);
        if (e) {
          ours.add(e.uid);
          state.spawned++;
          e.dist = Math.max(0, rallyDist - 2.2 - (k % 2) * 0.4);
          world.enemySystem.getPath(false, state.lane).sample(e.dist, v);
          e.x = e.prevX = v.x;
          e.z = e.prevZ = v.z;
        }
        nextSpawn = tick + 50;
      }
    },
  };
}
