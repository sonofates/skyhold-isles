import { Container, type Application, type Text } from 'pixi.js';
import type { EnemyType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import type { LevelDef } from '../data/levels/types.ts';
import type { LoadedArt } from './assets2d.ts';
import { EnemyLayer, type Walker } from './enemyLayer.ts';
import { paintedText, setFontSize, setText } from './hudText.ts';
import { WorldLayers } from './layers.ts';
import { MapView } from './mapView.ts';
import { createProcTextures } from './procTextures.ts';

interface AbLane {
  readonly art: string;
  readonly type: EnemyType;
  readonly label: string;
}

class LoopWalker implements Walker {
  readonly uid: number;
  readonly type: EnemyType;
  readonly flying: boolean;
  x = 0;
  y = 0;
  z = 0;
  prevX = 0;
  prevY = 0;
  prevZ = 0;
  readonly hp = 1;
  readonly maxHp = 1;
  readonly hitFlashTimer = 0;
  readonly scaleOverride = 1;
  readonly burrowed = false;
  dist = 0;

  constructor(uid: number, type: EnemyType) {
    this.uid = uid;
    this.type = type;
    this.flying = ENEMY_DEFS[type].flying;
    this.y = this.flying ? BALANCE.flyerHeight : 0;
    this.prevY = this.y;
  }
}

const LOOP_W = 3.2;
const LOOP_H = 3.4;
const SPACING = 4.6;

/**
 * `?ab=1`: the enemy-animation A/B showcase. Each enemy walks its own rectangular loop on the
 * L1c map at in-game scale (right → down → left → up, so every facing and both sheet sequences
 * show), no combat, with a small label per lane.
 */
export class AbScene {
  readonly map: MapView;
  private readonly enemies: EnemyLayer;
  private readonly lanes: AbLane[];
  private readonly walkers: LoopWalker[] = [];
  private readonly labels: Text[] = [];
  private readonly screen = new Container();
  private readonly centreX: number;
  private readonly centreZ: number;

  constructor(app: Application, art: LoadedArt, level: LevelDef) {
    const layout = level.layout2d!;
    this.map = new MapView(art.map, layout);
    const layers = new WorldLayers(this.map.world);
    this.enemies = new EnemyLayer(art, this.map, layers, createProcTextures());
    const modeOf = (key: string): string => {
      const a = art.enemies[key];
      if (!a) return 'missing';
      return a.mode === 'sheet' ? 'sheet' : a.frames.length > 1 ? 'cheap + leg frames' : 'cheap';
    };
    this.lanes = [
      { art: 'raider', type: 'grunt', label: `raider\n${modeOf('raider')} · omni12` },
      { art: 'brute', type: 'brute', label: `brute\n${modeOf('brute')}` },
      { art: 'kite', type: 'flyer', label: `kite\n${modeOf('kite')}` },
    ];
    if (art.enemies['raider-veo31q']) {
      this.lanes.push({ art: 'raider-veo31q', type: 'grunt', label: `raider\n${modeOf('raider-veo31q')} · veo31q` });
    }
    const [sx, sy, sw, sh] = layout.safeArea;
    this.centreX = (sx + sw / 2 - layout.imageSize[0] / 2) / layout.pxPerUnit;
    this.centreZ = (sy + sh / 2 - layout.imageSize[1] / 2) / layout.pxPerUnit;
    this.lanes.forEach((l, i) => {
      this.walkers.push(new LoopWalker(i + 1, l.type));
      const t = paintedText(14, 'center');
      setText(t, l.label);
      this.labels.push(t);
      this.screen.addChild(t);
    });
    app.stage.addChild(this.map.root, this.screen);
  }

  private laneCentre(i: number): { x: number; z: number } {
    const n = this.lanes.length;
    return { x: this.centreX + (i - (n - 1) / 2) * SPACING, z: this.centreZ };
  }

  /** Position on a rounded-rectangle loop (clockwise in screen space) at distance d. */
  private loopPoint(cx: number, cz: number, d: number, w: LoopWalker): void {
    const per = 2 * (LOOP_W + LOOP_H);
    let t = ((d % per) + per) % per;
    const x0 = cx - LOOP_W / 2;
    const z0 = cz - LOOP_H / 2;
    if (t < LOOP_W) {
      w.x = x0 + t;
      w.z = z0;
      return;
    }
    t -= LOOP_W;
    if (t < LOOP_H) {
      w.x = x0 + LOOP_W;
      w.z = z0 + t;
      return;
    }
    t -= LOOP_H;
    if (t < LOOP_W) {
      w.x = x0 + LOOP_W - t;
      w.z = z0 + LOOP_H;
      return;
    }
    t -= LOOP_W;
    w.x = x0;
    w.z = z0 + LOOP_H - t;
  }

  resize(w: number, h: number): void {
    this.map.resize(w, h);
    const ppu = this.map.layout.pxPerUnit;
    const size = Math.max(10, Math.round(14 * Math.min(1.2, Math.max(0.7, w / 1400))));
    this.labels.forEach((t, i) => {
      const c = this.laneCentre(i);
      setFontSize(t, size);
      t.position.set(
        this.map.screenX(this.map.pxX(c.x)),
        this.map.screenY(this.map.pxY(c.z + LOOP_H / 2) + 0.9 * ppu),
      );
    });
  }

  frame(dt: number): void {
    this.enemies.beginFrame();
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i];
      const c = this.laneCentre(i);
      w.prevX = w.x;
      w.prevZ = w.z;
      w.dist += ENEMY_DEFS[w.type].speed * dt;
      this.loopPoint(c.x, c.z, w.dist, w);
      this.enemies.drawWalker(i, w, 1, dt, this.lanes[i].art);
    }
    this.enemies.endFrame();
  }

  debugState(): Record<string, unknown> {
    return { lanes: this.lanes.map((l) => l.label), fit: this.map.fit };
  }
}
