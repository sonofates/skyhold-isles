import type { QualityLevel, QualityTier } from '../core/types.ts';
import { QualityGovernor } from '../render/qualityGovernor.ts';
import { initialTier } from '../render/qualityTiers.ts';

/**
 * Bridges the player's quality setting and the adaptive governor: fixed settings apply their tier
 * directly, 'auto' starts from a device-appropriate tier and lets frame times move it.
 */
export class QualityController {
  private readonly governor: QualityGovernor;
  private readonly apply: (tier: QualityTier) => void;
  private readonly isTouch: () => boolean;
  private setting: QualityLevel = 'high';
  private applied: QualityTier | null = null;

  constructor(
    apply: (tier: QualityTier) => void,
    isTouch: () => boolean,
    governor: QualityGovernor = new QualityGovernor('high'),
  ) {
    this.apply = apply;
    this.isTouch = isTouch;
    this.governor = governor;
  }

  get tier(): QualityTier {
    return this.governor.tier;
  }

  get isAuto(): boolean {
    return this.setting === 'auto';
  }

  setSetting(setting: QualityLevel): void {
    // Re-applying an unchanged setting (e.g. the sound slider saves all settings) must not
    // throw away what the governor has learned.
    if (setting === this.setting && this.applied !== null) return;
    this.setting = setting;
    const tier = initialTier(setting, this.isTouch());
    this.governor.setTier(tier);
    this.governor.setActive(setting === 'auto');
    this.commit(tier);
  }

  /** Feed the frame time (ms) of a rendered frame. */
  frame(frameMs: number): void {
    if (this.setting !== 'auto') return;
    const next = this.governor.sample(frameMs);
    if (next) this.commit(next);
  }

  /** Level load / resume from background: shaders compile and caches warm, so ignore a while. */
  rearm(): void {
    this.governor.reset();
  }

  private commit(tier: QualityTier): void {
    if (tier === this.applied) return;
    this.applied = tier;
    this.apply(tier);
  }
}
