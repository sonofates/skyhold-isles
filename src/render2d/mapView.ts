import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Level2DLayout } from '../data/levels/types.ts';
import { playfieldBoxes, playfieldShapes } from './playfield.ts';
import type { Rect } from './uiLayout.ts';
import { computeMapFit, fitAroundHud, type MapFit } from './viewFit.ts';

/**
 * Painted map + world container. Children of `world` are positioned in map image px; the
 * container carries the fit (scale + offset), so sprite sizes stay locked to the painting.
 * Letterbox bands (the safe-area clamp, or the map shrunk to clear the HUD dock) are filled with
 * the map's own outermost pixels stretched across them, dimmed — no flat colour bars, no repeats.
 */
/** Edge strip (layout px) stretched across the letterbox bands. */
const EDGE_PX = 2;

export class MapView {
  readonly root = new Container();
  /** Map-px space: everything that lives on the map goes in here. */
  readonly world = new Container();
  private readonly bands = new Container();
  private readonly mapSprite: Sprite;
  private readonly bandSprites: Sprite[] = [];
  fit: MapFit;
  private texture: Texture;
  readonly layout: Level2DLayout;

  constructor(texture: Texture, layout: Level2DLayout) {
    this.texture = texture;
    this.layout = layout;
    this.mapSprite = new Sprite(texture);
    this.world.addChild(this.mapSprite);
    this.root.addChild(this.bands, this.world);
    // Left, right, top, bottom, then the four corners.
    for (let i = 0; i < 8; i++) {
      const s = new Sprite(Texture.EMPTY);
      s.visible = false;
      s.tint = 0xc4bdb2; // dimmed: reads as the frame around the island, not more island
      this.bandSprites.push(s);
      this.bands.addChild(s);
    }
    this.fit = computeMapFit(1, 1, layout.imageSize[0], layout.imageSize[1], layout.safeArea);
  }

  /** Texels per layout px of the current map texture (resolution variant, see mapVariant.ts). */
  get texelScale(): number {
    // source px, not texture units: Pixi reads `@1.5x` in a file name as a resolution suffix
    return this.texture.source.pixelWidth / this.imageW;
  }

  /** The current map texture's source (QA: its pixel size). */
  get textureSource(): Texture['source'] {
    return this.texture.source;
  }

  /** Swaps in another bake of the same map (e.g. a bigger variant after the window grew). */
  setTexture(texture: Texture): void {
    if (texture === this.texture) return;
    this.texture = texture;
    this.mapSprite.texture = texture;
    this.mapSprite.width = this.imageW;
    this.mapSprite.height = this.imageH;
    this.layoutBands();
  }

  get imageW(): number {
    return this.layout.imageSize[0];
  }

  get imageH(): number {
    return this.layout.imageSize[1];
  }

  /** Playfield boxes (roads, plots, caves / castle + headroom, image px), built on first use. */
  private boxes: Rect[] | null = null;

  /**
   * Fits the map to the screen. With `hud` (the dock's reserved rects, screen px) the map shrinks /
   * shifts just enough that no road, plot, cave or castle lies under them (viewFit `fitAroundHud`).
   */
  resize(screenW: number, screenH: number, hud: readonly Rect[] = []): void {
    const [iw, ih] = this.layout.imageSize;
    if (hud.length > 0) {
      this.boxes ??= playfieldBoxes(playfieldShapes(this.layout));
      this.fit = fitAroundHud(screenW, screenH, iw, ih, this.layout.safeArea, this.boxes, hud);
    } else this.fit = computeMapFit(screenW, screenH, iw, ih, this.layout.safeArea);
    const f = this.fit;
    this.world.scale.set(f.scale);
    this.world.position.set(f.offsetX, f.offsetY);
    // Image px may differ from the texture's px if the map was exported at another resolution.
    this.mapSprite.width = iw;
    this.mapSprite.height = ih;
    this.layoutBands();
  }

  private stripTexture(x: number, y: number, w: number, h: number): Texture {
    const tw = this.texture.width / this.imageW;
    const th = this.texture.height / this.imageH;
    return new Texture({
      source: this.texture.source,
      frame: new Rectangle(
        Math.max(0, x * tw),
        Math.max(0, y * th),
        Math.max(1, Math.min(this.texture.width, w * tw)),
        Math.max(1, Math.min(this.texture.height, h * th)),
      ),
    });
  }

  private layoutBands(): void {
    const f = this.fit;
    const s = f.scale;
    const [iw, ih] = this.layout.imageSize;
    const mapTop = f.offsetY;
    const mapLeft = f.offsetX;
    const mapW = iw * s;
    const mapH = ih * s;
    for (const b of this.bandSprites) {
      if (b.texture !== Texture.EMPTY) b.texture.destroy(false);
      b.texture = Texture.EMPTY;
      b.visible = false;
    }
    // The map's outermost EDGE_PX stretched across each band (and its corner texels across the
    // corners): ground colour without repeating anything recognisable — a mirrored strip showed a
    // second castle / cave / road under the HUD once the map shrinks to clear the dock.
    const k = EDGE_PX;
    const L = f.bandLeft > 0.5 ? f.bandLeft + 1 : 0;
    const R = f.bandRight > 0.5 ? f.bandRight + 1 : 0;
    const T = f.bandTop > 0.5 ? f.bandTop + 1 : 0;
    const B = f.bandBottom > 0.5 ? f.bandBottom + 1 : 0;
    const put = (i: number, frame: [number, number, number, number], x: number, y: number, w: number, h: number): void => {
      if (w <= 0 || h <= 0) return;
      const sp = this.bandSprites[i];
      sp.texture = this.stripTexture(...frame);
      sp.position.set(x, y);
      sp.width = w;
      sp.height = h;
      sp.visible = true;
    };
    put(0, [0, 0, k, ih], mapLeft - L + 0.5, mapTop, L, mapH);
    put(1, [iw - k, 0, k, ih], mapLeft + mapW - 0.5, mapTop, R, mapH);
    put(2, [0, 0, iw, k], mapLeft, mapTop - T + 0.5, mapW, T);
    put(3, [0, ih - k, iw, k], mapLeft, mapTop + mapH - 0.5, mapW, B);
    put(4, [0, 0, k, k], mapLeft - L + 0.5, mapTop - T + 0.5, L, T);
    put(5, [iw - k, 0, k, k], mapLeft + mapW - 0.5, mapTop - T + 0.5, R, T);
    put(6, [0, ih - k, k, k], mapLeft - L + 0.5, mapTop + mapH - 0.5, L, B);
    put(7, [iw - k, ih - k, k, k], mapLeft + mapW - 0.5, mapTop + mapH - 0.5, R, B);
  }

  /** World units → map px. */
  pxX(x: number): number {
    return x * this.layout.pxPerUnit + this.layout.imageSize[0] / 2;
  }

  pxY(z: number): number {
    return z * this.layout.pxPerUnit + this.layout.imageSize[1] / 2;
  }

  /** Map px → screen (css px). */
  screenX(px: number): number {
    return this.fit.offsetX + px * this.fit.scale;
  }

  screenY(py: number): number {
    return this.fit.offsetY + py * this.fit.scale;
  }

  /** Screen (css px) → world units on the ground plane. */
  worldXFromScreen(sx: number): number {
    return ((sx - this.fit.offsetX) / this.fit.scale - this.layout.imageSize[0] / 2) / this.layout.pxPerUnit;
  }

  worldZFromScreen(sy: number): number {
    return ((sy - this.fit.offsetY) / this.fit.scale - this.layout.imageSize[1] / 2) / this.layout.pxPerUnit;
  }
}
