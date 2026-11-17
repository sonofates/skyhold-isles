import { describe, expect, it } from 'vitest';
import { LEVELS, parseLevelGrid } from '../../src/data/levels/index.ts';
import {
  GIVE_UP_AFTER_WAVES,
  TOUR_TILE,
  OnboardingMachine,
  coachMessage,
  type OnboardingObs,
} from '../../src/ui/content/onboardingMachine.ts';

const base: OnboardingObs = {
  inPlay: true,
  levelIndex: 0,
  touch: false,
  modalOpen: false,
  towerCount: 0,
  maxTier: 0,
  towerSelected: false,
  placementActive: false,
  radialMode: 'closed',
  wavesStarted: 0,
  gold: 185,
  cheapestUpgrade: Infinity,
  meteorReady: false,
  meteorAiming: false,
};
const obs = (o: Partial<OnboardingObs> = {}): OnboardingObs => ({ ...base, ...o });

describe('OnboardingMachine', () => {
  it('walks build → startWave → upgrade → ability → done as the player acts', () => {
    const m = new OnboardingMachine(true);
    expect(m.step).toBe('build');
    expect(m.update(obs())).toBe(false);
    expect(m.update(obs({ towerCount: 1, cheapestUpgrade: 55 }))).toBe(true);
    expect(m.step).toBe('startWave');
    m.update(obs({ towerCount: 1, wavesStarted: 1 }));
    expect(m.step).toBe('upgrade');
    m.update(obs({ towerCount: 1, wavesStarted: 1, maxTier: 2 }));
    expect(m.step).toBe('ability');
    m.onAbilityCast();
    expect(m.step).toBe('done');
    expect(m.active).toBe(false);
  });

  it('can satisfy several steps from a single observation', () => {
    const m = new OnboardingMachine(true);
    m.update(obs({ towerCount: 2, wavesStarted: 1, maxTier: 2 }));
    expect(m.step).toBe('ability');
  });

  it('goes back to build if the only tower is sold before the first wave', () => {
    const m = new OnboardingMachine(true);
    m.update(obs({ towerCount: 1 }));
    expect(m.step).toBe('startWave');
    m.update(obs({ towerCount: 0 }));
    expect(m.step).toBe('build');
  });

  it('never moves backwards once the first wave has started', () => {
    const m = new OnboardingMachine(true);
    m.update(obs({ towerCount: 1, wavesStarted: 1 }));
    expect(m.step).toBe('upgrade');
    m.update(obs({ towerCount: 0, wavesStarted: 1 }));
    expect(m.step).toBe('upgrade');
  });

  it('gives up waiting for an upgrade after a few waves', () => {
    const m = new OnboardingMachine(true);
    m.update(obs({ towerCount: 1, wavesStarted: GIVE_UP_AFTER_WAVES }));
    expect(m.step).toBe('ability');
  });

  it('ignores observations from other islands, outside play, or when inactive', () => {
    const m = new OnboardingMachine(true);
    expect(m.update(obs({ levelIndex: 2, towerCount: 3 }))).toBe(false);
    expect(m.update(obs({ inPlay: false, towerCount: 3 }))).toBe(false);
    expect(m.step).toBe('build');
    const off = new OnboardingMachine(false);
    expect(off.update(obs({ towerCount: 3 }))).toBe(false);
    expect(off.active).toBe(false);
  });

  it('stop() makes it inert and start() replays from the top', () => {
    const m = new OnboardingMachine(true);
    m.update(obs({ towerCount: 1 }));
    expect(m.stop()).toBe(true);
    expect(m.stop()).toBe(false);
    expect(m.update(obs({ towerCount: 1, wavesStarted: 1 }))).toBe(false);
    m.start();
    expect(m.active).toBe(true);
    expect(m.step).toBe('build');
  });

  it('a level restart resets the tour to the first step', () => {
    const m = new OnboardingMachine(true);
    m.update(obs({ towerCount: 1, wavesStarted: 1 }));
    expect(m.step).toBe('upgrade');
    m.onLevelStart(0);
    expect(m.step).toBe('build');
  });
});

describe('coachMessage', () => {
  it('gives touch and desktop different build guidance', () => {
    const desk = coachMessage('build', obs());
    expect(desk?.target).toBe('buildBar');
    expect(desk?.text).toMatch(/bar/i);
    const deskArmed = coachMessage('build', obs({ placementActive: true }));
    expect(deskArmed?.target).toBe('none');
    const touch = coachMessage('build', obs({ touch: true }));
    expect(touch?.text).toMatch(/tap/i);
    const ring = coachMessage('build', obs({ touch: true, radialMode: 'build' }));
    expect(ring?.target).toBe('ring');
  });

  it('points at the wave button, then the tower UI once a tower is selected', () => {
    expect(coachMessage('startWave', obs())?.target).toBe('waveBtn');
    expect(coachMessage('upgrade', obs({ gold: 10, cheapestUpgrade: 55 }))?.text).toMatch(/gold/i);
    expect(coachMessage('upgrade', obs({ gold: 100, cheapestUpgrade: 55 }))?.target).toBe('none');
    expect(coachMessage('upgrade', obs({ gold: 100, cheapestUpgrade: 55, towerSelected: true }))?.target).toBe('towerUi');
  });

  it('ability hint highlights meteor only when it can be cast', () => {
    expect(coachMessage('ability', obs())?.target).toBe('none');
    expect(coachMessage('ability', obs({ meteorReady: true }))?.target).toBe('meteor');
    expect(coachMessage('ability', obs({ meteorAiming: true }))?.title).toMatch(/aim/i);
    expect(coachMessage('done', obs())).toBeNull();
  });

  it('step numbers stay within 1..total', () => {
    for (const step of ['build', 'startWave', 'upgrade', 'ability'] as const) {
      const m = coachMessage(step, obs());
      expect(m).not.toBeNull();
      expect(m!.index).toBeGreaterThanOrEqual(1);
      expect(m!.index).toBeLessThanOrEqual(m!.total);
    }
  });
});

describe('tour tile marker', () => {
  it('points at a buildable tile next to the road on island 1', () => {
    const lvl = LEVELS[0];
    const grid = parseLevelGrid(lvl);
    expect(grid[TOUR_TILE.row][TOUR_TILE.col]).toBe('grass');
    // At least three road tiles within two tiles, so a tower there actually shoots something.
    let road = 0;
    for (let r = TOUR_TILE.row - 2; r <= TOUR_TILE.row + 2; r++) {
      for (let c = TOUR_TILE.col - 2; c <= TOUR_TILE.col + 2; c++) {
        if (grid[r]?.[c] === 'path') road++;
      }
    }
    expect(road).toBeGreaterThanOrEqual(3);
  });

  it('shows the marker while the player still has to pick a tile, not once the ring is open', () => {
    expect(coachMessage('build', obs({ touch: true }))?.marker).toBe(true);
    expect(coachMessage('build', obs({ touch: true, radialMode: 'build' }))?.marker).toBeFalsy();
    expect(coachMessage('build', obs({ placementActive: true }))?.marker).toBe(true);
    expect(coachMessage('build', obs())?.marker).toBeFalsy();
    expect(coachMessage('startWave', obs())?.marker).toBeFalsy();
  });
});
