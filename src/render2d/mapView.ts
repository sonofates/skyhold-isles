import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Level2DLayout } from '../data/levels/types.ts';
import { computeMapFit, type MapFit } from './viewFit.ts';

/**
 * Painted map + world container. Children of `world` are positioned in map image px; the
 * container carries the fit (scale + offset), so sprite sizes stay locked to the painting.
 * Letterbox bands (only when the safe-area clamp stops the map covering the screen) are filled
 * with mirrored strips of the map's own edges, slightly dimmed — no flat colour bars.
 */
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
    for (let i = 0; i < 4; i++) {
      const s = new Sprite(Texture.EMPTY);
      s.visible = false;
      s.tint = 0xf2efe8; // barely dimmed: hints the edge without a visible seam
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

  resize(screenW: number, screenH: number): void {
    const [iw, ih] = this.layout.imageSize;
    this.fit = computeMapFit(screenW, screenH, iw, ih, this.layout.safeArea);
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
    const [left, right, top, bottom] = this.bandSprites;
    if (f.bandLeft > 0.5) {
      const w = Math.min(iw, f.bandLeft / s + 1);
      left.texture = this.stripTexture(0, 0, w, ih);
      left.scale.set(-s, s);
      left.position.set(mapLeft + 0.5, mapTop);
      left.visible = true;
    }
    if (f.bandRight > 0.5) {
      const w = Math.min(iw, f.bandRight / s + 1);
      right.texture = this.stripTexture(iw - w, 0, w, ih);
      right.scale.set(-s, s);
      right.position.set(mapLeft + mapW + w * s - 0.5, mapTop);
      right.visible = true;
    }
    if (f.bandTop > 0.5) {
      const h = Math.min(ih, f.bandTop / s + 1);
      top.texture = this.stripTexture(0, 0, iw, h);
      top.scale.set(s, -s);
      top.position.set(mapLeft, mapTop + 0.5);
      top.visible = true;
    }
    if (f.bandBottom > 0.5) {
      const h = Math.min(ih, f.bandBottom / s + 1);
      bottom.texture = this.stripTexture(0, ih - h, iw, h);
      bottom.scale.set(s, -s);
      bottom.position.set(mapLeft, mapTop + mapH + h * s - 0.5);
      bottom.visible = true;
    }
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
