import { Sprite, type Container, type Texture } from 'pixi.js';
import { frontPlacement, type Level2DGate } from '../data/levels2d/gates.ts';

/**
 * Gate front layers (raider caves, castle gate): the rock lip / arch and the dark shading inside
 * the mouth, cut from the baked map by tools/map-compose. Each is one sprite among the actors,
 * sorted by the gate's front-edge ground y, so a walker inside the mouth (feet above that line) is
 * drawn under it: it appears out of the darkness and walks out from under the arch, and walks into
 * the castle gate and fades under its arch. Walkers passing in front of a gate draw over it.
 */
export class GateLayer {
  readonly sprites: Sprite[] = [];

  private readonly artBySprite = new Map<Sprite, string>();

  setTextures(overlays: Readonly<Record<string, Texture>>): void {
    for (const [sprite, key] of this.artBySprite) sprite.texture = overlays[key];
  }

  constructor(actors: Container, gates: readonly Level2DGate[], overlays: Readonly<Record<string, Texture>>) {
    for (const g of gates) {
      if (!g.front) continue;
      const tex = overlays[g.front.art];
      if (!tex) continue;
      const p = frontPlacement(g.front);
      const s = new Sprite(tex);
      s.position.set(p.x, p.y);
      s.width = p.width;
      s.height = p.height;
      s.zIndex = p.zIndex;
      s.eventMode = 'none';
      s.label = `gate-${g.role}-${g.lane}`;
      actors.addChild(s);
      this.sprites.push(s);
      this.artBySprite.set(s, g.front.art);
    }
  }
}
