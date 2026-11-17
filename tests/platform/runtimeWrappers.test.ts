import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundManager } from '../../src/audio/soundManager.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { GameLoop } from '../../src/platform/browserLoop.ts';
import { InputManager, type InputHandlers } from '../../src/platform/input.ts';

class MockEventTarget {
  private listeners = new Map<string, Array<(ev: unknown) => void>>();

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const idx = list.indexOf(fn);
    if (idx !== -1) list.splice(idx, 1);
  }

  dispatch(type: string, ev: unknown): void {
    const list = this.listeners.get(type);
    if (!list) return;
    for (const fn of [...list]) fn(ev);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
}

class MockCanvas extends MockEventTarget {
  capturedPointers = new Set<number>();
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 100, top: 50, width: 200, height: 100 };
  }
  setPointerCapture(id: number): void {
    this.capturedPointers.add(id);
  }
}

class MockInputElement {}
class MockTextAreaElement {}

describe('GameLoop (browserLoop)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts idempotently, clamps frame dt, survives callback throws, and cancels rAF on stop', () => {
    let nextRafId = 1;
    const pending = new Map<number, (now: number) => void>();
    const cancelled: number[] = [];
    let fakeNow = 1000;

    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      const id = nextRafId++;
      pending.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelled.push(id);
      pending.delete(id);
    });
    vi.spyOn(performance, 'now').mockImplementation(() => fakeNow);

    const fixedCalls: number[] = [];
    const renderCalls: Array<{ dt: number; alpha: number; vis: number }> = [];
    let shouldThrow = false;

    const loop = new GameLoop({
      onFixedTick: (dt) => {
        if (shouldThrow) throw new Error('boom');
        fixedCalls.push(dt);
      },
      onRender: (dt, alpha, vis) => {
        renderCalls.push({ dt, alpha, vis });
      },
    });

    loop.simActive = true;
    loop.speed = 2;
    expect(loop.simActive).toBe(true);
    expect(loop.speed).toBe(2);
    expect(loop.paused).toBe(false);

    loop.start();
    loop.start(); // second start is a no-op
    expect(pending.size).toBe(1);

    // Trigger frame 1 with huge 500ms delta -> clamped to 0.1s * speed 2 = 12 fixed ticks
    const firstId = [...pending.keys()][0];
    const firstCb = pending.get(firstId)!;
    pending.delete(firstId);
    fakeNow = 1500;
    firstCb(1500);

    expect(renderCalls).toHaveLength(1);
    expect(renderCalls[0].dt).toBe(0.1);
    expect(fixedCalls).toHaveLength(12);

    // Throwing inside onFixedTick is caught cleanly and keeps next frame scheduled
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = true;
    const secondId = [...pending.keys()][0];
    const secondCb = pending.get(secondId)!;
    pending.delete(secondId);
    fakeNow = 1520;
    expect(() => secondCb(1520)).not.toThrow();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(1);

    // Pause + resetAccumulator + stop
    loop.paused = true;
    expect(loop.paused).toBe(true);
    loop.resetAccumulator();
    const activeBeforeStop = [...pending.keys()][0];
    loop.stop();
    expect(cancelled).toEqual([activeBeforeStop]);
    expect(pending.size).toBe(0);
  });
});

describe('SoundManager with mocked Web Audio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('unlocks audio, enforces mute/volume & throttle gates, binds all sim events, and disposes cleanly', () => {
    let oscCount = 0;
    let bufSrcCount = 0;
    let resumedCount = 0;
    let closedCount = 0;
    const gainValues: number[] = [];

    class FakeAudioContext {
      state: AudioContextState = 'suspended';
      currentTime = 1.0;
      sampleRate = 48000;
      destination = {};

      resume = vi.fn(async () => {
        resumedCount++;
        this.state = 'running';
      });
      close = vi.fn(async () => {
        closedCount++;
        this.state = 'closed';
      });
      createGain() {
        return {
          gain: {
            setValueAtTime: (val: number) => gainValues.push(val),
            linearRampToValueAtTime: () => {},
            exponentialRampToValueAtTime: () => {},
          },
          connect: () => {},
        };
      }
      createOscillator() {
        oscCount++;
        return {
          type: 'sine',
          frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
          connect: () => {},
          start: () => {},
          stop: () => {},
        };
      }
      createBuffer(_ch: number, len: number) {
        return { getChannelData: () => new Float32Array(len) };
      }
      createBufferSource() {
        bufSrcCount++;
        return { buffer: null, connect: () => {}, start: () => {}, stop: () => {} };
      }
      createBiquadFilter() {
        return {
          type: 'lowpass',
          frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
          connect: () => {},
        };
      }
    }

    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    let perfMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => perfMs);

    const sm = new SoundManager({
      masterVolume: 0.8,
      muted: false,
      cameraShake: true,
      damageNumbers: true,
      quality: 'high',
    });

    // Safe no-op before unlock
    sm.playTowerBuild();
    expect(oscCount).toBe(0);

    sm.unlock();
    expect(resumedCount).toBe(1);
    // Simulate resume settling to running state
    (sm as unknown as { ctx: FakeAudioContext }).ctx.state = 'running';

    // Rapid duplicate archer shots within 65ms throttle are collapsed into 1 oscillator
    sm.playFire('archer');
    sm.playFire('archer');
    expect(oscCount).toBe(1);

    // Muted suppresses audio and sets gain 0
    sm.updateSettings({
      masterVolume: 0.8,
      muted: true,
      cameraShake: true,
      damageNumbers: true,
      quality: 'high',
    });
    expect(gainValues[gainValues.length - 1]).toBe(0);
    perfMs += 500;
    sm.playTowerUpgrade();
    expect(oscCount).toBe(1);

    // Unmute and test full EventBus binding + unbind
    sm.updateSettings({
      masterVolume: 0.5,
      muted: false,
      cameraShake: true,
      damageNumbers: true,
      quality: 'high',
    });
    const bus = new EventBus();
    const unbind = sm.bindEvents(bus);

    const fireAll = (): void => {
      perfMs += 1000;
      bus.emit('towerBuilt', { towerId: 1, type: 'archer', tier: 1, x: 0, z: 0 });
      bus.emit('towerUpgraded', { towerId: 1, type: 'archer', tier: 2, x: 0, z: 0 });
      bus.emit('towerSold', { towerId: 1, type: 'archer', refund: 35, x: 0, z: 0 });
      bus.emit('towerFired', { towerId: 1, type: 'cannon', tier: 1, x: 0, y: 1, z: 0, yaw: 0 });
      bus.emit('towerFired', { towerId: 2, type: 'frost', tier: 1, x: 0, y: 1, z: 0, yaw: 0 });
      bus.emit('towerFired', { towerId: 3, type: 'tesla', tier: 1, x: 0, y: 1, z: 0, yaw: 0 });
      bus.emit('towerFired', { towerId: 4, type: 'mortar', tier: 1, x: 0, y: 1, z: 0, yaw: 0 });
      bus.emit('projectileImpact', { towerType: 'mortar', x: 0, y: 0, z: 0, radius: 2, isBossHit: false });
      bus.emit('projectileImpact', { towerType: 'frost', x: 0, y: 0, z: 0, radius: 1.6, isBossHit: false });
      bus.emit('enemyKilled', { enemyId: 1, enemyType: 'grunt', reward: 4, x: 0, y: 0, z: 0 });
      bus.emit('enemyLeaked', { enemyType: 'grunt', livesLost: 1, x: 0, y: 0, z: 0 });
      bus.emit('enemySplit', { parentUid: 2, x: 0, y: 0, z: 0, count: 2 });
      bus.emit('bossPulse', { x: 0, y: 0, z: 0, radius: 7, stunnedTowerIds: [1] });
      bus.emit('bossSummon', { x: 0, y: 0, z: 0, count: 2 });
      bus.emit('abilityTargeted', { abilityId: 'meteor', x: 0, z: 0, radius: 3.4 });
      bus.emit('meteorImpact', { x: 0, y: 0, z: 0, radius: 3.4 });
      bus.emit('overchargeActivated', { duration: 7, cleansedTowerIds: [1] });
      bus.emit('waveStarted', { waveIndex: 0, totalWaves: 10, earlyBonus: 0 });
      bus.emit('gameWon', { stars: 3, livesRemaining: 20 });
      perfMs += 1000;
      bus.emit('gameLost', { waveIndex: 2 });
    };

    fireAll();
    const oscAfterEvents = oscCount;
    expect(oscAfterEvents).toBeGreaterThan(20);
    expect(bufSrcCount).toBeGreaterThan(3);

    // Unbind stops further event playback
    unbind();
    perfMs += 2000;
    bus.emit('towerBuilt', { towerId: 2, type: 'archer', tier: 1, x: 0, z: 0 });
    expect(oscCount).toBe(oscAfterEvents);

    sm.dispose();
    expect(closedCount).toBe(1);

    // Safe no-op when window lacks AudioContext, and webkitAudioContext fallback works cleanly
    vi.stubGlobal('window', {});
    const noAudioSm = new SoundManager({
      masterVolume: 0.7,
      muted: false,
      cameraShake: true,
      damageNumbers: true,
      quality: 'high',
    });
    expect(() => {
      noAudioSm.unlock();
      noAudioSm.playTowerBuild();
      noAudioSm.dispose();
    }).not.toThrow();

    vi.stubGlobal('window', { webkitAudioContext: FakeAudioContext });
    const webkitSm = new SoundManager({
      masterVolume: 0.7,
      muted: false,
      cameraShake: true,
      damageNumbers: true,
      quality: 'high',
    });
    webkitSm.unlock();
    expect(resumedCount).toBe(2);
    webkitSm.dispose();
  });
});

describe('InputManager pointer, pinch, wheel, keyboard, and cleanup', () => {
  let mockWin: MockEventTarget;
  let canvas: MockCanvas;

  beforeEach(() => {
    mockWin = new MockEventTarget();
    canvas = new MockCanvas();
    vi.stubGlobal('window', mockWin);
    vi.stubGlobal('HTMLInputElement', MockInputElement);
    vi.stubGlobal('HTMLTextAreaElement', MockTextAreaElement);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createHandlers(): { handlers: InputHandlers; log: Array<[string, ...unknown[]]> } {
    const log: Array<[string, ...unknown[]]> = [];
    const handlers: InputHandlers = {
      onPanScreenDelta: (dx, dy) => log.push(['pan', dx, dy]),
      onZoomDelta: (d, nx, ny) => log.push(['zoom', d, nx, ny]),
      onRotateCamera: (dir) => log.push(['rotate', dir]),
      onPointerMoveNdc: (nx, ny) => log.push(['move', nx, ny]),
      onPointerLeave: () => log.push(['leave']),
      onPrimaryTapNdc: (nx, ny, shift) => log.push(['tap', nx, ny, shift]),
      onSecondaryAction: (src) => log.push(['secondary', src]),
      onHotkeyTower: (idx) => log.push(['towerKey', idx]),
      onHotkeyAbility: (id) => log.push(['abilityKey', id]),
      onToggleAutoWave: () => log.push(['autoWave']),
      onToggleRoutes: () => log.push(['routes']),
      onTowerActionHotkey: (act) => {
        log.push(['towerAction', act]);
        return true;
      },
      onTogglePause: () => log.push(['pause']),
      onKeyPanState: (x, z) => log.push(['keyPan', x, z]),
    };
    return { handlers, log };
  }

  it('distinguishes primary tap vs drag, right click, pinch zoom, and wheel zoom', () => {
    const { handlers, log } = createHandlers();
    const mgr = new InputManager(canvas as unknown as HTMLCanvasElement, handlers);

    // Center tap at (200, 100) with tiny sub-threshold jitter (202, 101) => NDC (~0.02, -0.02)
    canvas.dispatch('pointerdown', { pointerId: 1, target: canvas, clientX: 200, clientY: 100, button: 0 });
    mockWin.dispatch('pointerup', { pointerId: 1, clientX: 202, clientY: 101, button: 0, shiftKey: true });
    expect(log).toHaveLength(1);
    expect(log[0][0]).toBe('tap');
    expect(log[0][1]).toBeCloseTo(0.02, 5);
    expect(log[0][2]).toBeCloseTo(-0.02, 5);
    expect(log[0][3]).toBe(true);

    // Right click triggers secondary action
    canvas.dispatch('pointerdown', { pointerId: 2, target: canvas, clientX: 200, clientY: 100, button: 2 });
    mockWin.dispatch('pointerup', { pointerId: 2, clientX: 200, clientY: 100, button: 2, shiftKey: false });
    expect(log).toContainEqual(['secondary', 'rightClick']);

    // Drag beyond dragThresholdPx pans instead of tapping
    log.length = 0;
    canvas.dispatch('pointerdown', { pointerId: 3, target: canvas, clientX: 150, clientY: 80, button: 0 });
    mockWin.dispatch('pointermove', { pointerId: 3, target: canvas, clientX: 170, clientY: 95 });
    mockWin.dispatch('pointerup', { pointerId: 3, clientX: 170, clientY: 95, button: 0, shiftKey: false });
    expect(log.some((e) => e[0] === 'pan')).toBe(true);
    expect(log.some((e) => e[0] === 'tap')).toBe(false);

    // Two-finger pinch pans & zooms
    log.length = 0;
    canvas.dispatch('pointerdown', { pointerId: 10, target: canvas, clientX: 180, clientY: 100, button: 0 });
    canvas.dispatch('pointerdown', { pointerId: 11, target: canvas, clientX: 220, clientY: 100, button: 0 });
    mockWin.dispatch('pointermove', { pointerId: 11, target: canvas, clientX: 250, clientY: 100 });
    expect(log.some((e) => e[0] === 'zoom' && (e[1] as number) > 0)).toBe(true);
    mockWin.dispatch('pointerup', { pointerId: 10, clientX: 180, clientY: 100, button: 0 });
    mockWin.dispatch('pointerup', { pointerId: 11, clientX: 250, clientY: 100, button: 0 });

    // Wheel zoom calls preventDefault and forwards clamped zoom delta
    log.length = 0;
    let wheelPrevented = false;
    canvas.dispatch('wheel', {
      target: canvas,
      clientX: 200,
      clientY: 100,
      deltaY: -100,
      preventDefault: () => {
        wheelPrevented = true;
      },
    });
    expect(wheelPrevented).toBe(true);
    expect(log[0][0]).toBe('zoom');
    expect(log[0][1]).toBeCloseTo(BALANCE.camera.zoomStep, 5);

    mgr.dispose();
  });

  it('handles hotkeys, modal/disabled Escape rules, blur reset, and full listener disposal', () => {
    const { handlers, log } = createHandlers();
    const mgr = new InputManager(canvas as unknown as HTMLCanvasElement, handlers);

    const sendKey = (extra: Record<string, unknown>): { prevented: boolean } => {
      let prevented = false;
      mockWin.dispatch('keydown', {
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        repeat: false,
        target: canvas,
        preventDefault: () => {
          prevented = true;
        },
        ...extra,
      });
      return { prevented };
    };

    sendKey({ code: 'Digit1', key: '1' });
    sendKey({ code: 'Digit5', key: '5' });
    sendKey({ code: 'KeyQ', key: 'q' });
    sendKey({ code: 'KeyE', key: 'e' });
    sendKey({ code: 'KeyF', key: 'f' });
    sendKey({ code: 'KeyG', key: 'g' });
    sendKey({ code: 'KeyX', key: 'x' });
    sendKey({ code: 'KeyR', key: 'r' });
    expect(sendKey({ code: 'Space', key: ' ' }).prevented).toBe(true);
    expect(sendKey({ code: 'KeyU', key: 'u' }).prevented).toBe(true);
    expect(sendKey({ code: 'KeyT', key: 't' }).prevented).toBe(true);
    expect(sendKey({ code: 'Backspace', key: 'Backspace' }).prevented).toBe(true);

    expect(log).toContainEqual(['towerKey', 0]);
    expect(log).toContainEqual(['towerKey', 4]);
    expect(log).toContainEqual(['rotate', -1]);
    expect(log).toContainEqual(['rotate', 1]);
    expect(log).toContainEqual(['abilityKey', 'meteor']);
    expect(log).toContainEqual(['abilityKey', 'overcharge']);
    expect(log).toContainEqual(['autoWave']);
    expect(log).toContainEqual(['routes']);
    expect(log).toContainEqual(['pause']);
    expect(log).toContainEqual(['towerAction', 'upgrade']);
    expect(log).toContainEqual(['towerAction', 'target']);
    expect(log).toContainEqual(['towerAction', 'sell']);

    // Ctrl/Meta/Alt and HTMLInputElement targets are ignored
    log.length = 0;
    sendKey({ code: 'KeyF', key: 'f', ctrlKey: true });
    sendKey({ code: 'KeyG', key: 'g', target: new MockInputElement() });
    expect(log).toEqual([]);

    // WASD + keyup + blur reset
    sendKey({ code: 'KeyW', key: 'w' });
    sendKey({ code: 'KeyD', key: 'd' });
    expect(log).toContainEqual(['keyPan', 1, -1]);
    mockWin.dispatch('blur', {});
    expect(log).toContainEqual(['keyPan', 0, 0]);
    expect(log).toContainEqual(['leave']);

    // When modal is open & input disabled, resetTransientState zeroes pan and Escape still emits secondary
    log.length = 0;
    mgr.setEnabled(false);
    mgr.setModalOpen(true);
    expect(log).toEqual([
      ['keyPan', 0, 0],
      ['keyPan', 0, 0],
    ]);
    log.length = 0;
    sendKey({ code: 'Digit1', key: '1' });
    sendKey({ code: 'Escape', key: 'Escape' });
    expect(log).toEqual([['secondary', 'escape']]);

    mgr.dispose();
    expect(canvas.listenerCount('pointerdown')).toBe(0);
    expect(mockWin.listenerCount('keydown')).toBe(0);
    expect(mockWin.listenerCount('blur')).toBe(0);
  });

  it('handles pointercancel, contextmenu prevention, key repeat filtering, arrow panning, and middle-mouse drag', () => {
    const { handlers, log } = createHandlers();
    const mgr = new InputManager(canvas as unknown as HTMLCanvasElement, handlers);

    // pointercancel during an active drag cleans up pointer & resets drag state so next tap works cleanly
    canvas.dispatch('pointerdown', { pointerId: 20, target: canvas, clientX: 150, clientY: 80, button: 0 });
    mockWin.dispatch('pointermove', { pointerId: 20, target: canvas, clientX: 170, clientY: 80 });
    mockWin.dispatch('pointercancel', { pointerId: 20, clientX: 170, clientY: 80, button: 0 });
    expect(log.some((e) => e[0] === 'tap')).toBe(false);

    canvas.dispatch('pointerdown', { pointerId: 22, target: canvas, clientX: 200, clientY: 100, button: 0 });
    mockWin.dispatch('pointerup', { pointerId: 22, clientX: 200, clientY: 100, button: 0 });
    expect(log.filter((e) => e[0] === 'tap')).toHaveLength(1);

    // middle-mouse drag (button === 1) pans immediately even on 1px move
    log.length = 0;
    canvas.dispatch('pointerdown', { pointerId: 21, target: canvas, clientX: 150, clientY: 80, button: 1 });
    mockWin.dispatch('pointermove', { pointerId: 21, target: canvas, clientX: 151, clientY: 80 });
    mockWin.dispatch('pointerup', { pointerId: 21, clientX: 151, clientY: 80, button: 1 });
    expect(log).toContainEqual(['pan', 1, 0]);
    expect(log.some((e) => e[0] === 'tap')).toBe(false);

    // contextmenu calls preventDefault only on canvas
    let canvasCtxPrevented = false;
    canvas.dispatch('contextmenu', {
      target: canvas,
      preventDefault: () => {
        canvasCtxPrevented = true;
      },
    });
    let otherCtxPrevented = false;
    canvas.dispatch('contextmenu', {
      target: {},
      preventDefault: () => {
        otherCtxPrevented = true;
      },
    });
    expect(canvasCtxPrevented).toBe(true);
    expect(otherCtxPrevented).toBe(false);

    // Key repeat ignored; Arrow keys pan and keyup clears
    log.length = 0;
    mockWin.dispatch('keydown', {
      code: 'KeyQ',
      key: 'q',
      repeat: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      target: canvas,
      preventDefault: () => {},
    });
    expect(log).toEqual([]);

    const dispatchArrow = (type: 'keydown' | 'keyup', code: string): void => {
      mockWin.dispatch(type, {
        code,
        key: code,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: canvas,
        preventDefault: () => {},
      });
    };
    dispatchArrow('keydown', 'ArrowUp');
    dispatchArrow('keydown', 'ArrowLeft');
    expect(log).toContainEqual(['keyPan', -1, -1]);
    dispatchArrow('keyup', 'ArrowUp');
    dispatchArrow('keyup', 'ArrowLeft');
    expect(log[log.length - 1]).toEqual(['keyPan', 0, 0]);

    mgr.dispose();
  });
});
