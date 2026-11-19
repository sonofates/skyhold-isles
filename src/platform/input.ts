import type { AbilityId } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { DoubleTapDetector, FLING_MIN_SPEED, LONG_PRESS_MS, VelocityTracker } from './gestures.ts';

export interface InputHandlers {
  onPanScreenDelta: (dx: number, dy: number) => void;
  onZoomDelta: (delta: number, ndcX: number, ndcY: number) => void;
  onRotateCamera: (dir: -1 | 1) => void;
  onPointerMoveNdc: (ndcX: number, ndcY: number, clientX: number, clientY: number) => void;
  /** Pointer left the canvas or the window lost focus: clear hover / ghost / tooltip. */
  onPointerLeave: () => void;
  onPrimaryTapNdc: (ndcX: number, ndcY: number, shiftKey: boolean) => void;
  onSecondaryAction: (source: 'escape' | 'rightClick') => void;
  onHotkeyTower: (index: number) => void;
  onHotkeyAbility: (abilityId: AbilityId) => void;
  onToggleAutoWave: () => void;
  onToggleRoutes: () => void;
  onTowerActionHotkey: (action: 'upgrade' | 'sell' | 'target') => boolean;
  onTogglePause: () => void;
  onKeyPanState: (panX: number, panZ: number) => void;
  /** A one-pointer drag crossed the drag threshold (camera pan starts). */
  onDragStart?: () => void;
  /** A finger is down again (cancels a running camera fling). */
  onGestureStart?: () => void;
  /** Finger held still on the map for LONG_PRESS_MS. */
  onLongPressNdc?: (ndcX: number, ndcY: number) => void;
  /** Second quick tap. Return true when handled (the tap is then not delivered as a normal tap). */
  onDoubleTapNdc?: (ndcX: number, ndcY: number) => boolean;
  /** One-finger drag released with speed (px/s): camera inertia. */
  onFling?: (vx: number, vy: number) => void;
  /** Re-centre / re-fit the camera (C key). */
  onRecenter?: () => void;
}

interface ActivePointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
}

/**
 * Handles mouse, wheel, keyboard, and multi-touch gestures cleanly without interfering with DOM UI.
 */
export class InputManager {
  private canvas: HTMLCanvasElement;
  private handlers: InputHandlers;
  private pointers = new Map<number, ActivePointer>();
  private isDragging = false;
  private dragButton = -1;
  private prevPinchDist = 0;
  private prevMidX = 0;
  private prevMidY = 0;
  private keysDown = new Set<string>();
  private readonly velocity = new VelocityTracker();
  private readonly doubleTap = new DoubleTapDetector();
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressFired = false;
  private pinched = false;
  private enabled = true;
  private modalOpen = false;
  private cleanupFns: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, handlers: InputHandlers) {
    this.canvas = canvas;
    this.handlers = handlers;
    this.bindEvents();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.resetTransientState();
    }
  }

  setModalOpen(open: boolean): void {
    this.modalOpen = open;
    if (open) {
      this.resetTransientState();
    }
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private resetTransientState(): void {
    this.clearLongPress();
    this.longPressFired = false;
    this.pinched = false;
    this.dragButton = -1;
    this.keysDown.clear();
    this.pointers.clear();
    this.isDragging = false;
    this.handlers.onKeyPanState(0, 0);
  }

  private toNdc(clientX: number, clientY: number): { ndcX: number; ndcY: number } {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    return {
      ndcX: ((clientX - rect.left) / w) * 2 - 1,
      ndcY: -((clientY - rect.top) / h) * 2 + 1,
    };
  }

  private bindEvents(): void {
    const onPointerDown = (e: PointerEvent): void => {
      if (!this.enabled || this.modalOpen) return;
      if (e.target !== this.canvas) return;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Capture can fail for already-released pointers; dragging still works via window listeners.
      }
      this.pointers.set(e.pointerId, {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
      });

      this.handlers.onGestureStart?.();
      if (this.pointers.size === 1) {
        this.isDragging = false;
        this.dragButton = e.button;
        this.longPressFired = false;
        this.pinched = false;
        this.velocity.reset();
        this.velocity.add(e.clientX, e.clientY, e.timeStamp);
        this.clearLongPress();
        if (e.pointerType === 'touch' && e.button === 0 && this.handlers.onLongPressNdc) {
          const px = e.clientX;
          const py = e.clientY;
          this.longPressTimer = setTimeout(() => {
            this.longPressTimer = null;
            if (this.pointers.size !== 1 || this.isDragging || !this.enabled || this.modalOpen) return;
            this.longPressFired = true;
            const ndc = this.toNdc(px, py);
            this.handlers.onLongPressNdc?.(ndc.ndcX, ndc.ndcY);
          }, LONG_PRESS_MS);
        }
      } else if (this.pointers.size === 2) {
        this.clearLongPress();
        this.pinched = true;
        this.isDragging = true;
        const pts = Array.from(this.pointers.values());
        this.prevPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        this.prevMidX = (pts[0].x + pts[1].x) * 0.5;
        this.prevMidY = (pts[0].y + pts[1].y) * 0.5;
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (!this.enabled || this.modalOpen) return;

      const tracked = this.pointers.get(e.pointerId);
      if (tracked) {
        const dx = e.clientX - tracked.x;
        const dy = e.clientY - tracked.y;
        tracked.x = e.clientX;
        tracked.y = e.clientY;

        if (this.pointers.size === 1) {
          const totalMoved = Math.hypot(e.clientX - tracked.startX, e.clientY - tracked.startY);
          // Fingers wobble more than mice: give touch taps a little extra slop.
          const slop =
            e.pointerType === 'touch'
              ? Math.max(BALANCE.camera.dragThresholdPx, 10)
              : BALANCE.camera.dragThresholdPx;
          if (!this.isDragging && (totalMoved > slop || this.dragButton === 1)) {
            this.isDragging = true;
            this.clearLongPress();
            this.handlers.onDragStart?.();
          }
          if (this.isDragging && !this.longPressFired && (this.dragButton === 0 || this.dragButton === 1 || this.dragButton === 2)) {
            this.velocity.add(e.clientX, e.clientY, e.timeStamp);
            this.handlers.onPanScreenDelta(dx, dy);
          }
        } else if (this.pointers.size === 2) {
          const pts = Array.from(this.pointers.values());
          const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
          const midX = (pts[0].x + pts[1].x) * 0.5;
          const midY = (pts[0].y + pts[1].y) * 0.5;

          const panDx = midX - this.prevMidX;
          const panDy = midY - this.prevMidY;
          if (Math.abs(panDx) > 0.1 || Math.abs(panDy) > 0.1) {
            this.handlers.onPanScreenDelta(panDx, panDy);
          }

          if (this.prevPinchDist > 4) {
            const pinchDelta = (dist - this.prevPinchDist) * 0.005;
            if (Math.abs(pinchDelta) > 0.0005) {
              const ndc = this.toNdc(midX, midY);
              this.handlers.onZoomDelta(pinchDelta, ndc.ndcX, ndc.ndcY);
            }
          }
          this.prevPinchDist = dist;
          this.prevMidX = midX;
          this.prevMidY = midY;
        }
      }

      if (e.target === this.canvas || tracked) {
        const ndc = this.toNdc(e.clientX, e.clientY);
        this.handlers.onPointerMoveNdc(ndc.ndcX, ndc.ndcY, e.clientX, e.clientY);
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      const tracked = this.pointers.get(e.pointerId);
      this.clearLongPress();
      const live = this.enabled && !this.modalOpen && e.type === 'pointerup';
      // A cancelled touch (palm rejection, the browser claiming the gesture) is never a tap.
      if (
        tracked &&
        e.type === 'pointerup' &&
        this.pointers.size === 1 &&
        !this.isDragging &&
        this.enabled &&
        !this.modalOpen
      ) {
        const ndc = this.toNdc(e.clientX, e.clientY);
        if (this.longPressFired) {
          // The long press already acted; lifting the finger is not a tap.
        } else if (e.button === 0) {
          const dbl =
            e.pointerType === 'touch' && this.doubleTap.register(e.clientX, e.clientY, e.timeStamp);
          if (!(dbl && this.handlers.onDoubleTapNdc?.(ndc.ndcX, ndc.ndcY))) {
            this.handlers.onPrimaryTapNdc(ndc.ndcX, ndc.ndcY, e.shiftKey);
          }
        } else if (e.button === 2) {
          this.handlers.onSecondaryAction('rightClick');
        }
      } else if (
        tracked &&
        live &&
        this.pointers.size === 1 &&
        this.isDragging &&
        !this.pinched &&
        e.pointerType === 'touch'
      ) {
        this.velocity.add(e.clientX, e.clientY, e.timeStamp);
        const { vx, vy } = this.velocity.velocity();
        if (Math.hypot(vx, vy) >= FLING_MIN_SPEED) this.handlers.onFling?.(vx, vy);
      }
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 2) {
        const pts = Array.from(this.pointers.values());
        this.prevPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        this.prevMidX = (pts[0].x + pts[1].x) * 0.5;
        this.prevMidY = (pts[0].y + pts[1].y) * 0.5;
      } else if (this.pointers.size === 1) {
        this.velocity.reset();
      } else if (this.pointers.size === 0) {
        this.isDragging = false;
        this.dragButton = -1;
        this.longPressFired = false;
        this.pinched = false;
      }
    };

    const onWheel = (e: WheelEvent): void => {
      if (!this.enabled || this.modalOpen) return;
      if (e.target !== this.canvas) return;
      e.preventDefault();
      if (!Number.isFinite(e.deltaY) || e.deltaY === 0) return;
      const ndc = this.toNdc(e.clientX, e.clientY);
      const direction = e.deltaY < 0 ? 1 : -1;
      const magnitude = Math.min(1.6, Math.max(0.4, Math.abs(e.deltaY) / 100));
      this.handlers.onZoomDelta(direction * BALANCE.camera.zoomStep * magnitude, ndc.ndcX, ndc.ndcY);
    };

    const onContextMenu = (e: MouseEvent): void => {
      if (e.target === this.canvas) {
        e.preventDefault();
      }
    };

    const updateKeyPan = (): void => {
      let px = 0;
      let pz = 0;
      if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) pz -= 1;
      if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) pz += 1;
      if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) px -= 1;
      if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) px += 1;
      this.handlers.onKeyPanState(px, pz);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      // Leave browser/OS shortcuts (Cmd+R, Ctrl+1..5, Cmd+S, Alt+…) untouched.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Escape must close an open modal even when gameplay input is disabled
      // (e.g. Settings opened from the main menu).
      if (e.code === 'Escape' && !e.repeat && (this.enabled || this.modalOpen)) {
        this.handlers.onSecondaryAction('escape');
        return;
      }
      if (!this.enabled || this.modalOpen) return;

      if (e.code === 'KeyC' && !e.repeat) {
        this.handlers.onRecenter?.();
        return;
      }
      if (e.code === 'KeyQ' && !e.repeat) {
        this.handlers.onRotateCamera(-1);
        return;
      }
      if (e.code === 'KeyE' && !e.repeat) {
        this.handlers.onRotateCamera(1);
        return;
      }
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        this.handlers.onTogglePause();
        return;
      }
      if (!e.repeat && e.key >= '1' && e.key <= '7') {
        this.handlers.onHotkeyTower(Number(e.key) - 1);
        return;
      }
      if (!e.repeat && e.code === 'KeyF') {
        this.handlers.onHotkeyAbility('meteor');
        return;
      }
      if (!e.repeat && e.code === 'KeyG') {
        this.handlers.onHotkeyAbility('overcharge');
        return;
      }
      if (!e.repeat && e.code === 'KeyX') {
        this.handlers.onToggleAutoWave();
        return;
      }
      if (!e.repeat && e.code === 'KeyR') {
        this.handlers.onToggleRoutes();
        return;
      }
      if (!e.repeat && e.code === 'KeyU' && this.handlers.onTowerActionHotkey('upgrade')) {
        e.preventDefault();
        return;
      }
      if (!e.repeat && e.code === 'KeyT' && this.handlers.onTowerActionHotkey('target')) {
        e.preventDefault();
        return;
      }
      if (
        !e.repeat &&
        (e.code === 'Delete' || e.code === 'Backspace') &&
        this.handlers.onTowerActionHotkey('sell')
      ) {
        e.preventDefault();
        return;
      }

      if (
        e.code === 'KeyW' ||
        e.code === 'KeyA' ||
        e.code === 'KeyS' ||
        e.code === 'KeyD' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight'
      ) {
        this.keysDown.add(e.code);
        updateKeyPan();
      }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      if (this.keysDown.delete(e.code)) {
        updateKeyPan();
      }
    };

    const onBlur = (): void => {
      this.resetTransientState();
      this.handlers.onPointerLeave();
    };

    const onPointerLeave = (e: PointerEvent): void => {
      // While a drag holds pointer capture the pointer is still logically "on" the canvas.
      if (this.pointers.has(e.pointerId)) return;
      this.handlers.onPointerLeave();
    };

    this.canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', onContextMenu);
    this.canvas.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    this.cleanupFns.push(
      () => this.canvas.removeEventListener('pointerdown', onPointerDown),
      () => window.removeEventListener('pointermove', onPointerMove),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => window.removeEventListener('pointercancel', onPointerUp),
      () => this.canvas.removeEventListener('wheel', onWheel),
      () => this.canvas.removeEventListener('contextmenu', onContextMenu),
      () => this.canvas.removeEventListener('pointerleave', onPointerLeave),
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
    );
  }

  dispose(): void {
    const hadKeyPan = this.keysDown.size > 0;
    this.clearLongPress();
    this.longPressFired = false;
    this.pinched = false;
    this.dragButton = -1;
    this.isDragging = false;
    this.keysDown.clear();
    this.pointers.clear();
    if (hadKeyPan) {
      this.handlers.onKeyPanState(0, 0);
    }
    for (let i = 0; i < this.cleanupFns.length; i++) {
      this.cleanupFns[i]();
    }
    this.cleanupFns.length = 0;
  }
}
