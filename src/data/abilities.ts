import type { AbilityId } from '../core/types.ts';

export interface AbilityDef {
  readonly id: AbilityId;
  readonly name: string;
  readonly hotkey: string;
  readonly shortDesc: string;
  readonly cooldownSec: number;
  readonly requiresTarget: boolean;
  readonly impactDelaySec?: number;
  readonly radius?: number;
  readonly baseDamage?: number;
  readonly waveDamageScale?: number;
  readonly slowRatio?: number;
  readonly slowDuration?: number;
  readonly durationSec?: number;
  readonly fireRateMultiplier?: number;
}

export const ABILITY_IDS: readonly AbilityId[] = ['meteor', 'overcharge'];

export const ABILITY_DEFS = {
  meteor: {
    id: 'meteor',
    name: 'Meteor Strike',
    hotkey: 'F',
    shortDesc: 'Call down a blazing meteor for armor-piercing AoE damage and slow.',
    cooldownSec: 30,
    impactDelaySec: 0.32,
    radius: 3.4,
    baseDamage: 185,
    waveDamageScale: 0.16,
    slowRatio: 0.38,
    slowDuration: 1.6,
    requiresTarget: true,
  },
  overcharge: {
    id: 'overcharge',
    name: 'Overcharge',
    hotkey: 'G',
    shortDesc: 'Cleanse stunned towers and surge attack speed by 65% for 7s.',
    cooldownSec: 36,
    durationSec: 7.0,
    fireRateMultiplier: 1.65,
    requiresTarget: false,
  },
} as const satisfies Record<AbilityId, AbilityDef>;

export function computeMeteorDamage(waveOneBased: number): number {
  const def = ABILITY_DEFS.meteor;
  const w = Number.isFinite(waveOneBased) ? Math.max(1, Math.min(10_000, Math.floor(waveOneBased))) : 1;
  return Math.round(def.baseDamage * (1 + (w - 1) * def.waveDamageScale));
}
