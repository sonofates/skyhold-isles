import { SoundManager } from '../audio/soundManager.ts';
import type { EventBus } from '../core/eventBus.ts';
import { getPlatform, type PlatformAdapter } from '../platform/index.ts';
import { audioSettings2d, type AudioSettings2D } from './settings2d.ts';

export function screenPan(x: number, width: number): number {
  return width > 0 ? Math.max(-1, Math.min(1, 2 * x / width - 1)) : 0;
}

/** The shared score and SFX follow the same sim events in both renderers. Only the painted
 * view has screen-space stereo, individual death notes, and the barracks' two melee cues. */
export function bindAudio2D(
  events: EventBus,
  sound: SoundManager,
  panAt: (worldX: number) => number,
  soldierX: (id: number) => number | undefined,
): () => void {
  const spatial: Pick<EventBus, 'on'> = {
    on: (name, listener) => events.on(name, e => {
      const x = 'targetX' in e ? e.targetX : 'toX' in e ? e.toX : 'x' in e ? e.x : undefined;
      sound.setScreenPan(x === undefined ? 0 : panAt(x));
      listener(e);
    }),
  };
  const shared = sound.bindEvents(spatial, type => sound.playEnemyDeath(type));
  const swing = events.on('meleeSwing', e => {
    // Every duel has one soldier. Swing has IDs only, and the squad list is small.
    const x = soldierX(e.attacker === 'soldier' ? e.attackerId : e.targetId);
    sound.setScreenPan(x === undefined ? 0 : panAt(x));
    sound.playMeleeSwing();
  });
  const hit = spatial.on('meleeHit', e => sound.playMeleeHit(e.sweep));
  const lightning = events.on('lightningChain', e => {
    // Tesla resolves hitscan in the sim and never emits projectileImpact.
    if (e.points.length < 2) return;
    sound.setScreenPan(panAt(e.points[1].x));
    sound.playImpact('tesla');
  });
  return () => {
    shared();
    swing();
    hit();
    lightning();
  };
}

export interface BackgroundLifecycleDeps2D {
  readonly platform?: Pick<PlatformAdapter, 'onPause' | 'onResume'> & Partial<Pick<PlatformAdapter, 'onOverlayChange'>>;
  readonly doc?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  readonly win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  readonly onBackground: () => void;
  readonly onForeground?: () => void;
  readonly onOverlayPause?: () => void;
  readonly onUnload?: () => void;
}

export interface BackgroundLifecycleHandle2D {
  readonly inBackground: boolean;
  dispose(): void;
}

/**
 * Unifies native mobile backgrounding (`getPlatform().onPause` / `onResume`), browser tab/lock
 * visibility (`document.visibilitychange`, `pageshow`, `pagehide`), and Steam overlay pause.
 * Enters background as soon as either native app state or document visibility goes inactive, and
 * only fires `onForeground` once both are active again.
 */
export function bindBackgroundLifecycle2D(deps: BackgroundLifecycleDeps2D): BackgroundLifecycleHandle2D {
  const platform = deps.platform ?? getPlatform();
  const doc = deps.doc ?? (typeof document === 'undefined' ? undefined : document);
  const win = deps.win ?? (typeof window === 'undefined' ? undefined : window);
  let appPaused = false;
  let disposed = false;
  const computeBackground = (): boolean => appPaused || Boolean(doc?.hidden);
  let inBackground = computeBackground();

  const update = (forceBackground = false): void => {
    if (disposed) return;
    const next = forceBackground || computeBackground();
    if (next === inBackground) return;
    inBackground = next;
    if (inBackground) deps.onBackground();
    else deps.onForeground?.();
  };

  const offPause = platform.onPause(() => {
    appPaused = true;
    update();
  });
  const offResume = platform.onResume(() => {
    appPaused = false;
    update();
  });
  const offOverlay =
    platform.onOverlayChange?.((active) => {
      if (!disposed && active) deps.onOverlayPause?.();
    }) ?? (() => undefined);

  const onVisibility = (): void => update();
  const onPageHide = (e: Event): void => {
    if (disposed) return;
    if ((e as PageTransitionEvent).persisted) update(true);
    else deps.onUnload?.();
  };

  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('pageshow', onVisibility);
  win?.addEventListener('pagehide', onPageHide);

  return {
    get inBackground(): boolean {
      return inBackground;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      offPause();
      offResume();
      offOverlay();
      doc?.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('pageshow', onVisibility);
      win?.removeEventListener('pagehide', onPageHide);
    },
  };
}

/** One mixer per 2D document, shared by the world map, settings sheets and every run. */
export class Audio2D {
  readonly sound = new SoundManager(audioSettings2d());
  private muted: boolean | undefined;
  private volume = -1;
  private readonly listeners = new AbortController();
  private readonly lifecycle: BackgroundLifecycleHandle2D;

  constructor(deps: {
    readonly platform?: Pick<PlatformAdapter, 'onPause' | 'onResume'> & Partial<Pick<PlatformAdapter, 'onOverlayChange'>>;
    readonly doc?: Document;
    readonly win?: Window;
  } = {}) {
    const doc = deps.doc ?? document;
    const win = deps.win ?? window;
    const options = { signal: this.listeners.signal };
    this.lifecycle = bindBackgroundLifecycle2D({
      platform: deps.platform,
      doc,
      win,
      onBackground: () => this.sound.suspendForBackground(),
      onForeground: () => {
        this.sync();
        this.sound.resumeFromBackground();
      },
      onUnload: () => this.dispose(),
    });
    if (this.lifecycle.inBackground) this.sound.suspendForBackground();

    const unlock = () => {
      if (this.lifecycle.inBackground) return;
      this.sync();
      this.sound.unlock();
    };
    // iOS touch activation is granted on release. Keep the handlers for interrupted contexts.
    for (const event of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
      doc.addEventListener(event, unlock, { ...options, capture: true, passive: true });
    }
    const sync = () => this.sync();
    // Settings saves synchronously on toggle, slider drag and keyboard steps. Same-document
    // writes do not emit a storage event. Bubble after the control has written its value.
    doc.addEventListener('click', sync, options);
    doc.addEventListener('keydown', sync, options);
    doc.addEventListener('pointerdown', sync, options);
    doc.addEventListener('pointermove', e => {
      if ((e as PointerEvent).buttons && e.target instanceof Element && e.target.closest('[role=slider]')) sync();
    }, options);
    win.addEventListener('storage', sync, options);
  }

  sync(settings: AudioSettings2D = audioSettings2d()): void {
    if (this.muted === settings.muted && this.volume === settings.effectiveSfxVolume) return;
    this.muted = settings.muted;
    this.volume = settings.effectiveSfxVolume;
    this.sound.updateSettings({ muted: settings.muted, masterVolume: settings.effectiveSfxVolume });
  }

  dispose(): void {
    this.lifecycle.dispose();
    this.listeners.abort();
    this.sound.dispose();
  }
}
