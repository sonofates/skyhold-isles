import { SoundManager } from '../audio/soundManager.ts';
import type { EventBus } from '../core/eventBus.ts';
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

/** One mixer per 2D document, shared by the world map, settings sheets and every run. */
export class Audio2D {
  readonly sound = new SoundManager(audioSettings2d());
  private muted: boolean | undefined;
  private volume = -1;
  private readonly listeners = new AbortController();

  constructor() {
    const options = { signal: this.listeners.signal };
    const unlock = () => {
      if (document.hidden) return;
      this.sync();
      this.sound.unlock();
    };
    // iOS touch activation is granted on release. Keep the handlers for interrupted contexts.
    for (const event of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
      document.addEventListener(event, unlock, { ...options, capture: true, passive: true });
    }
    const sync = () => this.sync();
    // Settings saves synchronously on toggle, slider drag and keyboard steps. Same-document
    // writes do not emit a storage event. Bubble after the control has written its value.
    document.addEventListener('click', sync, options);
    document.addEventListener('keydown', sync, options);
    document.addEventListener('pointerdown', sync, options);
    document.addEventListener('pointermove', e => {
      if (e.buttons && e.target instanceof Element && e.target.closest('[role=slider]')) sync();
    }, options);
    window.addEventListener('storage', sync, options);
    const visibility = () => {
      if (document.hidden) this.sound.suspendForBackground();
      else {
        sync();
        this.sound.resumeFromBackground();
      }
    };
    document.addEventListener('visibilitychange', visibility, options);
    window.addEventListener('pageshow', visibility, options);
    window.addEventListener('pagehide', e => {
      if (e.persisted) this.sound.suspendForBackground();
      else {
        this.listeners.abort();
        this.sound.dispose();
      }
    }, options);
  }

  sync(settings: AudioSettings2D = audioSettings2d()): void {
    if (this.muted === settings.muted && this.volume === settings.effectiveSfxVolume) return;
    this.muted = settings.muted;
    this.volume = settings.effectiveSfxVolume;
    this.sound.updateSettings({ muted: settings.muted, masterVolume: settings.effectiveSfxVolume });
  }
}
