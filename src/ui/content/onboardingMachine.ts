/**
 * First-run onboarding as a pure state machine (no DOM): the session feeds it observations of the
 * game ({@link OnboardingObs}) and it answers with the current step and the hint to show.
 *
 * Steps: build (tap tile → pick tower → place) → startWave → upgrade (upgrade or sell) → ability → done.
 * Every step is derived from what the player actually did, so the tour never blocks play.
 */

export type OnboardingStep = 'build' | 'startWave' | 'upgrade' | 'ability' | 'done';
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ['build', 'startWave', 'upgrade', 'ability', 'done'];

export interface OnboardingObs {
  /** True while a level is being played on screen. */
  inPlay: boolean;
  /** 0-based island index (the tour only runs on island 1). */
  levelIndex: number;
  touch: boolean;
  /** A blocking modal (pause, settings, outcome, card) is open. */
  modalOpen: boolean;
  towerCount: number;
  /** Highest tier among towers on the map (0 when none). */
  maxTier: number;
  /** The player selected a tower (panel on desktop, radial tower ring on touch). */
  towerSelected: boolean;
  /** Desktop: a tower type is armed for placement. */
  placementActive: boolean;
  /** Touch: which radial ring is open. */
  radialMode: 'closed' | 'build' | 'tower';
  /** Waves started so far (0 before the first). */
  wavesStarted: number;
  gold: number;
  /** Cheapest upgrade among the player's towers (Infinity when none can be upgraded). */
  cheapestUpgrade: number;
  /** Meteor can be cast right now (off cooldown, wave running). */
  meteorReady: boolean;
  /** Meteor targeting mode is active. */
  meteorAiming: boolean;
}

export type CoachTarget = 'none' | 'buildBar' | 'ring' | 'waveBtn' | 'towerUi' | 'meteor';

export interface CoachMessage {
  /** 1-based step number shown as "2/5". */
  index: number;
  total: number;
  title: string;
  text: string;
  target: CoachTarget;
}

/** Waves after which a player who ignores the upgrade/ability steps is considered to have the hang of it. */
export const GIVE_UP_AFTER_WAVES = 5;

export class OnboardingMachine {
  private stepValue: OnboardingStep = 'build';
  private activeValue: boolean;

  constructor(initiallyActive: boolean) {
    this.activeValue = initiallyActive;
  }

  get step(): OnboardingStep {
    return this.stepValue;
  }

  get active(): boolean {
    return this.activeValue && this.stepValue !== 'done';
  }

  /** Begin (or restart) the tour from the first step. */
  start(): void {
    this.activeValue = true;
    this.stepValue = 'build';
  }

  /** Player skipped or finished: the machine goes inert. Returns true if it was running. */
  stop(): boolean {
    const was = this.active;
    this.activeValue = false;
    return was;
  }

  /** The level was (re)started: the tour resumes from the first step on a fresh island. */
  onLevelStart(levelIndex: number): void {
    if (!this.activeValue) return;
    this.stepValue = levelIndex === 0 ? 'build' : this.stepValue;
  }

  /** A meteor / overcharge cast, any source. */
  onAbilityCast(): void {
    if (this.active && this.stepValue === 'ability') this.stepValue = 'done';
  }

  /**
   * Feed the latest observation. Returns true when the step changed (callers re-render the coach).
   * Only advances forward, except `startWave → build` when the player sells their only tower.
   */
  update(obs: OnboardingObs): boolean {
    if (!this.active || !obs.inPlay || obs.levelIndex !== 0) return false;
    const before = this.stepValue;
    // Loop so one observation can skip several satisfied steps (e.g. a veteran who built + upgraded).
    for (let guard = 0; guard < 6; guard++) {
      const s = this.stepValue;
      if (s === 'build') {
        if (obs.towerCount >= 1) this.stepValue = 'startWave';
      } else if (s === 'startWave') {
        if (obs.towerCount === 0 && obs.wavesStarted === 0) this.stepValue = 'build';
        else if (obs.wavesStarted >= 1) this.stepValue = 'upgrade';
      } else if (s === 'upgrade') {
        if (obs.maxTier >= 2 || obs.wavesStarted >= GIVE_UP_AFTER_WAVES) this.stepValue = 'ability';
      } else if (s === 'ability') {
        if (obs.wavesStarted >= GIVE_UP_AFTER_WAVES + 3) this.stepValue = 'done';
      }
      if (this.stepValue === s) break;
    }
    return this.stepValue !== before;
  }
}

const TOTAL = 4;

/** What to tell the player right now. Null when nothing should be shown. */
export function coachMessage(step: OnboardingStep, obs: OnboardingObs): CoachMessage | null {
  switch (step) {
    case 'build': {
      if (obs.touch) {
        if (obs.radialMode === 'build') {
          return {
            index: 1, total: TOTAL, title: 'Choose a tower',
            text: 'Tap the Archer in the ring to build it. Archers hit ground and air.',
            target: 'ring',
          };
        }
        return {
          index: 1, total: TOTAL, title: 'Build a tower',
          text: 'Tap any green tile beside the road to open the build ring.',
          target: 'none',
        };
      }
      if (obs.placementActive) {
        return {
          index: 1, total: TOTAL, title: 'Place it',
          text: 'Click a green tile beside the road. Shift-click keeps building.',
          target: 'none',
        };
      }
      return {
        index: 1, total: TOTAL, title: 'Build a tower',
        text: 'Pick the Archer from the bar below (or press 1), then click a green tile next to the road.',
        target: 'buildBar',
      };
    }
    case 'startWave':
      return {
        index: 2, total: TOTAL, title: 'Call the first wave',
        text: 'Raiders march along the road to your crystal. Start the wave when you are ready.',
        target: 'waveBtn',
      };
    case 'upgrade': {
      const canAfford = obs.gold >= obs.cheapestUpgrade;
      if (!canAfford) {
        return {
          index: 3, total: TOTAL, title: 'Earn gold, then upgrade',
          text: 'Every raider you stop pays gold. Spend it to upgrade a tower — selling one refunds 70%.',
          target: 'none',
        };
      }
      return {
        index: 3, total: TOTAL, title: 'Upgrade a tower',
        text: obs.towerSelected
          ? 'Hit Upgrade to make it stronger. Sell refunds 70% if you change your mind.'
          : obs.touch
            ? 'Tap your tower, then Upgrade. You can also Sell it for 70% back.'
            : 'Click your tower, then Upgrade (U). You can also Sell it for 70% back.',
        target: obs.towerSelected ? 'towerUi' : 'none',
      };
    }
    case 'ability':
      if (obs.meteorAiming) {
        return {
          index: 4, total: TOTAL, title: 'Aim the Meteor',
          text: obs.touch ? 'Tap the road where raiders are bunched up.' : 'Click the road where raiders are bunched up.',
          target: 'none',
        };
      }
      return {
        index: 4, total: TOTAL, title: 'Use a power',
        text: obs.meteorReady
          ? 'Meteor Strike smashes a crowd. Tap it, then tap the road. It recharges between waves.'
          : 'Your powers recharge between waves. When Meteor is ready, tap it and aim at a crowd.',
        target: obs.meteorReady ? 'meteor' : 'none',
      };
    case 'done':
      return null;
  }
}
