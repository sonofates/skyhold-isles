import { describe, expect, it, vi } from 'vitest';
import { GameLoop, computeRenderPacingTarget } from '../../src/platform/browserLoop.ts';
import { loadSettings } from '../../src/platform/storage.ts';
import { PerfGovernor } from '../../src/render/perfGovernor.ts';

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
    const observedSleepBoundaries: boolean[] = [];

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
      onAfterRender: (_dt, _work, throttled, sleepBoundary) => {
        observedThrottled.push(throttled);
        observedSleepBoundaries.push(Boolean(sleepBoundary));
      },
    });

    loop.start();
    nextRaf?.(100); // renders frame 1 in 15fps modal -> throttled=true, sleepBoundary=false
    nextRaf?.(116); // still in modal (< 65ms) -> skipped
    expect(renderedCount).toBe(1);

    // User clicks Resume right before next RAF at 132ms (only 32ms since last render)
    modalOpen = false;
    nextRaf?.(132); // resolveRenderPacing uncaps BEFORE gate -> renders immediately!
    nextRaf?.(148); // normal active frame -> throttled=false

    expect(renderedCount).toBe(3);
    expect(observedThrottled).toEqual([true, true, false]);
    expect(observedSleepBoundaries).toEqual([false, true, false]);
    expect(loop.getPacingInfo().mode).toBe('active');
    expect(loop.getPacingInfo().targetFps).toBeNull();

    loop.stop();
    vi.unstubAllGlobals();
  });

  it('keeps modals capped at 15fps even if wakeRender was triggered right before opening the modal', () => {
    let nextRaf: ((now: number) => void) | null = null;
    let nowMs = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      nextRaf = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('performance', { now: () => nowMs });

    let renderedCount = 0;
    const loop = new GameLoop({
      resolveRenderPacing: (wakeActive) =>
        computeRenderPacingTarget({
          hidden: false,
          simActive: true,
          paused: true,
          modalOpen: true,
          menuView: 'playing',
          wakeActive,
        }),
      onFixedTick: () => {},
      onRender: () => {
        renderedCount++;
      },
    });

    loop.start();
    loop.wakeRender(1.0); // still active for 1000ms
    nowMs = 100;
    nextRaf?.(100); // renders frame 1 in modal
    nowMs = 116;
    nextRaf?.(116); // < 65ms -> must STILL be skipped at 15fps despite active wake timer!
    nowMs = 133;
    nextRaf?.(133); // still < 65ms -> skipped
    nowMs = 170;
    nextRaf?.(170); // >= 65ms -> renders frame 2

    expect(renderedCount).toBe(2);
    expect(loop.getPacingInfo()).toMatchObject({ mode: 'modal', targetFps: 15 });

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

  it('passes unclamped actualFrameDt to onAfterRender so PerfGovernor ignores >250ms OS stalls', () => {
    let nextRaf: ((now: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      nextRaf = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('performance', { now: () => 0 });

    const renderDts: number[] = [];
    const actualDts: number[] = [];
    const gov = new PerfGovernor({ mode: 'auto', isTouch: false });

    const loop = new GameLoop({
      onFixedTick: () => {},
      onRender: (frameDt) => {
        renderDts.push(frameDt);
      },
      onAfterRender: (_dt, _work, throttled, _sleepBoundary, actualFrameDt) => {
        const dt = actualFrameDt ?? _dt;
        actualDts.push(dt);
        gov.recordFrame(dt * 1000, { throttled });
      },
    });

    loop.start();
    nextRaf?.(16);
    nextRaf?.(416); // 400ms OS hitch -> clamped to 0.1s for sim/render, unclamped 0.4s for governor

    expect(renderDts[1]).toBeCloseTo(0.1, 6);
    expect(actualDts[1]).toBeCloseTo(0.4, 6);
    // Governor rejected the 400ms spike (>250ms) and kept Tier 5 with 0 recorded slow samples
    expect(gov.getTier()).toBe(5);
    expect(gov.getStats().sampleCount).toBe(0);

    loop.stop();
    vi.unstubAllGlobals();
  });

  it('skips rendering completely when resolveRenderPacing returns targetFps 0 (hidden) and clamps wake duration', () => {
    let nextRaf: ((now: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      nextRaf = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('performance', { now: () => 100 });

    let hidden = true;
    let rendered = 0;
    const loop = new GameLoop({
      resolveRenderPacing: (wakeActive) =>
        computeRenderPacingTarget({
          hidden,
          simActive: true,
          paused: false,
          modalOpen: false,
          menuView: 'playing',
          wakeActive,
        }),
      onFixedTick: () => {},
      onRender: () => {
        rendered++;
      },
    });

    loop.wakeRender(-5);
    expect(loop.isWakeActive()).toBe(false);
    loop.wakeRender(Number.NaN);
    expect(loop.isWakeActive()).toBe(false);

    loop.start();
    nextRaf?.(116);
    expect(rendered).toBe(0);

    hidden = false;
    nextRaf?.(132);
    expect(rendered).toBe(1);

    loop.stop();
    vi.unstubAllGlobals();
  });

  it('clears pending wake and throttle state when stop() is called before a restart', () => {
    let nextRaf: ((now: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      nextRaf = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('performance', { now: () => 100 });

    const observedSleepBoundaries: boolean[] = [];
    const loop = new GameLoop({
      onFixedTick: () => {},
      onRender: () => {},
      onAfterRender: (_dt, _work, _throttled, sleepBoundary) => {
        observedSleepBoundaries.push(Boolean(sleepBoundary));
      },
    });

    loop.setRenderPacing(15, 'modal');
    loop.start();
    loop.wakeRender(2.0);
    nextRaf?.(116); // renders throttled frame -> lastThrottled becomes true
    expect(loop.isWakeActive()).toBe(true);

    loop.stop();
    expect(loop.isWakeActive()).toBe(false);

    loop.setRenderPacing(null, 'active');
    loop.start();
    nextRaf?.(132);
    expect(observedSleepBoundaries).toEqual([false, false]);

    loop.stop();
    vi.unstubAllGlobals();
  });

  it('enforces frame-rate capping even when the first RAF timestamp is 0 and ignores zero wake duration', () => {
    let nextRaf: ((now: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      nextRaf = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('performance', { now: () => 0 });

    let rendered = 0;
    const loop = new GameLoop({
      onFixedTick: () => {},
      onRender: () => {
        rendered++;
      },
    });

    loop.wakeRender(0);
    expect(loop.isWakeActive()).toBe(false);

    loop.setRenderPacing(30, 'menu');
    loop.start();
    nextRaf?.(0); // renders first frame at timestamp 0
    nextRaf?.(16); // < 31.83ms since 0 -> must be skipped!
    nextRaf?.(34); // >= 31.83ms -> renders second frame
    expect(rendered).toBe(2);

    loop.stop();
    vi.unstubAllGlobals();
  });
});
