import { Container, Graphics, NineSliceSprite, Sprite, Text, Texture, type Application, type TextureSource } from 'pixi.js';
import { EventBus } from '../core/eventBus.ts';
import { FixedTimestepStepper } from '../core/gameLoop.ts';
import type { AbilityId, GameSettings, HeroSkillSlot, SpeedMultiplier, TargetingMode, TowerType, Vec3 } from '../core/types.ts';
import { LEVELS } from '../data/levels/index.ts';
import { BALANCE } from '../data/balance.ts';
import type { LevelDef } from '../data/levels/types.ts';
import { NEUTRAL_RUN_MODIFIERS, type RunModifiers } from '../data/runModifiers.ts';
import { getTowerTierStats, TOWER_DEFS } from '../data/towers.ts';
import { bindHaptics, haptics } from '../platform/haptics.ts';
import { isTouchDevice, loadSettings } from '../platform/storage.ts';
import type { TowerEntity } from '../sim/entities.ts';
import type { HeroInitConfig, HeroRuntimeState } from '../sim/heroSystem.ts';
import { computeSellRefund, SimWorld, type AbilityRuntimeState } from '../sim/world.ts';
import { collectArtTextureSources, type LoadedArt } from './assets2d.ts';
import { Audio2D, bindAudio2D, bindBackgroundLifecycle2D, screenPan, type BackgroundLifecycleHandle2D } from './audio2d.ts';
import { AdaptiveQuality, isDesktopClient, isSoftwareRenderer, qualityOverride, renderResolution, type QualityTier } from './renderResolution.ts';
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
import { anySheetOpen } from './ui/dom.ts';
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
  /** Selected hero configuration passed to SimWorld (`null` / `undefined` = no hero). */
  hero?: HeroInitConfig | null;
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
  /** Default starting quality tier when no `?quality=` override is locked. */
  initialUnlockedTier?: QualityTier;
}

const SYNC_PIXEL = new Uint8Array(4);

/** Synchronously drains the browser's OOP-GPU command buffer during boot prewarm (`#boot` cover). */
function flushGpu(gl: WebGLRenderingContext | WebGL2RenderingContext | undefined): void {
  if (!gl) return;
  try {
    gl.finish();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, SYNC_PIXEL);
  } catch {
    // ignore lost context or mock GL in headless tests
  }
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
  private hudGoldTimer = 0;
  private hudGoldDirty = true;
  /** Tesla bolts waiting for their tower's painted release frame (pooled, sim seconds left). */
  private readonly boltQueue: { t: number; points: Vec3[]; count: number; view: Vec3[]; overload: boolean; muzzle: number }[] = [];
  private boltActive = 0;
  private readonly onFixedTick = (fixedDt: number): void => {
    this.simClockSec += fixedDt;
    this.hooks.beforeTick?.(this.world);
    this.world.fixedTick(fixedDt);
  };
  private readonly plotStateFn = (i: number): PlotState => {
    const id = this.world.grid.getTowerIdAt(i, 0);
    if (id === -1) return 'free';
    const t = this.world.getTowerById(id);
    return t && this.towers.ringOf(t.type, t.tier) ? 'covered' : 'legacy';
  };
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
    this.quality = new AdaptiveQuality(qualityOverride(query.get('quality')), hooks.initialUnlockedTier ?? 'high', isDesktopClient(query));
    this.dprOverride = Number(query.get('dpr')) || undefined;
    this.benchWave = hooks.endless && Number(query.get('bench')) > 0 ? Number(query.get('wave')) : 0;
    this.art = art;
    this.level = level;
    this.hooks = hooks;
    this.tex = createProcTextures();
    this.map = new MapView(art.map.texture, level.layout2d);
    this.layers = new WorldLayers(this.map.world);
    this.gates = new GateLayer(this.layers.actors, level.layout2d.gates ?? [], art.map.overlays);
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
      (p) => (p.towerId > 0 ? this.towers.muzzleOf(p.towerId, p.towerType) : p.startY),
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
    const heroCfg = this.hooks.hero;
    this.world = new SimWorld(
      this.level,
      this.events,
      this.hooks.modifiers ?? NEUTRAL_RUN_MODIFIERS,
      heroCfg
        ? {
            heroId: heroCfg.heroId,
            heroLevel: heroCfg.level,
            heroSkills: heroCfg.skills,
            seed: heroCfg.seed,
          }
        : undefined,
    );
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
    this.boltActive = 0;
    this.hudGoldDirty = true;
    this.hudGoldTimer = 0;
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
      let t: TowerEntity | null = null;
      const towers = this.world.towers;
      for (let i = 0; i < towers.length; i++) {
        const cand = towers[i];
        if (Math.abs(cand.x - p0.x) < 1e-6 && Math.abs(cand.z - p0.z) < 1e-6) {
          t = cand;
          break;
        }
      }
      const muzzle = t ? this.towers.muzzleOf(t.id, t.type) : this.towers.muzzleHeight('tesla');
      const delay = t ? this.towers.predictShotDelay(t.id, t.type, t.tier) : 0;
      if (delay > 0) this.enqueueBolt(delay, e.points, e.overload === true, muzzle);
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
    ev.on('towerBuilt', (e) => {
      this.hudGoldDirty = true;
      this.fx.puffs(m.pxX(e.x), m.pxY(e.z), 10, 30, 0xe9d8b4);
    });
    ev.on('towerUpgraded', (e) => {
      this.hudGoldDirty = true;
      this.fx.puffs(m.pxX(e.x), m.pxY(e.z), 8, 26, 0xfff0c0);
      this.fx.spawn('flash', m.pxX(e.x), m.pxY(e.z) - 60, 50, 0, 0, 0.3);
    });
    ev.on('towerSold', (e) => {
      this.hudGoldDirty = true;
      this.fx.puffs(m.pxX(e.x), m.pxY(e.z), 10, 30, 0xe9d8b4);
      this.fx.spawn('coin', m.pxX(e.x), m.pxY(e.z) - 40, 34, 0, -60, 0.9);
    });
    ev.on('waveStarted', () => {
      this.hudGoldDirty = true;
    });
    ev.on('waveCompleted', () => {
      this.hudGoldDirty = true;
    });
  }

  private enqueueBolt(delay: number, pts: readonly Vec3[], overload: boolean, muzzle: number): void {
    let slot = this.boltQueue[this.boltActive];
    if (!slot) {
      slot = { t: 0, points: [], count: 0, view: [], overload: false, muzzle: 0 };
      this.boltQueue[this.boltActive] = slot;
    }
    slot.t = delay;
    slot.overload = overload;
    slot.muzzle = muzzle;
    slot.count = pts.length;
    slot.view.length = pts.length;
    for (let i = 0; i < pts.length; i++) {
      let dst = slot.points[i];
      if (!dst) dst = slot.points[i] = { x: 0, y: 0, z: 0 };
      dst.x = pts[i].x;
      dst.y = pts[i].y;
      dst.z = pts[i].z;
      slot.view[i] = dst;
    }
    this.boltActive++;
  }

  /** Marks numeric HUD counters dirty so the next frame refreshes them without waiting for the combat rollup window. */
  markHudDirty(): void {
    this.hudGoldDirty = true;
  }

  /**
   * Pre-uploads all loaded & procedural `TextureSource`s (+ mipmaps), pre-compiles all Pixi shader
   * pipelines (`Sprite` normal/add, `Graphics` normal/add, `NineSliceSprite`, `Text`), pre-warms
   * pooled entity/particle sprites, and calibrates initial adaptive resolution before Wave 1 starts.
   */
  prewarm(opts: { readonly benchSteps?: number } = {}): void {
    const renderer = this.app.renderer as unknown as {
      gl?: WebGL2RenderingContext;
      texture?: { initSource?: (src: TextureSource) => void };
      renderPipes?: { text?: { initGpuText?: (t: Text) => void } };
    };
    const gl = renderer.gl;

    // 1. Pre-allocate pooled views so wave spawns and volleys allocate no Sprites on the hot path.
    this.enemies.prewarm(160);
    this.projectiles.prewarm(64);
    this.fx.prewarm(this.quality.tier === 'high' ? 160 : 96);

    // 2. Upload every TextureSource + build mipmaps ahead of gameplay.
    const initSource = renderer.texture?.initSource?.bind(renderer.texture);
    if (initSource) {
      const sources = new Set<TextureSource>(collectArtTextureSources(this.art));
      for (const tex of Object.values(this.tex) as Texture[]) {
        if (tex && tex !== Texture.EMPTY) sources.add(tex.source);
      }
      if (this.soldiers.flagTexture !== Texture.EMPTY) sources.add(this.soldiers.flagTexture.source);
      for (const src of sources) initSource(src);
    }

    // 3. Populate initial HUD & run optional bench setup steps while #boot still covers the stage.
    const benchSteps = opts.benchSteps ?? 0;
    if (benchSteps > 0) {
      for (let i = 0; i < benchSteps; i++) this.frame(1 / 60);
    } else {
      this.syncHud(0, true);
    }

    // 4. Pre-warm every Text node and compile Sprite (normal + add), Graphics (normal + add),
    //    and NineSliceSprite shaders in one flushed pass.
    const initText = renderer.renderPipes?.text?.initGpuText?.bind(renderer.renderPipes.text);
    if (initText) {
      const walkText = (c: Container): void => {
        if (c instanceof Text) initText(c);
        for (let i = 0; i < c.children.length; i++) walkText(c.children[i]);
      };
      walkText(this.app.stage);
    }

    const warm = new Container();
    warm.alpha = 0.001;
    const sNorm = new Sprite(this.tex.puff);
    sNorm.width = sNorm.height = 1;
    const sAdd = new Sprite(this.tex.spark);
    sAdd.blendMode = 'add';
    sAdd.width = sAdd.height = 1;
    const gNorm = new Graphics().rect(0, 0, 2, 2).fill({ color: 0xffffff }).moveTo(0, 0).lineTo(2, 2).stroke({ width: 1, color: 0xffffff });
    const gAdd = new Graphics().moveTo(0, 0).lineTo(2, 2).stroke({ width: 2, color: 0xffffff });
    gAdd.blendMode = 'add';
    const tip = this.art.uiKit?.tooltip ?? Texture.WHITE;
    const nine = new NineSliceSprite({ texture: tip, leftWidth: 2, rightWidth: 2, topHeight: 2, bottomHeight: 2, width: 8, height: 8 });
    warm.addChild(sNorm, sAdd, gNorm, gAdd, nine);
    this.app.stage.addChildAt(warm, 0);
    this.app.render();
    flushGpu(gl);
    this.app.stage.removeChild(warm);
    warm.destroy({ children: true });

    // 5. Measure actual GPU-flushed frame time (with hot shader/texture caches) and settle
    //    resolution before `#boot` is removed so gameplay starts with zero backlog or mid-wave resizes.
    const software = isSoftwareRenderer(gl);
    const activeWorkload = benchSteps > 0 || this.world.waveSystem.state !== 'preFirstWave';
    if (!this.quality.isLocked) {
      this.frame(0);
      this.app.render();
      flushGpu(gl);
      let resized = false;
      for (let iter = 0; iter < 3; iter++) {
        const t0 = performance.now();
        this.frame(0);
        this.app.render();
        flushGpu(gl);
        const renderMs = performance.now() - t0;
        if (!this.quality.calibrateBoot(renderMs, software, activeWorkload)) {
          resized = false;
          break;
        }
        resized = true;
        this.fx.setQuality(this.quality.tier);
        this.applyResolution(this.app.screen.width, this.app.screen.height);
      }
      if (resized) {
        this.app.render();
        flushGpu(gl);
      }
      this.quality.observe(0, false);
    } else {
      this.app.render();
      flushGpu(gl);
    }
  }

  private applyResolution(w: number, h: number): void {
    const resolution = renderResolution(w, h, window.devicePixelRatio, this.dprOverride, this.quality.resolutionTier) * this.quality.resolutionScale;
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
    const res = this.stepper.step(dtSec, this.onFixedTick);
    const alpha = res.alpha;
    const simDt = this.stepper.paused ? 0 : dtSec * this.stepper.speed;
    const cfg = this.currentSettings();
    this.towers.sync(world.towers, dtSec, simDt);
    for (let i = this.boltActive - 1; i >= 0; i--) {
      const b = this.boltQueue[i];
      b.t -= simDt;
      if (b.t <= 0) {
        this.fx.bolt(b.view, b.overload, b.muzzle);
        this.boltActive--;
        if (i !== this.boltActive) {
          const last = this.boltQueue[this.boltActive];
          this.boltQueue[this.boltActive] = b;
          this.boltQueue[i] = last;
        }
      }
    }
    this.plots.sync(this.plotStateFn, this.hoverPlot, this.ring.isOpen ? this.ring.plot : -1, world.gold < this.minCost, dtSec);
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

  private syncHud(dtSec: number, force = false): boolean {
    const world = this.world;
    const s = this.hudState;
    const over = world.outcome !== 'ongoing' && !this.hooks.endless;
    if (this.hooks.endless) {
      // Bench keeps steady topped-up counters (999 / 9999) so per-tick kill rewards do not re-rasterize Text every frame.
      s.lives = 999;
      s.gold = 9999;
    } else {
      s.lives = world.lives;
      this.hudGoldTimer += dtSec;
      const wsState = world.waveSystem.state;
      const combatWave = wsState === 'spawning' || wsState === 'allSpawned' || wsState === 'clearing';
      if (force || this.hudGoldDirty || !combatWave || this.ring.isOpen || this.stepper.paused || over || this.hudGoldTimer >= 0.12) {
        s.gold = world.gold;
        this.hudGoldDirty = false;
        this.hudGoldTimer = 0;
      }
    }
    s.wave = world.waveSystem.currentWaveOneBased;
    s.totalWaves = world.waveSystem.totalWaves;
    s.paused = this.stepper.paused;
    s.speed = this.stepper.speed;
    s.canCall = world.outcome === 'ongoing' && world.waveSystem.canStartNextWave();
    const rawBonus = s.canCall ? world.waveSystem.getEarlyCallBonus() : 0;
    s.earlyBonus = world.mods.waveBonusMul === 1 ? rawBonus : Math.max(0, Math.round(rawBonus * world.mods.waveBonusMul));
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
    this.syncHud(0, true);
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

  /** Orders the active hero to walk along the ground road graph to world coordinates `(worldX, worldZ)`. */
  commandHeroMove(worldX: number, worldZ: number): boolean {
    return this.world.commandHeroMove(worldX, worldZ);
  }

  /** Orders the active hero to walk along the ground road graph to screen (css px) coordinates `(screenX, screenY)`. */
  commandHeroMoveAtScreen(screenX: number, screenY: number): boolean {
    return this.world.commandHeroMove(this.map.worldXFromScreen(screenX), this.map.worldZFromScreen(screenY));
  }

  /** Casts hero active skill `slot` (`0` or `1`) at optional world coordinates `(worldX, worldZ)`. */
  castHeroSkill(slot: HeroSkillSlot, worldX = NaN, worldZ = NaN): boolean {
    return this.world.castHeroSkill(slot, worldX, worldZ);
  }

  /** Casts hero active skill `slot` (`0` or `1`) targeting screen (css px) coordinates `(screenX, screenY)`. */
  castHeroSkillAtScreen(slot: HeroSkillSlot, screenX: number, screenY: number): boolean {
    return this.world.castHeroSkill(slot, this.map.worldXFromScreen(screenX), this.map.worldZFromScreen(screenY));
  }

  /** Casts a global active ability (`'meteor'` or `'overcharge'`) at optional world coordinates `(worldX, worldZ)`. */
  castAbility(id: AbilityId, worldX = 0, worldZ = 0): boolean {
    return this.world.castAbility(id, worldX, worldZ);
  }

  /** Casts a global active ability (`'meteor'` or `'overcharge'`) targeting screen (css px) coordinates `(screenX, screenY)`. */
  castAbilityAtScreen(id: AbilityId, screenX: number, screenY: number): boolean {
    return this.world.castAbility(id, this.map.worldXFromScreen(screenX), this.map.worldZFromScreen(screenY));
  }

  /** Snapshot of the active hero and its two skill cooldowns (`null` when running without a hero). */
  getHeroState(): HeroRuntimeState | null {
    return this.world.getHeroState();
  }

  /** Cooldown and usability state for a single global ability (`'meteor'` | `'overcharge'`). */
  getAbilityState(id: AbilityId): AbilityRuntimeState {
    return this.world.getAbilityState(id);
  }

  /** Cooldown and usability state for all global abilities (`['meteor', 'overcharge']`). */
  getAbilitiesState(): readonly AbilityRuntimeState[] {
    return this.world.getAbilitiesState();
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
      // Settings / Codex sheets own the keyboard while open (and keep the run paused).
      if (anySheetOpen()) return;
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
      hero: w.getHeroState(),
      abilities: w.getAbilitiesState(),
      paused: this.stepper.paused,
      speed: this.stepper.speed,
      towers: w.towers.map((t) => ({ id: t.id, type: t.type, tier: t.tier, plot: t.col, targeting: t.targetingMode })),
      ring: { open: this.ring.isOpen, mode: this.ring.mode, plot: this.ring.plot, tokens: this.ring.tokenPositions(), layout: this.ring.layoutInfo, rangeShown: this.rangeDisc.visible },
      hud: this.hud.rects(),
      end: this.end.debug(),
      insets: this.insets,
      fit: this.map.fit,
      mapInfo: {
        key: this.art.map.key,
        texelScale: this.map.texelScale,
        texturePx: [this.map.textureSource.pixelWidth, this.map.textureSource.pixelHeight],
        gateFronts: this.gates.sprites.length,
        gateTextureWidths: this.gates.sprites.map((sprite) => sprite.texture.source.pixelWidth),
      },
      render: {
        resolution: this.app.renderer.resolution,
        canvasPx: [this.app.canvas.width, this.app.canvas.height],
        resolutionScale: this.quality.resolutionScale,
        desktop: this.quality.isDesktop,
      },
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
        map: this.art.map.texture.source.mipLevelCount,
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
