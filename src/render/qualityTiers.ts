import type { QualityLevel, QualityTier } from '../core/types.ts';

/** What each rendering tier switches on. Desktop 'high' keeps the original (pre-governor) look. */
export interface TierSpec {
  /** Upper bound for renderer.setPixelRatio. */
  dprCap: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Post-processing chain: null = direct render (no composer). */
  composer: 'high' | 'medium' | null;
  /** Particle-count multiplier. */
  fxScale: number;
}

export const TIER_SPECS: Record<QualityTier, TierSpec> = {
  high: { dprCap: 2, shadows: true, shadowMapSize: 2048, composer: 'high', fxScale: 1 },
  medium: { dprCap: 1.5, shadows: true, shadowMapSize: 1024, composer: 'medium', fxScale: 0.75 },
  low: { dprCap: 1, shadows: false, shadowMapSize: 1024, composer: null, fxScale: 0.5 },
};

/** Tier to start from for a quality setting. Auto starts conservatively on touch devices. */
export function initialTier(setting: QualityLevel, isTouch: boolean): QualityTier {
  if (setting !== 'auto') return setting;
  return isTouch ? 'medium' : 'high';
}

export function effectivePixelRatio(tier: QualityTier, devicePixelRatio: number): number {
  return Math.max(1, Math.min(devicePixelRatio || 1, TIER_SPECS[tier].dprCap));
}
