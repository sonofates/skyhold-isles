import { Container } from 'pixi.js';

/**
 * Draw order inside the map-px world container (bottom → top):
 * ground FX (range disc, explosion rings) → plots (empty build plots + their contact shadows) → shadows → actors (towers + ground enemies, sorted by
 * ground y) → air (flyers, sorted by ground y) → projectiles → FX (puffs, coins, bolts) → bars.
 */
export class WorldLayers {
  readonly groundFx = new Container();
  readonly plots = new Container();
  readonly shadows = new Container();
  readonly actors = new Container();
  readonly air = new Container();
  readonly projectiles = new Container();
  readonly fx = new Container();
  readonly bars = new Container();

  constructor(parent: Container) {
    this.actors.sortableChildren = true;
    this.air.sortableChildren = true;
    parent.addChild(this.groundFx, this.plots, this.shadows, this.actors, this.air, this.projectiles, this.fx, this.bars);
  }
}

/** How far up the screen one world unit of height is drawn (near top-down plane, 3/4 art). */
export const HEIGHT_TO_SCREEN = 0.9;
