import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputManager, type InputHandlers } from '../../src/platform/input.ts';

type Listener = (e: unknown) => void;

function makeEnv() {
  const winListeners = new Map<string, Listener[]>();
  const canvas = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setPointerCapture: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
  };
  const canvasListeners = new Map<string, Listener>();
  canvas.addEventListener.mockImplementation((type: string, fn: Listener) => {
    canvasListeners.set(type, fn);
  });
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: Listener) => {
      winListeners.set(type, [...(winListeners.get(type) ?? []), fn]);
    },
    removeEventListener: vi.fn(),
  });
  const handlers = {
    onPanScreenDelta: vi.fn(),
    onZoomDelta: vi.fn(),
    onRotateCamera: vi.fn(),
    onPointerMoveNdc: vi.fn(),
    onPointerLeave: vi.fn(),
    onPrimaryTapNdc: vi.fn(),
    onSecondaryAction: vi.fn(),
    onHotkeyTower: vi.fn(),
    onHotkeyAbility: vi.fn(),
    onToggleAutoWave: vi.fn(),
    onToggleRoutes: vi.fn(),
    onTowerActionHotkey: vi.fn(() => false),
    onTogglePause: vi.fn(),
    onKeyPanState: vi.fn(),
  } satisfies InputHandlers;
  const input = new InputManager(canvas as unknown as HTMLCanvasElement, handlers);
  const ev = (type: string, id: number, x: number, y: number, t: number) => ({
    type,
    pointerId: id,
    pointerType: 'touch',
    button: 0,
    clientX: x,
    clientY: y,
    timeStamp: t,
    shiftKey: false,
    target: canvas,
  });
  const fire = (type: string, e: unknown): void => {
    if (type === 'pointerdown') canvasListeners.get(type)?.(e);
    else for (const fn of winListeners.get(type) ?? []) fn(e);
  };
  return { input, handlers, ev, fire };
}

describe('InputManager tap resolution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('delivers a tap on pointerup', () => {
    const { handlers, ev, fire } = makeEnv();
    fire('pointerdown', ev('pointerdown', 1, 100, 100, 0));
    fire('pointerup', ev('pointerup', 1, 100, 100, 50));
    expect(handlers.onPrimaryTapNdc).toHaveBeenCalledTimes(1);
  });

  it('does not deliver a tap when the touch is cancelled', () => {
    const { handlers, ev, fire } = makeEnv();
    fire('pointerdown', ev('pointerdown', 1, 100, 100, 0));
    fire('pointercancel', ev('pointercancel', 1, 100, 100, 50));
    expect(handlers.onPrimaryTapNdc).not.toHaveBeenCalled();
    // State is clean afterwards: the next real tap still works.
    fire('pointerdown', ev('pointerdown', 2, 120, 120, 600));
    fire('pointerup', ev('pointerup', 2, 120, 120, 650));
    expect(handlers.onPrimaryTapNdc).toHaveBeenCalledTimes(1);
  });

  it('does not tap after a drag or a pinch', () => {
    const { handlers, ev, fire } = makeEnv();
    fire('pointerdown', ev('pointerdown', 1, 100, 100, 0));
    fire('pointermove', ev('pointermove', 1, 160, 100, 20));
    fire('pointerup', ev('pointerup', 1, 160, 100, 40));
    expect(handlers.onPrimaryTapNdc).not.toHaveBeenCalled();

    fire('pointerdown', ev('pointerdown', 2, 100, 300, 1000));
    fire('pointerdown', ev('pointerdown', 3, 200, 300, 1000));
    fire('pointerup', ev('pointerup', 2, 100, 300, 1100));
    fire('pointerup', ev('pointerup', 3, 200, 300, 1110));
    expect(handlers.onPrimaryTapNdc).not.toHaveBeenCalled();
  });
});
