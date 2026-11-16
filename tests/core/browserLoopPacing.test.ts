import { describe, expect, it } from 'vitest';
import { computeRenderPacingTarget } from '../../src/platform/browserLoop.ts';

describe('computeRenderPacingTarget', () => {
  it('skips rendering when the tab is hidden', () => {
    expect(
      computeRenderPacingTarget({
        hidden: true,
        simActive: true,
        paused: false,
        modalOpen: false,
        menuView: 'playing',
        wakeActive: true,
      }),
    ).toEqual({ targetFps: 0, mode: 'hidden' });
  });

  it('runs uncapped during active gameplay', () => {
    expect(
      computeRenderPacingTarget({
        hidden: false,
        simActive: true,
        paused: false,
        modalOpen: false,
        menuView: 'playing',
        wakeActive: false,
      }),
    ).toEqual({ targetFps: null, mode: 'active' });
  });

  it('lowers frame rate in static menus, modals, and idle pause while allowing instant wake', () => {
    expect(
      computeRenderPacingTarget({
        hidden: false,
        simActive: false,
        paused: false,
        modalOpen: false,
        menuView: 'menu',
        wakeActive: false,
      }),
    ).toEqual({ targetFps: 30, mode: 'menu' });

    expect(
      computeRenderPacingTarget({
        hidden: false,
        simActive: false,
        paused: false,
        modalOpen: false,
        menuView: 'levelSelect',
        wakeActive: false,
      }),
    ).toEqual({ targetFps: 15, mode: 'modal' });

    expect(
      computeRenderPacingTarget({
        hidden: false,
        simActive: true,
        paused: true,
        modalOpen: true,
        menuView: 'playing',
        wakeActive: false,
      }),
    ).toEqual({ targetFps: 15, mode: 'modal' });

    expect(
      computeRenderPacingTarget({
        hidden: false,
        simActive: true,
        paused: true,
        modalOpen: false,
        menuView: 'playing',
        wakeActive: false,
      }),
    ).toEqual({ targetFps: 20, mode: 'paused' });

    expect(
      computeRenderPacingTarget({
        hidden: false,
        simActive: true,
        paused: true,
        modalOpen: false,
        menuView: 'playing',
        wakeActive: true,
      }),
    ).toEqual({ targetFps: null, mode: 'wake' });
  });
});
