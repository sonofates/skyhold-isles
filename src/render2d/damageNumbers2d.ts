/**
 * Pooled Pixi renderer for 2D floating damage numbers (`DamagePopupPool2D` in `settings2d.ts`).
 * Allocates all `Text` sprites up front in `layers.fx`; gated by `GameSettings.damageNumbers`.
 */
import type { Container, Text } from 'pixi.js';
import type { GameSettings } from '../core/types.ts';
import { paintedText, setFontSize, setText } from './hudText.ts';
import { HEIGHT_TO_SCREEN } from './layers.ts';
import type { MapView } from './mapView.ts';
import {
  clearDamagePopupPool2D,
  createDamagePopupPool2D,
  spawnDamageNumber2D,
  stepDamageNumbers2D,
  type DamageHitInput2D,
  type DamagePopupPool2D,
} from './settings2d.ts';

const POOL_SIZE = 28;
const NORMAL_FILL = '#fff4dc';
const HEAVY_FILL = '#ffd45a';

export class DamageNumbers2D {
  readonly pool: DamagePopupPool2D = createDamagePopupPool2D(POOL_SIZE);
  private readonly texts: Text[] = [];
  private readonly map: MapView;

  constructor(map: MapView, parent: Container) {
    this.map = map;
    for (let i = 0; i < POOL_SIZE; i++) {
      const t = paintedText(18, 'center', NORMAL_FILL);
      t.visible = false;
      parent.addChild(t);
      this.texts.push(t);
    }
  }

  clear(): void {
    clearDamagePopupPool2D(this.pool);
    for (let i = 0; i < this.texts.length; i++) this.texts[i].visible = false;
  }

  spawn(hit: DamageHitInput2D, nowSec: number, settings: Pick<GameSettings, 'damageNumbers'>): void {
    spawnDamageNumber2D(this.pool, hit, nowSec, settings);
  }

  update(dt: number, settings: Pick<GameSettings, 'damageNumbers'>): number {
    const active = stepDamageNumbers2D(this.pool, dt, settings);
    const ppu = this.map.layout.pxPerUnit;
    for (let i = 0; i < POOL_SIZE; i++) {
      const s = this.pool.slots[i];
      const t = this.texts[i];
      if (!s.active) {
        if (t.visible) t.visible = false;
        continue;
      }
      const k = Math.max(0, Math.min(1, s.age / s.duration));
      const px = this.map.pxX(s.x);
      const basePy = this.map.pxY(s.z) - (s.y + 0.65) * HEIGHT_TO_SCREEN * ppu;
      const rise = 24 * (1 - (1 - k) * (1 - k));
      setFontSize(t, s.heavy ? 22 : 17);
      t.style.fill = s.heavy ? HEAVY_FILL : NORMAL_FILL;
      setText(t, String(s.amount));
      t.position.set(px, basePy - rise);
      const pop = k < 0.12 ? 0.75 + (k / 0.12) * 0.35 : 1.1 - Math.min(0.1, (k - 0.12) * 0.25);
      t.scale.set(pop);
      t.alpha = k < 0.6 ? 1 : Math.max(0, (1 - k) / 0.4);
      t.visible = true;
    }
    return active;
  }
}
