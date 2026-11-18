/**
 * Global abilities (Meteor Strike, Overcharge) in the painted game: the rules the bar and the
 * targeting follow, kept free of DOM / Pixi so they are unit-tested (tests/render/ui6.test.ts).
 *
 * Casting: `SimWorld.castMeteor` / `castOvercharge` refuse on plot maps (`canUseAbilities()` has a
 * `!grid.isPlotMode` guard from the time the 2D game had no ability UI), and src/sim may not be
 * edited by this task. So a cast first asks the world (it wins as soon as the sim allows plot
 * maps), then falls back to the world's own `abilitySystem` behind the same gate the sim uses
 * minus the plot-mode clause: abilities not disabled by the run's rules, run still going, first
 * wave started. Cooldowns, damage, slow, cleanse and events are the sim's own.
 */
import type { AbilityId } from '../../core/types.ts';
import { ABILITY_DEFS, ABILITY_IDS, computeMeteorDamage } from '../../data/abilities.ts';
import { pct, t } from '../../i18n/index.ts';
import type { SimWorld } from '../../sim/world.ts';

export { ABILITY_IDS };

/** Desktop shortcuts (1 / 2 already pick the game speed). */
export const ABILITY_KEYS: Readonly<Record<AbilityId, string>> = { meteor: 'Q', overcharge: 'W' };

/** The slice of SimWorld the abilities read (a real SimWorld in game and tests). */
export type AbilityWorld = Pick<SimWorld, 'mods' | 'outcome' | 'waveSystem' | 'abilitySystem' | 'towers' | 'castMeteor' | 'castOvercharge'>;

export type AbilityGate = 'ok' | 'disabled' | 'waiting' | 'over';

/** Same rule as `SimWorld.canUseAbilities()` without its plot-map clause. */
export function abilityGate(w: Pick<AbilityWorld, 'mods' | 'outcome' | 'waveSystem'>): AbilityGate {
  if (w.mods.abilitiesDisabled) return 'disabled';
  if (w.outcome !== 'ongoing') return 'over';
  if (w.waveSystem.state === 'preFirstWave') return 'waiting';
  return 'ok';
}

export type SlotState = 'ready' | 'cooldown' | 'disabled' | 'waiting' | 'over' | 'noTargets';

export interface AbilitySlotView {
  readonly id: AbilityId;
  readonly state: SlotState;
  /** Seconds left on the recharge (0 = none) and the recharge's full length (Workshop-scaled). */
  readonly cooldown: number;
  readonly maxCooldown: number;
  /** 0..1 of the recharge still to go (drives the dark sweep). */
  readonly cooldownFrac: number;
  /** Overcharge only: seconds of the surge left (0 = not active) and 0..1 of it. */
  readonly active: number;
  readonly activeFrac: number;
}

export function abilitySlotView(w: AbilityWorld, id: AbilityId): AbilitySlotView {
  const sys = w.abilitySystem;
  const cooldown = Math.max(0, sys.getCooldown(id));
  const maxCooldown = Math.max(0.001, sys.getMaxCooldown(id));
  const active = id === 'overcharge' ? Math.max(0, sys.getOverchargeRemaining()) : 0;
  const gate = abilityGate(w);
  let state: SlotState;
  if (gate === 'disabled') state = 'disabled';
  else if (gate === 'over') state = 'over';
  else if (cooldown > 0) state = 'cooldown';
  else if (gate === 'waiting') state = 'waiting';
  else if (id === 'overcharge' && w.towers.length === 0) state = 'noTargets';
  else state = 'ready';
  return {
    id,
    state,
    cooldown,
    maxCooldown,
    cooldownFrac: Math.max(0, Math.min(1, cooldown / maxCooldown)),
    active,
    activeFrac: active > 0 ? Math.max(0, Math.min(1, active / ABILITY_DEFS.overcharge.durationSec)) : 0,
  };
}

/** Meteor at a ground point (world units). True when it was cast. */
export function castMeteor2D(w: AbilityWorld, x: number, z: number): boolean {
  if (w.castMeteor(x, z)) return true;
  return abilityGate(w) === 'ok' && w.abilitySystem.castMeteor(x, z, Math.max(1, w.waveSystem.currentWaveOneBased));
}

/** Overcharge (every tower; the tapped one only picks where the surge starts). */
export function castOvercharge2D(w: AbilityWorld): boolean {
  if (w.castOvercharge()) return true;
  return abilityGate(w) === 'ok' && w.towers.length > 0 && w.abilitySystem.castOvercharge(w.towers);
}

/** Meteor damage for the wave being fought (the tooltip number). */
export function meteorDamageNow(w: Pick<AbilityWorld, 'waveSystem'>): number {
  return computeMeteorDamage(Math.max(1, w.waveSystem.currentWaveOneBased));
}

export function abilityName(id: AbilityId): string {
  return id === 'meteor' ? t('ab.meteor') : t('ab.overcharge');
}

/** Rules text from the data (damage for the current wave, slow, surge, duration). */
export function abilityDesc(id: AbilityId, waveOneBased: number): string {
  if (id === 'meteor') {
    const d = ABILITY_DEFS.meteor;
    return t('ab.meteorDesc', { dmg: computeMeteorDamage(Math.max(1, waveOneBased)), slow: pct(d.slowRatio), sec: d.slowDuration });
  }
  const d = ABILITY_DEFS.overcharge;
  return t('ab.overchargeDesc', { pct: pct(d.fireRateMultiplier - 1), sec: d.durationSec });
}

/** Short status line under the name (tooltip, aria label). */
export function slotStatus(v: AbilitySlotView): string {
  switch (v.state) {
    case 'ready':
      return v.active > 0 ? t('ab.active', { n: Math.ceil(v.active) }) : t('ab.ready');
    case 'cooldown':
      return v.active > 0 ? t('ab.active', { n: Math.ceil(v.active) }) : t('ab.secs', { n: Math.ceil(v.cooldown) });
    case 'disabled':
      return t('ab.disabled');
    case 'waiting':
      return t('ab.waiting');
    case 'noTargets':
      return t('ab.noTowers');
    default:
      return '';
  }
}

/** Seconds as the bar prints them on a recharging button. */
export function secsLabel(s: number): string {
  return t('ab.secs', { n: Math.ceil(s) });
}
