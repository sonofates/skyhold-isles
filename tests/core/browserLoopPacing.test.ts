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

  it('uses resolveRenderPacing before gating so unpausing or closing a modal never drops a frame', () => {
    let nextRaf: ((now: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      nextRaf = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('performance', { now: () => 0 });

    let modalOpen = true;
    let renderedCount = 0;
    const observedThrottled: boolean[] = [];

    const loop = new GameLoop({
      resolveRenderPacing: (wakeActive) =>
        computeRenderPacingTarget({
          hidden: false,
          simActive: true,
          paused: modalOpen,
          modalOpen,
          menuView: 'playing',
          wakeActive,
        }),
      onFixedTick: () => {},
      onRender: () => {
        renderedCount++;
      },
      onAfterRender: (_dt, _work, throttled) => {
        observedThrottled.push(throttled);
      },
    });

    loop.start();
    nextRaf?.(100); // renders frame 1 in 15fps modal -> throttled=true
    nextRaf?.(116); // still in modal (< 65ms) -> skipped
    expect(renderedCount).toBe(1);

    // User clicks Resume right before next RAF at 132ms (only 32ms since last render)
    modalOpen = false;
    nextRaf?.(132); // resolveRenderPacing uncaps BEFORE gate -> renders immediately!
    nextRaf?.(148); // normal active frame -> throttled=false

    expect(renderedCount).toBe(3);
    expect(observedThrottled).toEqual([true, true, false]);
    expect(loop.getPacingInfo().mode).toBe('active');
    expect(loop.getPacingInfo().targetFps).toBeNull();

    loop.stop();
    vi.unstubAllGlobals();
  });

  it('reports wake targetFps accurately for paused gameplay vs menus', () => {
    let nowMs = 100;
    vi.stubGlobal('performance', { now: () => nowMs });

    const loop = new GameLoop({
      onFixedTick: () => {},
      onRender: () => {},
    });

    loop.setRenderPacing(30, 'menu');
    loop.wakeRender(0.5);
    expect(loop.getPacingInfo().targetFps).toBe(30);

    loop.setRenderPacing(20, 'paused');
    expect(loop.getPacingInfo()).toMatchObject({ mode: 'wake', targetFps: null });
    nowMs = 700;
    expect(loop.getPacingInfo()).toMatchObject({ mode: 'paused', targetFps: 20 });

    vi.unstubAllGlobals();
  });

  it('cancels RAF and clears stale wake timers when the tab becomes hidden, then restores cleanly', () => {
    let hidden = false;
    const listeners = new Map<string, () => void>();
    const cancelledIds: number[] = [];
    let rafCounter = 0;
    let restores = 0;

    vi.stubGlobal('document', {
      get hidden() {
        return hidden;
      },
      addEventListener: (type: string, cb: () => void) => listeners.set(type, cb),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    vi.stubGlobal('requestAnimationFrame', () => ++rafCounter);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => cancelledIds.push(id));
    vi.stubGlobal('performance', { now: () => 100 });

    const loop = new GameLoop({
      onFixedTick: () => {},
      onRender: () => {},
      onVisibilityRestore: () => {
        restores++;
      },
    });
    loop.setRenderPacing(20, 'paused');
    loop.start();
    loop.wakeRender(1.0);
    expect(loop.isWakeActive()).toBe(true);
    expect(rafCounter).toBe(1);

    // Tab hides -> cancels RAF and clears pending wake timer
    hidden = true;
    listeners.get('visibilitychange')?.();
    expect(cancelledIds).toEqual([1]);
    expect(loop.isWakeActive()).toBe(false);

    // Tab returns -> restores and schedules a fresh RAF
    hidden = false;
    listeners.get('visibilitychange')?.();
    expect(restores).toBe(1);
    expect(rafCounter).toBe(2);

    loop.stop();
    expect(listeners.size).toBe(0);
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
