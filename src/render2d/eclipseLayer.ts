import { Container, Sprite, Texture } from 'pixi.js';

/** Deep dusk violet laid over the whole map while the sun is eclipsed. */
const ECLIPSE_SHADE = 0x0e0820;
/** Peak darkness (alpha of the shade). The road and the foes must stay readable on a phone. */
const ECLIPSE_ALPHA = 0.42;
/** Seconds to fade in / out at the start / end of an eclipse. */
const FADE_IN_SEC = 0.6;
const FADE_OUT_SEC = 1.0;

/** The sim state the eclipse is drawn from (EnemySystem). */
export interface EclipseState {
  readonly eclipseTimer: number;
  readonly eclipseDuration: number;
}

/**
 * Eclipse Sovereign eclipse, chapter five: a screen-wide dusk shade over the map (below the HUD),
 * drawn from the sim's eclipse timer every frame, so a replay seek, a skip or the run end can never
 * leave the screen dark. Fades in over 0.6 s and out over the last second.
 */
export class EclipseLayer {
  readonly root = new Container();
  private readonly shade = new Sprite(Texture.WHITE);
  /** QA: current shade alpha (0 = clear sky). */
  alpha = 0;

  constructor() {
    this.shade.tint = ECLIPSE_SHADE;
    this.shade.visible = false;
    this.root.addChild(this.shade);
    this.root.eventMode = 'none';
  }

  sync(state: EclipseState, screenW: number, screenH: number): void {
    const left = state.eclipseTimer;
    const full = state.eclipseDuration;
    if (!(left > 0) || !(full > 0)) {
      this.alpha = 0;
      this.shade.visible = false;
      return;
    }
    const elapsed = full - left;
    const env = Math.min(1, elapsed / FADE_IN_SEC, left / FADE_OUT_SEC);
    this.alpha = ECLIPSE_ALPHA * Math.max(0, env);
    this.shade.visible = this.alpha > 0.005;
    this.shade.alpha = this.alpha;
    this.shade.position.set(0, 0);
    this.shade.width = screenW;
    this.shade.height = screenH;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
