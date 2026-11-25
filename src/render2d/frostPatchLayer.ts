import { Container, Sprite } from 'pixi.js';
import type { FrostPatch } from '../sim/enemySystem.ts';
import type { MapView } from './mapView.ts';
import type { ProcTextures } from './procTextures.ts';

const FROST_DISC = 0xcfefff;
const FROST_RIM = 0x9fdcff;
const FROST_CORE = 0xe8f8ff;

interface PatchView {
  readonly disc: Sprite;
  readonly rim: Sprite;
  readonly core: Sprite;
}

/**
 * Rime Beetle frost patches, drawn from the sim's patch slots every frame (state-driven, so a
 * replay seek, a skip or the run end can never leave a stale decal): a pale frost disc covering
 * the whole radius that slows towers, a crisp rim at that radius and a bright rime splat where the
 * beetle fell. Everything fades out over the last 40 % of the patch's life.
 */
export class FrostPatchLayer {
  private readonly views: PatchView[] = [];
  private readonly root = new Container();
  private time = 0;
  /** QA: patches drawn this frame. */
  drawn = 0;

  private readonly map: MapView;
  private readonly tex: ProcTextures;

  constructor(map: MapView, parent: Container, tex: ProcTextures) {
    this.map = map;
    this.tex = tex;
    parent.addChild(this.root);
  }

  private view(i: number): PatchView {
    let v = this.views[i];
    if (v) return v;
    const disc = new Sprite(this.tex.rangeDisc);
    const rim = new Sprite(this.tex.wring);
    const core = new Sprite(this.tex.crater);
    for (const s of [disc, rim, core]) {
      s.anchor.set(0.5);
      s.visible = false;
      this.root.addChild(s);
    }
    disc.tint = FROST_DISC;
    rim.tint = FROST_RIM;
    core.tint = FROST_CORE;
    v = { disc, rim, core };
    this.views[i] = v;
    return v;
  }

  sync(patches: readonly FrostPatch[], dtSec: number): void {
    this.time += dtSec;
    const ppu = this.map.layout.pxPerUnit;
    let drawn = 0;
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      if (!p.active) {
        const v = this.views[i];
        if (v) v.disc.visible = v.rim.visible = v.core.visible = false;
        continue;
      }
      const v = this.view(i);
      const life = p.duration > 0 ? p.timeLeft / p.duration : 0;
      const fade = Math.min(1, life / 0.4);
      const grow = Math.min(1, (1 - life) * 6);
      const px = this.map.pxX(p.x);
      const py = this.map.pxY(p.z);
      // Ground is drawn nearly top-down: the patch is a flattened ellipse.
      const rx = p.radius * ppu * (0.85 + 0.15 * grow);
      const ry = rx * 0.62;
      v.disc.visible = v.rim.visible = v.core.visible = true;
      v.disc.position.set(px, py);
      v.disc.scale.set((rx * 2) / v.disc.texture.width, (ry * 2) / v.disc.texture.height);
      v.disc.alpha = 0.5 * fade;
      v.rim.position.set(px, py);
      v.rim.scale.set((rx * 2) / v.rim.texture.width, (ry * 2) / v.rim.texture.height);
      v.rim.alpha = (0.75 + 0.15 * Math.sin(this.time * 5 + i)) * fade;
      v.core.position.set(px, py);
      const cr = ppu * 1.1;
      v.core.scale.set((cr * 2) / v.core.texture.width, (cr * 1.3) / v.core.texture.height);
      v.core.alpha = 0.7 * fade;
      drawn++;
    }
    this.drawn = drawn;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.views.length = 0;
  }
}
