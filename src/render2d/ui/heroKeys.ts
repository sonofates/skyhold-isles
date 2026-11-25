import { keyFor } from './keyBindings.ts';

/** Hero keyboard shortcuts (in-game HUD + Settings → Controls), live from keyBindings.ts (default H / E / R). */
export const HERO_KEYS: Readonly<{ select: string; skill0: string; skill1: string }> = {
  get select(): string {
    return keyFor('heroSelect');
  },
  get skill0(): string {
    return keyFor('heroSkill0');
  },
  get skill1(): string {
    return keyFor('heroSkill1');
  },
};
