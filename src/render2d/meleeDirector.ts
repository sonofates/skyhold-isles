import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import type { EnemyType } from '../core/types.ts';
import type { EnemyEntity } from '../sim/entities.ts';
import type { SoldierEntity, SoldierSystem } from '../sim/soldierSystem.ts';
import { SOLDIER_RULES } from '../data/soldiers.ts';
import {
  advanceSwing,
  announceSwing,
  cancelSwing,
  createSwing,
  createSwingPose,
  fightGap,
  gangSlots,
  impactSwing,
  knockCurve,
  assignSides,
  smoothK,
  swingPose,
  type SwingClip,
  type SwingPose,
  type SwingState,
} from './meleeAnim.ts';

/**
 * Render-side state of every melee fight (Pixi-free; soldierLayer / enemyLayer read it). Updated
 * once per frame BEFORE the enemy and soldier layers draw, from the sim's soldiers and the
 * `meleeSwing` / `meleeHit` events:
 *  - swing clips per fighter, pre-rolled so the impact frame lands on the sim's blow (meleeAnim.ts);
 *  - facing: a held enemy faces its first soldier, soldiers face their foe;
 *  - spacing: soldiers stand off to the left / right of their foe at a gap that keeps the sprites
 *    apart (gang-ups stack up and down a side), eased in while they walk up — render offsets only,
 *    the enemy itself stays on its sim spot (towers aim there);
 *  - impact feel: hit flash and a short knockback jolt on the struck fighter(s).
 */

export interface MeleeLook {
  /** Drawn height (world units) of an enemy type. */
  enemyHeight(type: EnemyType): number;
  readonly soldierHeight: number;
  /** Swing clip of a soldier (type null) or an enemy type: its attack sheet's, else procedural. */
  clip(kind: 'soldier' | 'enemy', type: EnemyType | null): SwingClip;
  /** Heavy hitters (bigger knockback on soldiers, ground slam). */
  heavy(type: EnemyType): boolean;
}

export interface FighterState {
  readonly swing: SwingState;
  /** Procedural pose of the current swing (refreshed each update). */
  readonly pose: SwingPose;
  /** In melee contact (soldier fighting / enemy held). */
  engaged: boolean;
  /** +1 / −1 while in a fight, 0 = the walk decides. */
  facing: number;
  /** Side of its foe a soldier stands on (+1 right, −1 left, 0 unknown), and that foe's uid. */
  side: number;
  sideFor: number;
  /** Spacing offset this frame wants (before easing), world units. */
  aimX: number;
  aimZ: number;
  /** Eased spacing offset and the final render offset (spacing + knockback), world units. */
  slotX: number;
  slotZ: number;
  offX: number;
  offZ: number;
  knockT: number;
  knockLife: number;
  knockX: number;
  knockZ: number;
  /** Hit flash seconds left. */
  flash: number;
  /** Rendered feet position (interpolated sim position + offset), world units. */
  x: number;
  z: number;
  height: number;
  /** Seconds since (re)spawn — soldiers step out of the barracks door. */
  age: number;
  /** Seconds engaged without swinging (idle bob phase). */
  idle: number;
  type: EnemyType | null;
  seen: number;
}

export const HIT_FLASH = 0.075;
const KNOCK_LIFE = 0.16;
/** Knockback distances (world units). */
const KNOCK_ENEMY = 0.05;
const KNOCK_SOLDIER = 0.09;
const KNOCK_HEAVY = 0.16;
const SLOT_TAU = 0.12;
/** An engaging soldier eases into its spot over this last stretch of its approach (world units). */
const APPROACH = 0.9;

function createFighter(): FighterState {
  return {
    swing: createSwing(),
    pose: createSwingPose(),
    engaged: false,
    facing: 0,
    side: 0,
    sideFor: -1,
    aimX: 0,
    aimZ: 0,
    slotX: 0,
    slotZ: 0,
    offX: 0,
    offZ: 0,
    knockT: 1,
    knockLife: KNOCK_LIFE,
    knockX: 0,
    knockZ: 0,
    flash: 0,
    x: 0,
    z: 0,
    height: 1,
    age: 99,
    idle: 0,
    type: null,
    seen: -1,
  };
}

const MAX_GANG = 12;

export class MeleeDirector {
  private readonly look: MeleeLook;
  private readonly soldierStates = new Map<number, FighterState>();
  private readonly enemyStates = new Map<number, FighterState>();
  private readonly enemyByUid = new Map<number, EnemyEntity>();
  private readonly soldierById = new Map<number, SoldierEntity>();
  private pool: ObjectPool<EnemyEntity> | null = null;
  private frameNo = 0;
  private unsubscribe: (() => void)[] = [];
  // Gang scratch (no per-frame allocation).
  private readonly gang: SoldierEntity[] = [];
  private readonly gangSide: number[] = [];
  private readonly gangPrev: number[] = [];
  private readonly gangDx: number[] = [];
  private readonly gangDz: number[] = [];
  private readonly slotX: number[] = [];
  private readonly slotZ: number[] = [];
  private readonly targets: number[] = [];
  /** QA: swings announced, blows landed, and how far (sheet s) the clip was from its impact frame when the blow came. */
  readonly stats = { swings: 0, hits: 0, synced: 0, late: 0, unplayed: 0, maxErr: 0 };

  constructor(look: MeleeLook) {
    this.look = look;
  }

  soldier(id: number): FighterState | undefined {
    return this.soldierStates.get(id);
  }

  enemy(uid: number): FighterState | undefined {
    return this.enemyStates.get(uid);
  }

  /** Subscribe to a run's events (call once per run, before the layers wire theirs). */
  wire(events: EventBus): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [
      events.on('meleeSwing', (e) => {
        this.stats.swings++;
        if (e.attacker === 'soldier') {
          announceSwing(this.soldierState(e.attackerId).swing, this.look.clip('soldier', null), e.impactIn);
        } else {
          const st = this.enemyState(e.attackerId);
          if (st) announceSwing(st.swing, this.look.clip('enemy', st.type), e.impactIn);
        }
      }),
      events.on('meleeHit', (e) => {
        this.stats.hits++;
        const a = e.attacker === 'soldier' ? this.soldierState(e.attackerId) : this.enemyState(e.attackerId);
        if (a && !e.cleave) {
          const clip = e.attacker === 'soldier' ? this.look.clip('soldier', null) : this.look.clip('enemy', a.type);
          this.recordSync(a.swing);
          impactSwing(a.swing, clip);
        }
        const ax = a ? a.x : e.x;
        const az = a ? a.z : e.z;
        if (e.attacker === 'soldier') {
          const t = this.enemyState(e.targetId);
          if (t) this.strike(t, ax, az, t.type !== null && this.look.heavy(t.type) ? KNOCK_ENEMY * 0.4 : KNOCK_ENEMY);
        } else {
          const heavy = a?.type ? this.look.heavy(a.type) : false;
          const k = heavy || e.sweep ? KNOCK_HEAVY : KNOCK_SOLDIER;
          if (e.sweep) {
            // Every soldier in contact took the blow.
            for (const s of this.soldierById.values()) {
              const tgt = s.targetPoolIndex >= 0 && this.pool ? this.pool.items[s.targetPoolIndex] : null;
              if (s.state === 'fighting' && tgt && tgt.uid === e.attackerId) this.strike(this.soldierState(s.id), ax, az, k);
            }
          }
          const t = this.soldierStates.get(e.targetId);
          if (t && !(e.sweep && t.flash > 0)) this.strike(t, ax, az, k);
        }
      }),
      events.on('soldierSpawned', (e) => {
        const st = this.soldierState(e.soldierId);
        st.age = 0;
        st.slotX = st.slotZ = 0;
        st.side = 0;
        st.sideFor = -1;
        cancelSwing(st.swing);
        st.swing.t = -1;
      }),
      events.on('soldierDied', (e) => {
        const st = this.soldierStates.get(e.soldierId);
        if (st) {
          cancelSwing(st.swing);
          st.swing.t = -1;
          st.engaged = false;
        }
      }),
    ];
  }

  /** New run: forget everything (sim ids start over). */
  reset(): void {
    this.soldierStates.clear();
    this.enemyStates.clear();
    this.enemyByUid.clear();
    this.soldierById.clear();
    this.pool = null;
    for (const k of Object.keys(this.stats) as (keyof typeof this.stats)[]) this.stats[k] = 0;
  }

  private recordSync(s: SwingState): void {
    if (s.t < 0 || s.cancelled) {
      this.stats.unplayed++;
      return;
    }
    const err = s.t - s.clip.lead;
    this.stats.maxErr = Math.max(this.stats.maxErr, Math.abs(err));
    if (Math.abs(err) <= 0.05) this.stats.synced++;
    else this.stats.late++;
  }

  private strike(t: FighterState, fromX: number, fromZ: number, dist: number): void {
    t.flash = HIT_FLASH;
    let dx = t.x - fromX;
    let dz = t.z - fromZ;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) {
      dx = t.facing !== 0 ? -t.facing : 1;
      dz = 0;
    } else {
      dx /= d;
      dz /= d;
    }
    t.knockT = 0;
    t.knockLife = KNOCK_LIFE;
    t.knockX = dx * dist;
    t.knockZ = dz * dist * 0.6;
  }

  private soldierState(id: number): FighterState {
    let st = this.soldierStates.get(id);
    if (!st) {
      st = createFighter();
      st.height = this.look.soldierHeight;
      st.idle = (id * 0.37) % 1;
      const s = this.soldierById.get(id);
      if (s) {
        st.x = s.x;
        st.z = s.z;
      }
      this.soldierStates.set(id, st);
    }
    return st;
  }

  private findEnemy(uid: number): EnemyEntity | null {
    const known = this.enemyByUid.get(uid);
    if (known) return known;
    const pool = this.pool;
    if (!pool) return null;
    for (let i = 0; i < pool.getActiveCount(); i++) {
      const e = pool.items[pool.getActiveIndex(i)];
      if (e.uid === uid) return e;
    }
    return null;
  }

  private enemyState(uid: number): FighterState | null {
    let st = this.enemyStates.get(uid);
    if (!st) {
      const e = this.findEnemy(uid);
      if (!e) return null;
      st = createFighter();
      st.type = e.type;
      st.height = this.look.enemyHeight(e.type);
      st.idle = (uid * 0.61) % 1;
      st.x = e.x;
      st.z = e.z;
      this.enemyStates.set(uid, st);
    }
    return st;
  }

  /** Once per frame, before the layers draw. `dt` = sim seconds this frame (0 while paused). */
  update(system: SoldierSystem, pool: ObjectPool<EnemyEntity>, alpha: number, dt: number): void {
    this.frameNo++;
    this.pool = pool;
    const frame = this.frameNo;
    this.enemyByUid.clear();
    for (let i = 0; i < pool.getActiveCount(); i++) {
      const e = pool.items[pool.getActiveIndex(i)];
      this.enemyByUid.set(e.uid, e);
    }
    this.soldierById.clear();
    for (const s of system.soldiers) this.soldierById.set(s.id, s);

    // Distinct enemies with soldiers on them (engaging or fighting).
    const targets = this.targets;
    targets.length = 0;
    for (const s of system.soldiers) {
      const e = this.targetOf(s, pool);
      if (e && !targets.includes(e.uid)) targets.push(e.uid);
    }

    // Soldiers: reset per-frame intent, then lay out each gang.
    for (const s of system.soldiers) {
      const st = this.soldierState(s.id);
      st.seen = frame;
      st.engaged = s.state === 'fighting';
      st.facing = 0;
      st.aimX = 0;
      st.aimZ = 0;
    }
    for (const uid of targets) {
      const e = this.enemyByUid.get(uid)!;
      const ex = e.prevX + (e.x - e.prevX) * alpha;
      const ez = e.prevZ + (e.z - e.prevZ) * alpha;
      const est = this.enemyState(uid)!;
      est.seen = frame;
      const gap = fightGap(e.radius + SOLDIER_RULES.radius, est.height, this.look.soldierHeight);
      const gang = this.gang;
      gang.length = 0;
      for (const s of system.soldiers) {
        if (gang.length >= MAX_GANG) break;
        if (this.targetOf(s, pool) === e) gang.push(s);
      }
      const n = gang.length;
      this.gangPrev.length = n;
      this.gangDx.length = n;
      this.gangDz.length = n;
      for (let i = 0; i < n; i++) {
        const s = gang[i];
        const st = this.soldierState(s.id);
        const sx = s.prevX + (s.x - s.prevX) * alpha;
        const sz = s.prevZ + (s.z - s.prevZ) * alpha;
        this.gangPrev[i] = st.sideFor === uid ? st.side : 0;
        this.gangDx[i] = sx - ex;
        this.gangDz[i] = sz - ez;
      }
      assignSides(n, this.gangDx, this.gangPrev, gap, this.gangSide);
      for (let i = 0; i < n; i++) {
        const st = this.soldierState(gang[i].id);
        st.side = this.gangSide[i];
        st.sideFor = uid;
      }
      gangSlots(n, this.gangSide, this.gangDz, gap, this.slotX, this.slotZ);
      let primary: FighterState | null = null;
      for (let i = 0; i < n; i++) {
        const s = gang[i];
        const st = this.soldierState(s.id);
        const sx = s.prevX + (s.x - s.prevX) * alpha;
        const sz = s.prevZ + (s.z - s.prevZ) * alpha;
        const d = Math.hypot(sx - ex, sz - ez);
        const w = s.state === 'fighting' ? 1 : Math.max(0, Math.min(1, 1 - (d - gap) / APPROACH));
        st.aimX = (ex + this.slotX[i] - sx) * w;
        st.aimZ = (ez + this.slotZ[i] - sz) * w;
        // Crossing to the other side: step around in front of the foe, not through it.
        const curX = sx + st.slotX - ex;
        if (curX * st.side < gap * 0.6) st.aimZ += gap * 0.7 * (1 - Math.min(1, Math.abs(curX) / gap)) * w;
        if (w > 0.5) st.facing = -st.side;
        if (s.state === 'fighting' && !primary) primary = st;
      }
      est.engaged = e.blockers > 0;
      est.facing = est.engaged && primary ? primary.side : 0;
    }

    // Soldiers: ease offsets, knockback, swings.
    const k = smoothK(dt, SLOT_TAU);
    for (const s of system.soldiers) {
      const st = this.soldierState(s.id);
      const tx = st.aimX;
      const tz = st.aimZ;
      if (s.state === 'dead') {
        st.slotX = st.slotZ = 0;
      } else {
        st.slotX += (tx - st.slotX) * k;
        st.slotZ += (tz - st.slotZ) * k;
      }
      if (s.state !== 'fighting') cancelSwing(st.swing);
      this.tickFighter(st, dt);
      st.x = s.prevX + (s.x - s.prevX) * alpha + st.offX;
      st.z = s.prevZ + (s.z - s.prevZ) * alpha + st.offZ;
      st.age += dt;
    }

    // Enemies: only those in (or just out of) a fight have state.
    for (const [uid, st] of this.enemyStates) {
      const e = this.enemyByUid.get(uid);
      if (!e) {
        this.enemyStates.delete(uid);
        continue;
      }
      if (st.seen !== frame) {
        st.engaged = false;
        st.facing = 0;
      }
      if (!st.engaged) cancelSwing(st.swing);
      st.slotX = st.slotZ = 0;
      this.tickFighter(st, dt);
      st.x = e.prevX + (e.x - e.prevX) * alpha + st.offX;
      st.z = e.prevZ + (e.z - e.prevZ) * alpha + st.offZ;
      if (st.seen !== frame && st.swing.t < 0 && st.swing.pendingIn === Infinity && st.flash <= 0 && st.knockT >= st.knockLife) {
        this.enemyStates.delete(uid);
      }
    }
    for (const [id, st] of this.soldierStates) if (st.seen !== frame) this.soldierStates.delete(id);
  }

  private tickFighter(st: FighterState, dt: number): void {
    advanceSwing(st.swing, dt);
    swingPose(st.swing, st.pose);
    st.flash = Math.max(0, st.flash - dt);
    if (st.knockT < st.knockLife) st.knockT += dt;
    const kc = knockCurve(st.knockT, st.knockLife);
    st.offX = st.slotX + st.knockX * kc;
    st.offZ = st.slotZ + st.knockZ * kc;
    st.idle = st.engaged && st.swing.t < 0 ? st.idle + dt : st.idle;
  }

  private targetOf(s: SoldierEntity, pool: ObjectPool<EnemyEntity>): EnemyEntity | null {
    if ((s.state !== 'fighting' && s.state !== 'engaging') || s.targetPoolIndex < 0) return null;
    const e = pool.items[s.targetPoolIndex];
    return e.active && e.uid === s.targetUid ? e : null;
  }

}
