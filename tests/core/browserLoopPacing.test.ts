import { describe, expect, it, vi } from 'vitest';
import { GameLoop, computeRenderPacingTarget } from '../../src/platform/browserLoop.ts';
import { loadSettings } from '../../src/platform/storage.ts';

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

  it('does not wake menus, levelSelect, or open modals to full VSync on pointer movement', () => {
    expect(
      computeRenderPacingTarget({
        hidden: false,
        simActive: false,
        paused: false,
        modalOpen: false,
        menuView: 'menu',
        wakeActive: true,
      }),
    ).toEqual({ targetFps: 30, mode: 'menu' });

    expect(
      computeRenderPacingTarget({
        hidden: false,
        simActive: false,
        paused: false,
        modalOpen: false,
        menuView: 'levelSelect',
        wakeActive: true,
      }),
    ).toEqual({ targetFps: 15, mode: 'modal' });

    expect(
      computeRenderPacingTarget({
        hidden: false,
        simActive: true,
        paused: true,
        modalOpen: true,
        menuView: 'playing',
        wakeActive: true,
      }),
    ).toEqual({ targetFps: 15, mode: 'modal' });
  });
});

describe('GameLoop throttle boundary and storage backward compatibility', () => {
  it('flags the first frame emerging from a throttled mode so governor ignores the sleep delta', () => {
    let nextRaf: ((now: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      nextRaf = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('performance', { now: () => 0 });

    const observedThrottled: boolean[] = [];
    const loop = new GameLoop({
      onFixedTick: () => {},
      onRender: () => {},
      onAfterRender: (_dt, _work, throttled) => observedThrottled.push(throttled),
    });
    loop.setRenderPacing(15, 'modal');
    loop.start();

    nextRaf?.(10); // renders initial frame while throttled -> throttled=true
    nextRaf?.(26); // skipped (< 65ms)
    loop.setRenderPacing(null, 'active'); // modal closed
    nextRaf?.(77); // first uncapped frame after 67ms sleep -> flagged true!
    nextRaf?.(94); // steady uncapped frame -> false

    expect(observedThrottled).toEqual([true, true, false]);
    loop.stop();
    vi.unstubAllGlobals();
  });

  it('defaults quality to auto while keeping legacy high/low settings backward compatible', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });

    expect(loadSettings().quality).toBe('auto');

    store.set('skyhold_isles_settings_v1', JSON.stringify({ masterVolume: 0.5 }));
    expect(loadSettings().quality).toBe('auto');

    store.set('skyhold_isles_settings_v1', JSON.stringify({ quality: 'high' }));
    expect(loadSettings().quality).toBe('high');

    store.set('skyhold_isles_settings_v1', JSON.stringify({ quality: 'low' }));
    expect(loadSettings().quality).toBe('low');

    store.set('skyhold_isles_settings_v1', JSON.stringify({ quality: 'invalid' }));
    expect(loadSettings().quality).toBe('auto');

    vi.unstubAllGlobals();
  });
});
