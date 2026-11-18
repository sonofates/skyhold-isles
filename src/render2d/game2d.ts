import { Container, Sprite, type Application } from 'pixi.js';
import { EventBus, type GameEventMap } from '../core/eventBus.ts';
import { FixedTimestepStepper } from '../core/gameLoop.ts';
import type { GameSettings, SpeedMultiplier, TargetingMode, TowerType } from '../core/types.ts';
import { LEVELS } from '../data/levels/index.ts';
import { BALANCE } from '../data/balance.ts';
import type { LevelDef } from '../data/levels/types.ts';
import { NEUTRAL_RUN_MODIFIERS, type RunModifiers } from '../data/runModifiers.ts';
import { getTowerTierStats, TOWER_DEFS } from '../data/towers.ts';
import { bindHaptics, haptics } from '../platform/haptics.ts';
import { isTouchDevice, loadSettings } from '../platform/storage.ts';
import type { TowerEntity } from '../sim/entities.ts';
import { computeSellRefund, SimWorld } from '../sim/world.ts';
import type { LoadedArt } from './assets2d.ts';
import { Audio2D, bindAudio2D, bindBackgroundLifecycle2D, screenPan, type BackgroundLifecycleHandle2D } from './audio2d.ts';
import { AdaptiveQuality, qualityOverride, renderResolution } from './renderResolution.ts';
import { BuildRing, type RingAction } from './buildRing.ts';
import { DamageNumbers2D } from './damageNumbers2d.ts';
import { EndPanel, endStars } from './endPanel.ts';
import { EnemyLayer } from './enemyLayer.ts';
import { FxLayer } from './fxLayer.ts';
import { GateLayer } from './gateLayer.ts';
import { Hud, type HudState } from './hud.ts';
import { WorldLayers } from './layers.ts';
import { MapView } from './mapView.ts';
import { PlotLayer, type PlotState } from './plotLayer.ts';
import { createProcTextures, type ProcTextures } from './procTextures.ts';
import { ProjectileLayer } from './projectileLayer.ts';
import {
  audioSettings2d,
  createShakeState2D,
  resetShakeState2D,
  shouldVibrate2D,
  stepShake2D,
  triggerShake2D,
  type AudioSettings2D,
} from './settings2d.ts';
import { bindSpecialFx, createSpecialFxStats } from './specialFx.ts';
import { SoldierLayer, withBarracksArt } from './soldierLayer.ts';
import { MeleeDirector } from './meleeDirector.ts';
import { meleeLookFor } from './meleeLook.ts';
import { TowerLayer } from './towerLayer.ts';
import { readSafeInsets } from './uiKit.ts';
import { NO_INSETS, type Insets } from './uiLayout.ts';

// This module is loaded by both routes of 2d.html, including the DOM-only world map.
// Install gesture listeners before async artwork loading, so a tap during boot can unlock audio.
const audio = typeof document === 'undefined' ? null : new Audio2D();

const TARGET_CYCLE: readonly TargetingMode[] = ['first', 'last', 'strongest', 'closest'];

/** Tap = pointer released within this distance (css px) and time of the press. */
const TAP_SLOP = 14;
const TAP_MS = 700;

export interface Game2DHooks {
  /** Runs before each fixed sim tick (bench top-up, autoplay). */
  beforeTick?: (world: SimWorld) => void;
  /** Disable the win/lose overlay + restart (bench). */
  endless?: boolean;
  /** Run modifiers (Workshop upgrades + challenge / Daily rules) passed to SimWorld. */
  modifiers?: RunModifiers;
  /** Start SimWorld in Endless mode from wave 1 (`startEndlessFromStart()`), keeping normal defeat flow. */
  startEndless?: boolean;
  /** Optional settings provider (defaults to shared `loadSettings()` from `platform/storage`). */
  getSettings?: () => GameSettings;
  /** End panel "Next" (shown only when given) and "Menu" targets. */
  onNext?: () => void;
  onMenu?: () => void;
  /** The end panel opened / closed (DOM overlays, e.g. the Codex button, hide meanwhile). */
  onEndPanel?: (shown: boolean) => void;
  /** Fired when active gameplay enters/leaves background (`platform.onPause` / `visibilitychange`). */
  onBackgroundChange?: (inBackground: boolean) => void;
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
  readonly plots: PlotLayer;
  readonly projectiles: ProjectileLayer;
  readonly fx: FxLayer;
  readonly damageNumbers: DamageNumbers2D;
  readonly soldiers: SoldierLayer;
  /** Melee fight state shared by the enemy and soldier layers (swings, facing, spacing, flash). */
  readonly melee: MeleeDirector;
  readonly gates: GateLayer;
  readonly hud: Hud;
  readonly ring: BuildRing;
  readonly end: EndPanel;
  private insets: Insets = NO_INSETS;
  private endShown = false;
  /** Event-FX counters (QA). */
  readonly fxStats = createSpecialFxStats();
  readonly stepper = new FixedTimestepStepper();
  private readonly rangeDisc: Sprite;
  private readonly screen = new Container();
  private readonly hooks: Game2DHooks;
  private readonly costs = new Map<TowerType, number>();
  world!: SimWorld;
  events!: EventBus;
  private selectedTower = -1;
  /** Barracks waiting for a road tap to move its rally point (-1 = none). */
  private rallyTower = -1;
  private down: { x: number; y: number; t: number } | null = null;
  /** Free plot under the mouse (desktop hover glow), or -1. */
  private hoverPlot = -1;
  private minCost = 0;
  private settings: GameSettings = loadSettings();
  private readonly shake = createShakeState2D();
  private simClockSec = 0;
  private activeDamagePopups = 0;
  private unbindAudio: (() => void) | null = null;
  private readonly quality: AdaptiveQuality;
  private readonly dprOverride: number | undefined;
  private readonly benchWave: number;
  private unbindHaptics: (() => void) | null = null;
  private lifecycle: BackgroundLifecycleHandle2D | null = null;
  /** Tesla bolts waiting for their tower's painted release frame (sim seconds left). */
  private readonly boltQueue: { t: number; points: GameEventMap['lightningChain']['points']; overload: boolean; muzzle: number }[] = [];
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
    art = withBarracksArt(art);
    this.app = app;
    const query = new URLSearchParams(location.search);
    this.quality = new AdaptiveQuality(qualityOverride(query.get('quality')));
    this.dprOverride = Number(query.get('dpr')) || undefined;
    this.benchWave = hooks.endless && Number(query.get('bench')) > 0 ? Number(query.get('wave')) : 0;
    this.art = art;
    this.level = level;
    this.hooks = hooks;
    this.tex = createProcTextures();
    this.map = new MapView(art.map, level.layout2d);
    this.layers = new WorldLayers(this.map.world);
    this.gates = new GateLayer(this.layers.actors, level.layout2d.gates ?? [], art.overlays);
    this.rangeDisc = new Sprite(this.tex.rangeDisc);
    this.rangeDisc.anchor.set(0.5);
    this.rangeDisc.visible = false;
    this.layers.groundFx.addChild(this.rangeDisc);
    this.fx = new FxLayer(this.map, this.layers.groundFx, this.layers.fx, {
      puff: this.tex.puff,
      ring: this.tex.ring,
      coin: art.ui.gold,
      spark: this.tex.spark,
      glow: this.tex.glow,
      flash: this.tex.spark,
      wring: this.tex.wring,
      crater: this.tex.crater,
      shard: this.tex.shard,
      orb: this.tex.orb,
    });
    this.fx.setQuality(this.quality.tier);
    this.damageNumbers = new DamageNumbers2D(this.map, this.layers.fx);
    this.enemies = new EnemyLayer(art, this.map, this.layers, this.tex, this.fx);
    this.plots = new PlotLayer(level.layout2d, art.plot, this.tex);
    this.layers.plots.addChild(this.plots.root);
    this.towers = new TowerLayer(art, this.map, this.layers, this.tex, this.fx, this.plots.geometry, (t) => this.towerHasTarget(t));
    this.projectiles = new ProjectileLayer(
      this.map,
      this.layers.projectiles,
      this.layers.shadows,
      this.tex,
      (p) => this.towers.muzzleOf(p.towerId, p.towerType),
      this.fx,
      (p) => this.towers.shotDelayOf(p.towerId),
      (p) => this.towers.muzzlePointOf(p.towerId),
    );
    this.soldiers = new SoldierLayer(art, this.map, this.layers, this.tex, this.fx);
    this.melee = new MeleeDirector(meleeLookFor(art));
    this.enemies.setMelee(this.melee);
    this.soldiers.setMelee(this.melee);
    this.hud = new Hud(art);
    this.ring = new BuildRing(art);
    this.end = new EndPanel(art);
    this.screen.addChild(this.hud.root, this.ring.root, this.end.root);
    app.stage.addChild(this.map.root, this.screen);
    const banned = hooks.modifiers?.bannedTowers ?? [];
    let minAllowed = Infinity;
    for (const t of art.manifest.buildRing) {
      const c = getTowerTierStats(t, 1).upgradeCost;
      this.costs.set(t, c);
      if (!banned.includes(t) && c < minAllowed) minAllowed = c;
    }
    this.minCost = Number.isFinite(minAllowed) ? minAllowed : Math.min(...this.costs.values());
    this.newRun();
  }

  /**
   * Render-side estimate of "this tower has something to shoot" (drives the attack-sheet pre-roll):
   * a live enemy inside its (beacon-buffed) range ring that it can hit (flyers / mortar blind spot).
   */
  private towerHasTarget(t: TowerEntity): boolean {
    const def = TOWER_DEFS[t.type];
    if (def.role !== 'attack') return false;
    const st = getTowerTierStats(t.type, t.tier);
    const maxSq = (st.range * (1 + t.auraRange)) ** 2;
    const minSq = st.minRange * st.minRange;
    const pool = this.world.enemyPool;
    for (let i = 0; i < pool.getActiveCount(); i++) {
      const e = pool.items[pool.getActiveIndex(i)];
      if (!e.active || e.hp <= 0 || (e.flying && !def.hitsFlyers)) continue;
      const d = (e.x - t.x) ** 2 + (e.z - t.z) ** 2;
      if (d <= maxSq && d >= minSq) return true;
    }
    return false;
  }

  /** Live 2D audio settings resolved from shared `GameSettings` + `musicPrefs`. */
  get audioSettings(): AudioSettings2D {
    return audioSettings2d(this.currentSettings());
  }

  currentSettings(): GameSettings {
    return this.hooks.getSettings ? this.hooks.getSettings() : this.settings;
  }

  /** Reloads persisted `GameSettings` from storage and syncs haptics. */
  refreshSettings(): void {
    this.settings = loadSettings();
    audio?.sync(this.audioSettings);
    haptics.setEnabled(shouldVibrate2D(this.currentSettings(), isTouchDevice()));
  }

  /** Starts (or restarts) a run on the level. */
  newRun(): void {
    this.unbindHaptics?.();
    this.unbindAudio?.();
    this.refreshSettings();
    this.events = new EventBus();
    this.unbindHaptics = bindHaptics(this.events);
    this.world = new SimWorld(this.level, this.events, this.hooks.modifiers ?? NEUTRAL_RUN_MODIFIERS);
    if (this.hooks.startEndless) this.world.startEndlessFromStart();
    this.stepper.simActive = true;
    this.stepper.paused = false;
    this.stepper.resetAccumulator();
    this.ring.close();
    if (this.endShown) this.hooks.onEndPanel?.(false);
    this.end.hide();
    this.endShown = false;
    this.selectedTower = -1;
    this.rangeDisc.visible = false;
    this.enemies.reset();
    this.fx.clear();
    this.damageNumbers.clear();
    resetShakeState2D(this.shake);
    this.map.root.position.set(0, 0);
    this.simClockSec = 0;
    this.activeDamagePopups = 0;
    this.soldiers.reset();
    this.melee.reset();
    this.rallyTower = -1;
    this.boltQueue.length = 0;
    if (audio) {
      audio.sound.setMusicContext(LEVELS[this.level.index]?.id ?? this.level.id, 'build');
      this.unbindAudio = bindAudio2D(this.events, audio.sound,
        x => screenPan(this.map.screenX(this.map.pxX(x)), this.app.screen.width),
        id => this.world.soldierSystem.soldiers.find(s => s.id === id)?.x);
    }
    this.wireEvents();
    if (Number.isSafeInteger(this.benchWave) && this.benchWave > 0) this.world.debugSkipToWave(this.benchWave);
  }

  private wireEvents(): void {
    const ev = this.events;
    const m = this.map;
    const ppu = this.level.layout2d!.pxPerUnit;
    this.towers.bind(ev);
    bindSpecialFx(
      ev,
      {
        fx: this.fx,
        map: m,
        towerById: (id) => this.world.getTowerById(id) ?? undefined,
        towers: () => this.world.towers,
      },
      this.fxStats,
    );
    this.melee.wire(ev);
    this.soldiers.wire(ev);
    ev.on('lightningChain', (e) => {
      // points[0] is the firing tower: draw the bolt at its painted release frame, from its muzzle.
      const p0 = e.points[0];
      const t = this.world.towers.find((x) => Math.abs(x.x - p0.x) < 1e-6 && Math.abs(x.z - p0.z) < 1e-6);
      const muzzle = t ? this.towers.muzzleOf(t.id, t.type) : this.towers.muzzleHeight('tesla');
      const delay = t ? this.towers.predictShotDelay(t.id, t.type, t.tier) : 0;
      if (delay > 0) this.boltQueue.push({ t: delay, points: e.points.map((q) => ({ ...q })), overload: e.overload === true, muzzle });
      else this.fx.bolt(e.points, e.overload === true, muzzle);
      if (e.overload && !this.hooks.endless) triggerShake2D(this.shake, 0.014, this.currentSettings());
    });
    ev.on('towerFired', (e) => {
      if (this.hooks.endless) return;
      if (e.type === 'mortar') triggerShake2D(this.shake, 0.02, this.currentSettings());
      else if (e.type === 'cannon') triggerShake2D(this.shake, 0.012, this.currentSettings());
      else if (e.type === 'ballista') triggerShake2D(this.shake, 0.008, this.currentSettings());
    });
    ev.on('projectileImpact', (e) => {
      if (!this.hooks.endless && e.towerType === 'mortar') {
        triggerShake2D(this.shake, BALANCE.camera.mortarImpactShake, this.currentSettings());
      }
    });
    ev.on('meteorImpact', () => {
      if (!this.hooks.endless) triggerShake2D(this.shake, BALANCE.camera.bossHitShake * 0.9, this.currentSettings());
    });
    ev.on('bossPhase', (e) => {
      if (!this.hooks.endless) {
        triggerShake2D(this.shake, BALANCE.camera.bossHitShake * (e.phase >= 2 ? 0.85 : 0.55), this.currentSettings());
      }
    });
    ev.on('enemyHit', (e) => {
      if (this.hooks.endless) return;
      this.damageNumbers.spawn(e, this.simClockSec, this.currentSettings());
    });
    ev.on('enemyKilled', (e) => {
      const px = m.pxX(e.x);
      const py = m.pxY(e.z) - e.y * 0.9 * ppu;
      this.fx.puffs(px, py - 14, 7, 12);
      this.fx.spawn('coin', px, py - 30, 26, 0, -70, 0.8);
      if (!this.hooks.endless && (e.enemyType === 'boss' || e.enemyType === 'tempest')) {
        triggerShake2D(this.shake, BALANCE.camera.bossHitShake, this.currentSettings());
      }
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

  private applyResolution(w: number, h: number): void {
    const resolution = renderResolution(w, h, window.devicePixelRatio, this.dprOverride, this.quality.tier) * this.quality.resolutionScale;
    if (this.app.renderer.resolution !== resolution) this.app.renderer.resolution = resolution;
  }

  resize(w: number, h: number): void {
    this.applyResolution(w, h);
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
    this.insets = readSafeInsets();
    this.ring.insets = this.insets;
    // Horn sits on the open grass right of the cave mouths (≈ 30 image px east, 8 px up of their
    // midpoint): clear of both caves, the roads and the plots; its label goes above it.
    const hornPx = this.map.pxX(ex) + 30;
    const hornPy = this.map.pxY(ez) - 8;
    this.hud.layout(w, h, { x: this.map.screenX(hornPx), y: this.map.screenY(hornPy) }, this.insets);
    this.end.layout(w, h, this.insets);
    this.ring.close();
    this.rangeDisc.visible = false;
  }

  /** One rendered frame. */
  frame(dtSec: number): void {
    if (this.quality.observe(this.app.ticker.elapsedMS, !document.hidden)) {
      this.fx.setQuality(this.quality.tier);
      this.applyResolution(this.app.screen.width, this.app.screen.height);
    }
    audio?.sound.setMusicDucked(this.stepper.paused);
    const world = this.world;
    const res = this.stepper.step(dtSec, (fixedDt) => {
      this.simClockSec += fixedDt;
      this.hooks.beforeTick?.(world);
      world.fixedTick(fixedDt);
    });
    const alpha = res.alpha;
    const simDt = this.stepper.paused ? 0 : dtSec * this.stepper.speed;
    const cfg = this.currentSettings();
    this.towers.sync(world.towers, dtSec, simDt);
    for (let i = this.boltQueue.length - 1; i >= 0; i--) {
      const b = this.boltQueue[i];
      b.t -= simDt;
      if (b.t <= 0) {
        this.fx.bolt(b.points, b.overload, b.muzzle);
        this.boltQueue.splice(i, 1);
      }
    }
    const grid = world.grid;
    const plotState = (i: number): PlotState => {
      const id = grid.getTowerIdAt(i, 0);
      if (id === -1) return 'free';
      const t = world.getTowerById(id);
      return t && this.towers.ringOf(t.type, t.tier) ? 'covered' : 'legacy';
    };
    this.plots.sync(plotState, this.hoverPlot, this.ring.isOpen ? this.ring.plot : -1, world.gold < this.minCost, dtSec);
    this.melee.update(world.soldierSystem, world.enemyPool, alpha, simDt);
    this.enemies.syncPool(world.enemyPool, alpha, simDt);
    this.projectiles.sync(world.projectilePool, alpha);
    this.soldiers.sync(world.soldierSystem, alpha, simDt, dtSec, this.selectedTower, this.rallyTower);
    this.fx.update(simDt > 0 ? simDt : dtSec * 0.25);
    this.activeDamagePopups = this.hooks.endless ? 0 : this.damageNumbers.update(simDt > 0 ? dtSec : 0, cfg);
    if (!this.hooks.endless) {
      stepShake2D(this.shake, simDt > 0 && !this.endShown ? dtSec : 0, cfg);
      if (simDt > 0 && !this.endShown && (this.shake.offsetX !== 0 || this.shake.offsetY !== 0)) {
        const unitPx = this.level.layout2d!.pxPerUnit * this.map.fit.scale;
        this.map.root.position.set(this.shake.offsetX * unitPx, this.shake.offsetY * unitPx);
      } else {
        this.map.root.position.set(0, 0);
      }
    }
    this.ring.update(dtSec, world.gold);
    this.syncRangePreview();

    // A selected tower could be sold or the run reset.
    if (this.selectedTower !== -1 && !world.getTowerById(this.selectedTower)) this.closeRing();
    if (this.rallyTower !== -1 && !world.getTowerById(this.rallyTower)) this.closeRing();

    const over = this.syncHud(dtSec);
    if (over && !this.endShown) {
      this.endShown = true;
      this.closeRing();
      const won = world.outcome === 'won';
      this.end.show({
        won,
        stars: endStars(won, won ? world.computeStars() : 0),
        lives: world.lives,
        startLives: world.startingLives,
        gold: world.gold,
        wave: this.hudState.wave,
        totalWaves: this.hudState.totalWaves,
        hasNext: !!this.hooks.onNext,
      });
      this.hooks.onEndPanel?.(true);
    }
    this.end.update(dtSec);
  }

  private syncHud(dtSec: number): boolean {
    const world = this.world;
    const s = this.hudState;
    s.lives = world.lives;
    s.gold = world.gold;
    s.wave = world.waveSystem.currentWaveOneBased;
    s.totalWaves = world.waveSystem.totalWaves;
    s.paused = this.stepper.paused;
    s.speed = this.stepper.speed;
    s.canCall = world.outcome === 'ongoing' && world.waveSystem.canStartNextWave();
    const rawBonus = s.canCall ? world.waveSystem.getEarlyCallBonus() : 0;
    s.earlyBonus = world.mods.waveBonusMul === 1 ? rawBonus : Math.max(0, Math.round(rawBonus * world.mods.waveBonusMul));
    const over = world.outcome !== 'ongoing' && !this.hooks.endless;
    s.banner = over ? '' : this.stepper.paused ? 'Paused' : this.rallyTower !== -1 ? 'Tap the road' : '';
    this.hud.update(s as HudState, dtSec);
    return over;
  }

  /**
   * Freezes active 2D play when the app is sent to the background (`getPlatform().onPause` or
   * `document.visibilitychange`) and immediately updates the HUD to the existing `'Paused'` state,
   * keeping play paused on resume until the player deliberately unpauses.
   */
  pauseForBackground(): boolean {
    if (this.hooks.endless || this.endShown || this.world.outcome !== 'ongoing') return false;
    this.down = null;
    this.hoverPlot = -1;
    this.closeRing();
    this.stepper.paused = true;
    this.stepper.resetAccumulator();
    audio?.sound.setMusicDucked(true);
    this.syncHud(0);
    return true;
  }

  /** Range circle on the map: the tower the ring points at (selected / hovered), else the selected tower. */
  private syncRangePreview(): void {
    if (!this.ring.isOpen) return;
    const pv = this.ring.preview;
    const p = this.level.layout2d!.plots[this.ring.plot];
    if (!p) return;
    let type: TowerType | null = pv ? pv.type : null;
    let tier: 1 | 2 | 3 = pv ? pv.tier : 1;
    if (!type && this.selectedTower !== -1) {
      const t = this.world.getTowerById(this.selectedTower);
      if (t) {
        type = t.type;
        tier = t.tier as 1 | 2 | 3;
      }
    }
    if (!type) {
      this.rangeDisc.visible = false;
      return;
    }
    const range = getTowerTierStats(type, tier).range;
    const ppu = this.level.layout2d!.pxPerUnit;
    this.rangeDisc.position.set(this.map.pxX(p.x), this.map.pxY(p.z));
    this.rangeDisc.scale.set((range * ppu * 2) / this.tex.rangeDisc.width);
    this.rangeDisc.visible = true;
  }

  /** QA / debug: ends the run now (`won` or `lost`). */
  forceEnd(outcome: 'won' | 'lost'): void {
    if (outcome === 'won') this.world.debugForceWin();
    else this.world.debugForceLose();
  }

  private closeRing(): void {
    this.ring.close();
    this.selectedTower = -1;
    this.rallyTower = -1;
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
      this.ring.openBuild(plot, c.x, c.y, world.gold, this.costs, w, h, this.hud.topBand, world.mods.bannedTowers);
      return;
    }
    const t = world.getTowerById(towerId);
    if (!t) return;
    this.selectedTower = t.id;
    const next = t.tier < 3 ? getTowerTierStats(t.type, (t.tier + 1) as 2 | 3).upgradeCost : null;
    // Ring centred on the tower's body (not its plot), kept off it.
    const box = this.towers.spriteRect(t.id);
    const keepOut = box
      ? {
          x: this.map.screenX(box.x),
          y: this.map.screenY(box.y),
          w: box.w * this.map.fit.scale,
          h: box.h * this.map.fit.scale,
        }
      : null;
    this.ring.openTower(
      plot,
      c.x,
      keepOut ? keepOut.y + keepOut.h * 0.55 : c.y - 30,
      {
        type: t.type,
        tier: t.tier,
        upgradeCost: next,
        refund: computeSellRefund(t.totalInvested),
        ...(t.type === 'barracks' ? { rallyIcon: this.soldiers.flagTexture } : {}),
        ...(TOWER_DEFS[t.type].role === 'attack' ? { targeting: t.targetingMode } : {}),
        ...(keepOut ? { keepOut } : {}),
      },
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
    } else if (action.kind === 'target') {
      const t = this.selectedTower !== -1 ? world.getTowerById(this.selectedTower) : null;
      if (t) {
        const next = TARGET_CYCLE[(TARGET_CYCLE.indexOf(t.targetingMode) + 1) % TARGET_CYCLE.length];
        world.setTowerTargeting(t.id, next);
        this.ring.setTargetMode(next);
      }
      return;
    } else if (action.kind === 'rally') {
      // Keep the range disc up: the next tap inside it on the road plants the flag.
      const id = this.selectedTower;
      this.ring.close();
      this.rallyTower = id;
      return;
    } else {
      if (this.selectedTower !== -1) world.sellTower(this.selectedTower);
    }
    this.closeRing();
  }

  /** Handles a tap at screen (css px) coordinates. */
  tap(x: number, y: number): void {
    const world = this.world;
    if (this.end.visible) {
      const a = this.end.hit(x, y);
      if (a === 'retry') this.newRun();
      else if (a === 'next') this.hooks.onNext?.();
      else if (a === 'menu') this.hooks.onMenu?.();
      return;
    }
    if (world.outcome !== 'ongoing' && !this.hooks.endless) return;
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
    if (this.rallyTower !== -1) {
      world.setRallyPoint(this.rallyTower, wx, wz);
      this.closeRing();
      return;
    }
    let plot = world.grid.findPlotAt(wx, wz, 1.25);
    if (plot === -1) {
      // Tapping a tower's body (drawn above its plot, up to its top) selects it too.
      const mx = (x - this.map.fit.offsetX) / this.map.fit.scale;
      const my = (y - this.map.fit.offsetY) / this.map.fit.scale;
      plot = this.towers.plotAtSprite(mx, my, world.towers);
    }
    if (plot === -1 || (this.ring.isOpen && this.ring.plot === plot)) {
      this.closeRing();
      return;
    }
    haptics.pulse('tap');
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
    // Desktop hover: glow the free plot under the mouse (touch has no hover).
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      if (this.ring.isOpen && this.ring.hover(e.clientX - r.left, e.clientY - r.top)) {
        this.hoverPlot = -1;
        canvas.style.cursor = 'pointer';
        return;
      }
      const mx = (e.clientX - r.left - this.map.fit.offsetX) / this.map.fit.scale;
      const my = (e.clientY - r.top - this.map.fit.offsetY) / this.map.fit.scale;
      this.hoverPlot = this.plots.plotAtPx(mx, my);
      canvas.style.cursor = this.hoverPlot !== -1 && this.world.grid.getTowerIdAt(this.hoverPlot, 0) === -1 ? 'pointer' : '';
    });
    canvas.addEventListener('pointerleave', () => {
      this.hoverPlot = -1;
    });
    window.addEventListener('storage', () => this.refreshSettings());
    window.addEventListener('focus', () => this.refreshSettings());
    this.lifecycle?.dispose();
    this.lifecycle = bindBackgroundLifecycle2D({
      onBackground: () => {
        this.pauseForBackground();
        this.hooks.onBackgroundChange?.(true);
      },
      onForeground: () => {
        this.refreshSettings();
        // Deliberately keep `this.stepper.paused === true` and `'Paused'` banner on resume.
        this.hooks.onBackgroundChange?.(false);
      },
      onOverlayPause: () => {
        this.pauseForBackground();
      },
    });
    if (this.lifecycle.inBackground) {
      this.pauseForBackground();
      this.hooks.onBackgroundChange?.(true);
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ') this.stepper.paused = !this.stepper.paused;
      else if (e.key === '1') this.stepper.speed = 1;
      else if (e.key === '2') this.stepper.speed = 2;
      else if (e.key === 'n' || e.key === 'N') this.world.startNextWave();
      else if (e.key === 'Escape') this.closeRing();
    });
  }

  /** QA: ground enemies in map px with their lane, distance walked and distance left (world units). */
  private enemyPx(): { type: string; lane: number; dist: number; toGoal: number; px: number; py: number }[] {
    const w = this.world;
    const out: { type: string; lane: number; dist: number; toGoal: number; px: number; py: number }[] = [];
    const pool = w.enemyPool;
    for (let i = 0; i < pool.getActiveCount(); i++) {
      const e = pool.items[pool.getActiveIndex(i)];
      if (!e.active || e.flying) continue;
      const r2 = (v: number): number => Math.round(v * 100) / 100;
      out.push({
        type: e.type,
        lane: e.lane,
        dist: r2(e.dist),
        toGoal: r2(e.totalDist - e.dist),
        px: Math.round(this.map.pxX(e.x)),
        py: Math.round(this.map.pxY(e.z)),
      });
    }
    return out;
  }

  /** Debug / QA snapshot. */
  debugState(): Record<string, unknown> {
    const w = this.world;
    return {
      gold: w.gold,
      lives: w.lives,
      wave: w.waveSystem.currentWaveOneBased,
      waveState: w.waveSystem.state,
      quality: this.quality.tier,
      endless: w.waveSystem.isEndless,
      modifiers: w.mods,
      outcome: w.outcome,
      enemies: w.enemyPool.getActiveCount(),
      projectiles: w.projectilePool.getActiveCount(),
      paused: this.stepper.paused,
      speed: this.stepper.speed,
      towers: w.towers.map((t) => ({ id: t.id, type: t.type, tier: t.tier, plot: t.col, targeting: t.targetingMode })),
      ring: { open: this.ring.isOpen, mode: this.ring.mode, plot: this.ring.plot, tokens: this.ring.tokenPositions(), layout: this.ring.layoutInfo, rangeShown: this.rangeDisc.visible },
      hud: this.hud.rects(),
      end: this.end.debug(),
      insets: this.insets,
      fit: this.map.fit,
      mapInfo: { key: this.art.mapKey, texelScale: this.map.texelScale, gateFronts: this.gates.sprites.length },
      enemyPx: this.enemyPx(),
      horn: this.hud.hornPosition,
      buttons: this.hud.buttonPositions,
      fx: {
        boltsDrawn: this.fx.boltsDrawn,
        particlesSpawned: this.fx.particlesSpawned,
        beamsDrawn: this.fx.beamsDrawn,
        zonesSpawned: this.fx.zonesSpawned,
        pools: this.fx.stats(),
        events: this.fxStats,
        towerFired: this.towers.firedSeen,
        towerSpecial: this.towers.specialSeen,
        trails: this.projectiles.trailsRequested,
        markers: this.towers.markers(),
        extras: this.enemies.specials.extrasCreated,
      },
      barracks: { ...this.soldiers.debug(w.soldierSystem), rallyMode: this.rallyTower, melee: { ...this.melee.stats } },
      turrets: { shots: this.towers.turretShots, views: this.towers.turretReport() },
      plots: {
        count: this.plots.geometry.rects.length,
        visible: this.plots.visibleCount,
        hover: this.hoverPlot,
        rings: this.plots.geometry.rings,
        towerRings: this.towers.ringReport(w.towers),
        attacksPlayed: this.towers.attacksPlayed,
        shotsPrerolled: this.towers.shotsPrerolled,
        shotsDelayed: this.towers.shotsDelayed,
      },
      mips: {
        map: this.art.map.source.mipLevelCount,
        plot: this.art.plot?.texture.source.mipLevelCount ?? null,
        tower: this.art.towers.archer?.tiers[0].source.mipLevelCount ?? null,
      },
      artNotes: this.art.notes,
      settings: {
        audio: this.audioSettings,
        cameraShake: this.currentSettings().cameraShake,
        damageNumbers: this.currentSettings().damageNumbers,
        haptics: this.currentSettings().haptics,
      },
      shake: { offsetX: this.shake.offsetX, offsetY: this.shake.offsetY, triggers: this.shake.triggers },
      damagePopups: { active: this.activeDamagePopups, spawned: this.damageNumbers.pool.spawned },
    };
  }
}
