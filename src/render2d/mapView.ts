import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Level2DLayout } from '../data/levels/types.ts';
import {
  backdropPlacement, borderWidth, buildBackdropTexture, buildShadowTextures, buildVignetteTexture, shadowReach,
} from './mapFrame.ts';
import type { QualityTier } from './renderResolution.ts';
import { computeMapFit, type MapFit } from './viewFit.ts';
import { fitAt } from './fullBleed.ts';

/**
 * Painted map + world container. Children of `world` are positioned in map image px; the
 * container carries the fit (scale + offset), so sprite sizes stay locked to the painting.
 * Letterbox bands (an extreme aspect, or a pan past the painting's top / bottom edge) are a frame
 * (mapFrame.ts): the map itself blurred, darkened and desaturated behind everything, a soft shadow
 * and a thin painted border around the image, a light screen vignette.
 */
/** Flat fill when the backdrop can't be built (no DOM / unreadable map source). */
const FLAT_BAND = 0x1c1914;

export class MapView {
  readonly root = new Container();
  /** Map-px space: everything that lives on the map goes in here. */
  readonly world = new Container();
  private readonly bands = new Container();
  /** Base painted layer (index 0 in `world`): mirrored pan edges + main map sprite. */
  private readonly mapBase = new Container();
  private readonly mapSprite: Sprite;
  private readonly backdrop: Sprite;
  private readonly backdropTex: Texture | null;
  private readonly vignette: Sprite;
  private readonly shadowTex: { edge: Texture; corner: Texture } | null;
  private readonly shadowSprites: Sprite[] = [];
  private readonly border = new Graphics();
  /**
   * The painting mirrored past its edges (L, R, T, B, then TL, TR, BL, BR): the pan may reach a
   * little past a covered axis's edge so a plot under the HUD can be lifted clear (fullBleed.ts
   * reachRange); that strip shows the map's own painted edge, never the dark frame.
   */
  private readonly edgeSprites: Sprite[] = [];
  private tier: QualityTier = 'high';
  /** QA: how long building the backdrop took (ms, once per map). */
  private readonly backdropMs: number;
  private screenW = 1;
  private screenH = 1;
  fit: MapFit;
  private texture: Texture;
  readonly layout: Level2DLayout;

  constructor(texture: Texture, layout: Level2DLayout) {
    this.texture = texture;
    this.layout = layout;
    this.mapBase.eventMode = 'none';
    this.mapBase.interactiveChildren = false;
    this.mapSprite = new Sprite(texture);
    for (let i = 0; i < 8; i++) {
      const e = new Sprite(texture);
      e.visible = false;
      this.edgeSprites.push(e);
      this.mapBase.addChild(e);
    }
    this.mapBase.addChild(this.mapSprite);
    this.world.addChild(this.mapBase);
    // Built once per map (the island's first bake; a later sharper bake of the same painting
    // would blur to the same thing).
    const t0 = performance.now();
    this.backdropTex = buildBackdropTexture(texture);
    this.backdropMs = performance.now() - t0;
    this.backdrop = new Sprite(this.backdropTex ?? Texture.WHITE);
    if (!this.backdropTex) this.backdrop.tint = FLAT_BAND;
    this.vignette = new Sprite(buildVignetteTexture() ?? Texture.EMPTY);
    this.shadowTex = buildShadowTextures();
    this.bands.addChild(this.backdrop, this.vignette);
    for (let i = 0; i < 8; i++) {
      // Left, right, top, bottom edges, then the four corners.
      const s = new Sprite(this.shadowTex ? (i < 4 ? this.shadowTex.edge : this.shadowTex.corner) : Texture.EMPTY);
      s.alpha = 0.55;
      s.visible = false;
      this.shadowSprites.push(s);
      this.bands.addChild(s);
    }
    this.bands.addChild(this.border);
    this.root.addChild(this.bands, this.world);
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
    for (const e of this.edgeSprites) e.texture = texture;
    this.layoutBands();
  }

  get imageW(): number {
    return this.layout.imageSize[0];
  }

  get imageH(): number {
    return this.layout.imageSize[1];
  }

  /**
   * Fits the map to the screen: `fit` when the caller placed it (the full-bleed fit around the
   * corner HUD, fullBleed.ts), else the plain fit (computeMapFit).
   */
  resize(screenW: number, screenH: number, fit?: MapFit): void {
    const [iw, ih] = this.layout.imageSize;
    this.fit = fit ?? computeMapFit(screenW, screenH, iw, ih, this.layout.safeArea);
    this.screenW = screenW;
    this.screenH = screenH;
    const f = this.fit;
    this.world.scale.set(f.scale);
    this.world.position.set(f.offsetX, f.offsetY);
    // Image px may differ from the texture's px if the map was exported at another resolution.
    this.mapSprite.width = iw;
    this.mapSprite.height = ih;
    this.layoutBands();
  }

  /**
   * Pans the view: the same scale, the map's screen offset moved (mapPan.ts). Everything in
   * `world` moves with it; the bands (only past the painting's edge) re-lay when one is open.
   */
  setOffset(offsetX: number, offsetY: number): void {
    const f = this.fit;
    if (f.offsetX === offsetX && f.offsetY === offsetY) return;
    const wasOpen = f.bandLeft > 0.5 || f.bandRight > 0.5 || f.bandTop > 0.5 || f.bandBottom > 0.5;
    const [iw, ih] = this.layout.imageSize;
    this.fit = fitAt(this.screenW, this.screenH, iw, ih, f.scale, offsetX, offsetY);
    this.world.position.set(offsetX, offsetY);
    const n = this.fit;
    if (wasOpen || n.bandLeft > 0.5 || n.bandRight > 0.5 || n.bandTop > 0.5 || n.bandBottom > 0.5) this.layoutBands();
  }

  /**
   * Effects tier: `low` drops the shadow and the vignette (two alpha-blended layers); the backdrop
   * and the border stay — they are what makes the bands read as a frame.
   */
  setQuality(tier: QualityTier): void {
    if (this.tier === tier) return;
    this.tier = tier;
    this.layoutBands();
  }

  /** QA: what fills the bands right now. */
  frameInfo(): {
    backdrop: 'blur' | 'flat' | 'none'; shadow: boolean; vignette: boolean; border: boolean; tier: QualityTier;
    bands: [number, number, number, number]; backdropMs: number;
  } {
    const f = this.fit;
    return {
      bands: [f.bandLeft, f.bandTop, f.bandRight, f.bandBottom],
      backdropMs: Math.round(this.backdropMs * 10) / 10,
      backdrop: !this.backdrop.visible ? 'none' : this.backdropTex ? 'blur' : 'flat',
      shadow: this.shadowSprites.some((s) => s.visible),
      vignette: this.vignette.visible,
      border: this.border.visible,
      tier: this.tier,
    };
  }

  private layoutBands(): void {
    const f = this.fit;
    const s = f.scale;
    const [iw, ih] = this.layout.imageSize;
    const sw = this.screenW;
    const sh = this.screenH;
    const x0 = f.offsetX;
    const y0 = f.offsetY;
    const x1 = x0 + iw * s;
    const y1 = y0 + ih * s;
    // A band on an axis the painting covers is the pan's reach past the edge: the mirrored edge
    // fills it. Only a band on an axis the painting can't cover (an extreme aspect) is framed.
    const coverX = iw * s >= sw - 0.5;
    const coverY = ih * s >= sh - 0.5;
    const reach = [coverX && f.bandLeft > 0.5, coverX && f.bandRight > 0.5, coverY && f.bandTop > 0.5, coverY && f.bandBottom > 0.5];
    this.layoutEdges(reach);
    const bandOpen = [f.bandLeft > 0.5 && !reach[0], f.bandRight > 0.5 && !reach[1], f.bandTop > 0.5 && !reach[2], f.bandBottom > 0.5 && !reach[3]];
    const open = bandOpen.some(Boolean);
    const rich = open && this.tier !== 'low';

    // Backdrop: the blurred map around the map's centre, covering the screen (+ shake overscan).
    // Hidden when the map covers the screen (it would only be overdraw).
    this.backdrop.visible = open;
    if (open) {
      const over = Math.ceil(Math.min(sw, sh) * 0.04);
      if (this.backdropTex) {
        const p = backdropPlacement(sw, sh, iw, ih, f, over);
        this.backdrop.position.set(p.x, p.y);
        this.backdrop.width = iw * p.scale;
        this.backdrop.height = ih * p.scale;
      } else {
        this.backdrop.position.set(-over, -over);
        this.backdrop.width = sw + 2 * over;
        this.backdrop.height = sh + 2 * over;
      }
    }

    this.vignette.visible = rich && this.vignette.texture !== Texture.EMPTY;
    if (this.vignette.visible) {
      const over = Math.ceil(Math.min(sw, sh) * 0.04);
      this.vignette.position.set(-over, -over);
      this.vignette.width = sw + 2 * over;
      this.vignette.height = sh + 2 * over;
    }

    // Shadow: edges (left, right, top, bottom) then corners (tl, tr, bl, br), outside the map.
    const bw = borderWidth(sw, sh);
    const shadowLen = shadowReach(sw, sh);
    const r0 = bw * 0.5; // starts under the border so its darkest part meets the wood, not a gap
    const showShadow = rich && this.shadowTex !== null;
    // Edge texture: u along the edge, v = outward falloff (darkest at v = 0). Each strip runs the
    // side's length plus r0 at both ends; the corner pieces take over beyond that.
    const sides: [number, number, number, number, number][] = [
      // x, y, length along the edge, rotation, which band must be open (0 L, 1 R, 2 T, 3 B)
      [x0 - r0, y0 - r0, y1 - y0 + 2 * r0, Math.PI / 2, 0], // u → +y, v → −x
      [x1 + r0, y1 + r0, y1 - y0 + 2 * r0, -Math.PI / 2, 1], // u → −y, v → +x
      [x1 + r0, y0 - r0, x1 - x0 + 2 * r0, Math.PI, 2], // u → −x, v → −y
      [x0 - r0, y1 + r0, x1 - x0 + 2 * r0, 0, 3], // u → +x, v → +y
    ];
    for (let i = 0; i < 4; i++) {
      const sp = this.shadowSprites[i];
      const [x, y, len, rot, b] = sides[i];
      sp.visible = showShadow && bandOpen[b];
      if (!sp.visible) continue;
      sp.rotation = rot;
      sp.position.set(x, y);
      sp.width = len;
      sp.height = shadowLen;
    }
    const corners: [number, number, number, number][] = [
      [x0 - r0, y0 - r0, -1, -1],
      [x1 + r0, y0 - r0, 1, -1],
      [x0 - r0, y1 + r0, -1, 1],
      [x1 + r0, y1 + r0, 1, 1],
    ];
    for (let i = 0; i < 4; i++) {
      const sp = this.shadowSprites[4 + i];
      const [x, y, dx, dy] = corners[i];
      sp.visible = showShadow && (dx < 0 ? bandOpen[0] : bandOpen[1]) && (dy < 0 ? bandOpen[2] : bandOpen[3]);
      if (!sp.visible) continue;
      sp.position.set(x, y);
      sp.width = shadowLen * dx;
      sp.height = shadowLen * dy;
    }

    // Border: a thin painted moulding just outside the image (under the world, so a sprite that
    // stands proud of the map's edge is drawn over it, not cut by it). From the map outward:
    // dark contact line, gilt highlight, wood, dark rim.
    const g = this.border;
    g.clear();
    g.visible = open;
    if (open) {
      const ring = (d: number, w: number, color: number, alpha = 1): void => {
        const o = d + w / 2;
        g.rect(x0 - o, y0 - o, x1 - x0 + 2 * o, y1 - y0 + 2 * o).stroke({ width: w, color, alpha, join: 'miter' });
      };
      // Proportions of the moulding (sum 1): contact, gilt, wood, top-light, rim.
      const parts: [number, number, number][] = [
        [0.12, 0x1a0f08, 0.95],
        [0.18, 0xe0b25e, 1],
        [0.42, 0x7a4a24, 1],
        [0.12, 0xa8703a, 1],
        [0.16, 0x1e1209, 0.92],
      ];
      let d = 0;
      for (const [share, color, alpha] of parts) {
        const w = Math.max(0.75, share * bw);
        ring(d, w, color, alpha);
        d += w;
      }
    }
  }

  /** The mirrored copies of the painting along the sides (and corners) the pan reaches past. */
  private layoutEdges(open: readonly boolean[]): void {
    const [iw, ih] = this.layout.imageSize;
    // [x flip, y flip]: -1 / +1 = mirrored to the left / right (top / bottom), 0 = not mirrored.
    const spots: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (let i = 0; i < 8; i++) {
      const e = this.edgeSprites[i];
      const [fx, fy] = spots[i];
      e.visible = (fx === 0 || open[fx < 0 ? 0 : 1]) && (fy === 0 || open[fy < 0 ? 2 : 3]);
      if (!e.visible) continue;
      // Mirrored about the edge: a flipped copy anchored on the edge it continues.
      e.scale.set(1, 1);
      e.width = iw;
      e.height = ih;
      e.scale.set(fx === 0 ? e.scale.x : -e.scale.x, fy === 0 ? e.scale.y : -e.scale.y);
      e.position.set(fx === 0 ? 0 : fx < 0 ? 0 : 2 * iw, fy === 0 ? 0 : fy < 0 ? 0 : 2 * ih);
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
