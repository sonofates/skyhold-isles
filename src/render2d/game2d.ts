import { Container, Sprite, type Application } from 'pixi.js';
import { EventBus } from '../core/eventBus.ts';
import { FixedTimestepStepper } from '../core/gameLoop.ts';
import type { SpeedMultiplier, TowerType } from '../core/types.ts';
import type { LevelDef } from '../data/levels/types.ts';
import { getTowerTierStats } from '../data/towers.ts';
import { computeSellRefund, SimWorld } from '../sim/world.ts';
import type { LoadedArt } from './assets2d.ts';
import { BuildRing, type RingAction } from './buildRing.ts';
import { EnemyLayer } from './enemyLayer.ts';
import { FxLayer } from './fxLayer.ts';
import { Hud, type HudState } from './hud.ts';
import { WorldLayers } from './layers.ts';
import { MapView } from './mapView.ts';
import { createProcTextures, type ProcTextures } from './procTextures.ts';
import { ProjectileLayer } from './projectileLayer.ts';
import { TowerLayer } from './towerLayer.ts';

/** Tap = pointer released within this distance (css px) and time of the press. */
const TAP_SLOP = 14;
const TAP_MS = 700;

export interface Game2DHooks {
  /** Runs before each fixed sim tick (bench top-up, autoplay). */
  beforeTick?: (world: SimWorld) => void;
  /** Disable the win/lose overlay + restart (bench). */
  endless?: boolean;
}

/**
 * The playable 2D slice: the real SimWorld (fixed 60 Hz stepper, pause, 1×/2×) rendered with
 * Pixi on the painted map. Owns input (tap a free plot → build ring; tap a tower → upgrade/sell;
 * HUD buttons; horn calls the next wave) and the per-frame sync of every layer.
 */
export class Game2D {
  readonly app: Application;
  readonly art: LoadedArt;
  readonly level: LevelDef;
  readonly tex: ProcTextures;
  readonly map: MapView;
  readonly layers: WorldLayers;
  readonly enemies: EnemyLayer;
  readonly towers: TowerLayer;
  readonly projectiles: ProjectileLayer;
  readonly fx: FxLayer;
  readonly hud: Hud;
  readonly ring: BuildRing;
  readonly stepper = new FixedTimestepStepper();
  private readonly rangeDisc: Sprite;
  private readonly screen = new Container();
  private readonly hooks: Game2DHooks;
  private readonly costs = new Map<TowerType, number>();
  world!: SimWorld;
  events!: EventBus;
  private selectedTower = -1;
  private down: { x: number; y: number; t: number } | null = null;
  private hudState: {
    lives: number;
    gold: number;
    wave: number;
    totalWaves: number;
    paused: boolean;
    speed: number;
    canCall: boolean;
    earlyBonus: number;
    banner: string;
  } = { lives: 0, gold: 0, wave: 0, totalWaves: 0, paused: false, speed: 1, canCall: false, earlyBonus: 0, banner: '' };

  constructor(app: Application, art: LoadedArt, level: LevelDef, hooks: Game2DHooks = {}) {
    if (!level.layout2d) throw new Error(`${level.id} has no 2D layout`);
    this.app = app;
    this.art = art;
    this.level = level;
    this.hooks = hooks;
    this.tex = createProcTextures();
    this.map = new MapView(art.map, level.layout2d);
    this.layers = new WorldLayers(this.map.world);
    this.rangeDisc = new Sprite(this.tex.rangeDisc);
    this.rangeDisc.anchor.set(0.5);
    this.rangeDisc.visible = false;
    this.layers.groundFx.addChild(this.rangeDisc);
    this.enemies = new EnemyLayer(art, this.map, this.layers, this.tex);
    this.towers = new TowerLayer(art, this.map, this.layers, this.tex);
    this.projectiles = new ProjectileLayer(this.map, this.layers.projectiles, this.layers.shadows, this.tex, (t) =>
      this.towers.muzzleHeight(t),
    );
    this.fx = new FxLayer(this.map, this.layers.groundFx, this.layers.fx, {
      puff: this.tex.puff,
      ring: this.tex.ring,
      coin: art.ui.gold,
      spark: this.tex.spark,
      glow: this.tex.glow,
      flash: this.tex.spark,
    });
    this.hud = new Hud(art);
    this.ring = new BuildRing(art);
    this.screen.addChild(this.hud.root, this.ring.root);
    app.stage.addChild(this.map.root, this.screen);
    for (const t of art.manifest.buildRing) this.costs.set(t, getTowerTierStats(t, 1).upgradeCost);
    this.newRun();
  }

  /** Starts (or restarts) a run on the level. */
  newRun(): void {
    this.events = new EventBus();
    this.world = new SimWorld(this.level, this.events);
    this.stepper.simActive = true;
    this.stepper.paused = false;
    this.stepper.resetAccumulator();
    this.ring.close();
    this.selectedTower = -1;
    this.rangeDisc.visible = false;
    this.enemies.reset();
    this.wireEvents();
  }

  private wireEvents(): void {
    const ev = this.events;
    const m = this.map;
    const ppu = this.level.layout2d!.pxPerUnit;
    ev.on('towerFired', (e) => this.towers.onFired(e.towerId, e.yaw));
    ev.on('lightningChain', (e) => this.fx.bolt(e.points, e.overload === true, this.towers.muzzleHeight('tesla')));
    ev.on('projectileImpact', (e) => {
      const px = m.pxX(e.x);
      const py = m.pxY(e.z);
      if (e.towerType === 'cannon' || e.towerType === 'mortar') {
        this.fx.spawn('ring', px, py, Math.max(28, e.radius * ppu), 0, 0, 0.38);
        this.fx.puffs(px, py, 6, 14, 0xf2c27a);
        this.fx.spawn('flash', px, py - 6, 26, 0, 0, 0.16);
      } else {
        this.fx.spawn('spark', px, py - 0.6 * ppu, 9, 0, 0, 0.18);
      }
    });
    ev.on('enemyKilled', (e) => {
      const px = m.pxX(e.x);
      const py = m.pxY(e.z) - e.y * 0.9 * ppu;
      this.fx.puffs(px, py - 14, 7, 12);
      this.fx.spawn('coin', px, py - 30, 26, 0, -70, 0.8);
    });
    ev.on('towerBuilt', (e) => this.fx.puffs(m.pxX(e.x), m.pxY(e.z), 10, 30, 0xe9d8b4));
    ev.on('towerUpgraded', (e) => {
      this.fx.puffs(m.pxX(e.x), m.pxY(e.z), 8, 26, 0xfff0c0);
      this.fx.spawn('flash', m.pxX(e.x), m.pxY(e.z) - 60, 50, 0, 0, 0.3);
    });
    ev.on('towerSold', (e) => {
      this.fx.puffs(m.pxX(e.x), m.pxY(e.z), 10, 30, 0xe9d8b4);
      this.fx.spawn('coin', m.pxX(e.x), m.pxY(e.z) - 40, 34, 0, -60, 0.9);
    });
  }

  resize(w: number, h: number): void {
    this.map.resize(w, h);
    const ents = this.level.layout2d!.entrances;
    // Horn between the entrances, nudged onto the grass to their right.
    let ex = 0;
    let ez = 0;
    for (const e of ents) {
      ex += e.x;
      ez += e.z;
    }
    ex /= Math.max(1, ents.length);
    ez /= Math.max(1, ents.length);
    this.hud.layout(w, h, { x: this.map.screenX(this.map.pxX(ex)) + 10, y: this.map.screenY(this.map.pxY(ez)) });
    this.ring.close();
    this.rangeDisc.visible = false;
  }

  /** One rendered frame. */
  frame(dtSec: number): void {
    const world = this.world;
    const res = this.stepper.step(dtSec, (fixedDt) => {
      this.hooks.beforeTick?.(world);
      world.fixedTick(fixedDt);
    });
    const alpha = res.alpha;
    const simDt = this.stepper.paused ? 0 : dtSec * this.stepper.speed;
    this.towers.sync(world.towers, dtSec);
    this.enemies.syncPool(world.enemyPool, alpha, simDt);
    this.projectiles.sync(world.projectilePool, alpha);
    this.fx.update(simDt > 0 ? simDt : dtSec * 0.25);

    // A selected tower could be sold or the run reset.
    if (this.selectedTower !== -1 && !world.getTowerById(this.selectedTower)) this.closeRing();

    const s = this.hudState;
    s.lives = world.lives;
    s.gold = world.gold;
    s.wave = world.waveSystem.currentWaveOneBased;
    s.totalWaves = world.waveSystem.totalWaves;
    s.paused = this.stepper.paused;
    s.speed = this.stepper.speed;
    s.canCall = world.outcome === 'ongoing' && world.waveSystem.canStartNextWave();
    s.earlyBonus = s.canCall ? world.waveSystem.getEarlyCallBonus() : 0;
    s.banner =
      world.outcome === 'won' && !this.hooks.endless
        ? 'Victory!'
        : world.outcome === 'lost' && !this.hooks.endless
          ? 'Defeat'
          : this.stepper.paused
            ? 'Paused'
            : '';
    this.hud.update(s as HudState, dtSec);
  }

  private closeRing(): void {
    this.ring.close();
    this.selectedTower = -1;
    this.rangeDisc.visible = false;
  }

  private screenSize(): { w: number; h: number } {
    return { w: this.app.screen.width, h: this.app.screen.height };
  }

  /** Screen position (css px) of a plot centre. */
  plotScreen(i: number): { x: number; y: number } {
    const p = this.level.layout2d!.plots[i];
    return { x: this.map.screenX(this.map.pxX(p.x)), y: this.map.screenY(this.map.pxY(p.z)) };
  }

  private openForPlot(plot: number): void {
    const world = this.world;
    const { w, h } = this.screenSize();
    const c = this.plotScreen(plot);
    const towerId = world.grid.getTowerIdAt(plot, 0);
    if (towerId === -1) {
      this.selectedTower = -1;
      this.rangeDisc.visible = false;
      this.ring.openBuild(plot, c.x, c.y, world.gold, this.costs, w, h, this.hud.topBand);
      return;
    }
    const t = world.getTowerById(towerId);
    if (!t) return;
    this.selectedTower = t.id;
    const next = t.tier < 3 ? getTowerTierStats(t.type, (t.tier + 1) as 2 | 3).upgradeCost : null;
    this.ring.openTower(
      plot,
      c.x,
      c.y - 30,
      { type: t.type, tier: t.tier, upgradeCost: next, refund: computeSellRefund(t.totalInvested) },
      world.gold,
      w,
      h,
      this.hud.topBand,
    );
    const range = getTowerTierStats(t.type, t.tier).range;
    const ppu = this.level.layout2d!.pxPerUnit;
    this.rangeDisc.position.set(this.map.pxX(t.x), this.map.pxY(t.z));
    this.rangeDisc.scale.set((range * ppu * 2) / this.tex.rangeDisc.width);
    this.rangeDisc.visible = true;
  }

  private doRing(action: RingAction): void {
    const world = this.world;
    const plot = this.ring.plot;
    if (action.kind === 'build') {
      world.placeTowerOnPlot(plot, action.type);
    } else if (action.kind === 'upgrade') {
      if (this.selectedTower !== -1) world.upgradeTower(this.selectedTower);
    } else {
      if (this.selectedTower !== -1) world.sellTower(this.selectedTower);
    }
    this.closeRing();
  }

  /** Handles a tap at screen (css px) coordinates. */
  tap(x: number, y: number): void {
    const world = this.world;
    if (world.outcome !== 'ongoing' && !this.hooks.endless) {
      this.newRun();
      return;
    }
    const ringHit = this.ring.hit(x, y);
    if (ringHit !== undefined) {
      if (ringHit) this.doRing(ringHit);
      return;
    }
    const hudHit = this.hud.hit(x, y);
    if (hudHit) {
      this.closeRing();
      if (hudHit === 'pause') this.stepper.paused = !this.stepper.paused;
      else if (hudHit === 'speed') this.stepper.speed = (this.stepper.speed === 1 ? 2 : 1) as SpeedMultiplier;
      else if (hudHit === 'horn' && !this.stepper.paused) world.startNextWave();
      return;
    }
    if (this.stepper.paused) return;
    const wx = this.map.worldXFromScreen(x);
    const wz = this.map.worldZFromScreen(y);
    let plot = world.grid.findPlotAt(wx, wz, 1.25);
    if (plot === -1) {
      // Tapping a tower's body (drawn above its plot) selects it too.
      const p2 = world.grid.findPlotAt(wx, wz + 1.2, 1.4);
      if (p2 !== -1 && world.grid.getTowerIdAt(p2, 0) !== -1) plot = p2;
    }
    if (plot === -1 || (this.ring.isOpen && this.ring.plot === plot)) {
      this.closeRing();
      return;
    }
    this.openForPlot(plot);
  }

  /** Wires pointer (touch + mouse) and keyboard input on the canvas. */
  attachInput(canvas: HTMLCanvasElement): void {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP || performance.now() - d.t > TAP_MS) return;
      const r = canvas.getBoundingClientRect();
      this.tap(e.clientX - r.left, e.clientY - r.top);
    });
    canvas.addEventListener('pointercancel', () => {
      this.down = null;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ') this.stepper.paused = !this.stepper.paused;
      else if (e.key === '1') this.stepper.speed = 1;
      else if (e.key === '2') this.stepper.speed = 2;
      else if (e.key === 'n' || e.key === 'N') this.world.startNextWave();
      else if (e.key === 'Escape') this.closeRing();
    });
  }

  /** Debug / QA snapshot. */
  debugState(): Record<string, unknown> {
    const w = this.world;
    return {
      gold: w.gold,
      lives: w.lives,
      wave: w.waveSystem.currentWaveOneBased,
      waveState: w.waveSystem.state,
      outcome: w.outcome,
      enemies: w.enemyPool.getActiveCount(),
      projectiles: w.projectilePool.getActiveCount(),
      paused: this.stepper.paused,
      speed: this.stepper.speed,
      towers: w.towers.map((t) => ({ id: t.id, type: t.type, tier: t.tier, plot: t.col })),
      ring: { open: this.ring.isOpen, mode: this.ring.mode, plot: this.ring.plot, tokens: this.ring.tokenPositions() },
      fit: this.map.fit,
      horn: this.hud.hornPosition,
      artNotes: this.art.notes,
    };
  }
}
