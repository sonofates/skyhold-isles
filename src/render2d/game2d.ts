import { bootPhase } from './bootTrace.ts';
import type { ItemCounts, ItemId } from '../data/market.ts';
import { Container, Graphics, NineSliceSprite, Sprite, Text, Texture, type Application, type TextureSource } from 'pixi.js';
import { EventBus } from '../core/eventBus.ts';
import { FixedTimestepStepper } from '../core/gameLoop.ts';
import type { AbilityId, EnemyType, GameSettings, HeroSkillSlot, SpeedMultiplier, TargetingMode, TowerType, Vec3 } from '../core/types.ts';
import { LEVELS } from '../data/levels/index.ts';
import { BALANCE } from '../data/balance.ts';
import { STAR_RULES } from '../data/stars.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import type { LevelDef } from '../data/levels/types.ts';
import { NEUTRAL_RUN_MODIFIERS, type RunModifiers } from '../data/runModifiers.ts';
import { getTowerTierStats, specializationsFor, TOWER_DEFS, towerStats } from '../data/towers.ts';
import { bindHaptics, haptics } from '../platform/haptics.ts';
import { isTouchDevice, loadSettings } from '../platform/storage.ts';
import { isDesktopShell } from '../platform/desktopShell.ts';
import { getPlatform } from '../platform/platform.ts';
import { isSteamOverlayHotkey, shouldPauseOnBlur } from './pausePolicy.ts';
import { actionForKey, loadKeyBindings } from './ui/keyBindings.ts';
import type { EnemyEntity, TowerEntity } from '../sim/entities.ts';
import { enemyArtFor } from './manifest.ts';
import type { HeroInitConfig, HeroRuntimeState } from '../sim/heroSystem.ts';
import { attackReach } from '../sim/targeting.ts';
import { computeSellRefund, SimWorld, type AbilityRuntimeState } from '../sim/world.ts';
import { collectArtTextureSources, type LoadedArt } from './assets2d.ts';
import { Audio2D, bindAudio2D, bindBackgroundLifecycle2D, screenPan, type BackgroundLifecycleHandle2D } from './audio2d.ts';
import {
  AdaptiveQuality,
  isDesktopClient,
  isSoftwareRenderer,
  MOBILE_BOOT_GRACE_MS,
  MOBILE_RESUME_GRACE_MS,
  qualityOverride,
  renderResolution,
  type QualityTier,
} from './renderResolution.ts';
import { BuildRing, type RingAction } from './buildRing.ts';
import { DamageNumbers2D } from './damageNumbers2d.ts';
import { EndPanel, endStars } from './endPanel.ts';
import { starsAwarded, type DifficultyId } from '../data/difficulty.ts';
import { EnemyLayer } from './enemyLayer.ts';
import { FxLayer } from './fxLayer.ts';
import { GateLayer } from './gateLayer.ts';
import { HeroLayer } from './heroLayer.ts';
import { HERO_TAP_SLACK, heroHitBox, inBox, resolveHeroTap } from './heroInput.ts';
import { HERO_RULES } from '../data/heroes.ts';
import { Hud, type HudState } from './hud.ts';
import { WorldLayers } from './layers.ts';
import { MapView } from './mapView.ts';
import { PlotLayer, type PlotState } from './plotLayer.ts';
import { createProcTextures, type ProcTextures } from './procTextures.ts';
import { prefetchSpecPortraits } from './specArt.ts';
import { ProjectileLayer } from './projectileLayer.ts';
import {
  audioSettings2d,
  createShakeState2D,
  resetShakeState2D,
  shouldShake2D,
  shouldVibrate2D,
  stepShake2D,
  triggerShake2D,
  type AudioSettings2D,
} from './settings2d.ts';
import { bindSpecialFx, createSpecialFxStats } from './specialFx.ts';
import { EclipseLayer } from './eclipseLayer.ts';
import { FrostPatchLayer } from './frostPatchLayer.ts';
import { SoldierLayer, withBarracksArt } from './soldierLayer.ts';
import { MeleeDirector } from './meleeDirector.ts';
import { meleeLookFor } from './meleeLook.ts';
import { TowerLayer } from './towerLayer.ts';
import { anySheetOpen } from './ui/dom.ts';
import { readSafeInsets } from './uiKit.ts';
import { NO_INSETS, WAVE_EASE_SEC, waveEaseZoom, type Insets } from './uiLayout.ts';
import { dockPieces, hudDock, type HudDock } from './hudDock.ts';
import { hornNearCave, rectsTouch, roadMouths } from './hornSpot.ts';
import { distSegRect, type Seg } from './playfield.ts';
import { pointAlong, primaryWaveEntrance, waveEntranceCounts } from './lanePath.ts';
import { buildEndlessWaveDef } from '../sim/waveSystem.ts';
import { fullBleedFitItems, hardOverlaps, hardShapes, type FullBleedFit, type HardShapes } from './fullBleed.ts';
import { MapPan, PAN_SLOP } from './mapPan.ts';
import {
  exceedsDragThreshold,
  firstSpawnPointPx,
  isPhoneCamera,
  phoneCameraFit,
  pinchStep,
  strictPanRange,
  type PhoneCameraLimits,
} from './phoneCamera.ts';
import type { HornPlacement } from './hornSpot.ts';
import { GoldPops2D } from './ui/goldPops2d.ts';
import { applyRunCommand, ReplayCursor, RunRecorder, runFingerprint, sameFingerprint, type RunCommand, type RunReplay } from './ui/replay2d.ts';

/** Replay viewer speeds (the live game cycles 1× / 2× / 3×). */
export const REPLAY_SPEEDS = [1, 2, 4] as const;
const LIVE_SPEEDS = [1, 2, 3] as const;

/** The next speed in a cycle (unknown speeds restart it). */
export function nextSpeed(cycle: readonly number[], s: number): number {
  const i = cycle.indexOf(s);
  return cycle[(i + 1) % cycle.length];
}

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
  /**
   * Re-reads the hero for a live (re)start, so Retry after a level-up plays at the new level.
   * Replays never call it: they reuse the hero their run was recorded with.
   */
  refreshHero?: () => HeroInitConfig | null;
  /** Start SimWorld in Endless mode from wave 1 (`startEndlessFromStart()`), keeping normal defeat flow. */
  startEndless?: boolean;
  itemBelt?: () => ItemCounts;
  spendItem?: (id: ItemId) => boolean;
  /**
   * The run's difficulty (its patch is already in `modifiers`): the end board shows it and caps an
   * Easy win's stars (src/data/difficulty.ts). Undefined = not shown (debug scenes).
   */
  difficulty?: DifficultyId;
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
  /** A replay started (true) or the game went back to live play (false). */
  onReplay?: (on: boolean) => void;
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
 * A built tower's reach as the sim uses it: base range (its own stats — a specialization's — or
 * another tier's / `baseRange` for a preview) × (1 + beacon aura + hero bonus) × (1 − range cut),
 * so a Veilcaster veil or the eclipse draws the range circle shrunk while it lasts.
 */
function towerReach(t: TowerEntity, tier: 1 | 2 | 3 = t.tier as 1 | 2 | 3, baseRange?: number): number {
  const base = baseRange ?? (tier === t.tier ? towerStats(t).range : getTowerTierStats(t.type, tier).range);
  return attackReach(t, base);
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
  /** Rime Beetle frost patches (ground decals under the plots). */
  private readonly frostPatches: FrostPatchLayer;
  /** Eclipse Sovereign eclipse: screen-wide dusk shade below the HUD (state-driven). */
  private readonly eclipse = new EclipseLayer();
  readonly projectiles: ProjectileLayer;
  readonly fx: FxLayer;
  readonly damageNumbers: DamageNumbers2D;
  /** "+N" gold rising from fallen foes. */
  readonly goldPops: GoldPops2D;
  readonly soldiers: SoldierLayer;
  /** Melee fight state shared by the enemy and soldier layers (swings, facing, spacing, flash). */
  readonly melee: MeleeDirector;
  readonly gates: GateLayer;
  /** The run's hero (sprite sheets, ring, bars, skill FX, aim previews). */
  readonly heroes: HeroLayer;
  readonly hud: Hud;
  readonly ring: BuildRing;
  readonly end: EndPanel;
  private insets: Insets = NO_INSETS;
  /** QA: how many plot / cave / castle / safe-area road shapes the dock pieces cover (0 = clear). */
  hornScore = 0;
  /** QA: the full-bleed fit of the last resize (coverage, shrink, clear). */
  fullBleed: FullBleedFit | null = null;
  /** Where every HUD piece sits (set by resize: its corner, nudged per island if it must be). */
  dock: HudDock = hudDock(1, 1, NO_INSETS, { plaqueAspect: 3.5, plaqueSlots: { lives: [0, 0], gold: [0, 0], midY: 0.5 }, bannerAspect: 3.4, hero: false });
  private playShapes: HardShapes | null = null;
  /** The roads' mouths at the caves (image px): the horn never covers them, inside the safe area or not. */
  private mouths: Seg[] | null = null;
  /** The dock as the map fit placed it (the horn at its corner spot). */
  private dockHome: HudDock | null = null;
  /** Last logical viewport size passed to `resize(w, h)` (keeps `placeHorn` in the same coordinates). */
  private viewW = 1;
  private viewH = 1;
  /** The wave (0-based) the horn was last placed for (-2 = not yet). */
  private hornFor = -2;
  private endShown = false;
  /** Event-FX counters (QA). */
  readonly fxStats = createSpecialFxStats();
  readonly stepper = new FixedTimestepStepper();
  private readonly rangeDisc: Sprite;
  /** Desktop: a fainter range disc under the built tower the mouse is over (ring closed). */
  private readonly hoverDisc: Sprite;
  private hoverTowerId = -1;
  private readonly screen = new Container();
  private readonly hooks: Game2DHooks;
  private readonly costs = new Map<TowerType, number>();
  world!: SimWorld;
  events!: EventBus;
  private selectedTower = -1;
  /** Barracks waiting for a road tap to move its rally point (-1 = none). */
  private rallyTower = -1;
  /** The hero is selected: the next map tap is a move order (heroInput.ts rules). */
  private heroSel = false;
  /** The foe the player tapped for its info card (uid guards against pool reuse). */
  private inspected: { e: EnemyEntity; uid: number } | null = null;
  /** Gold dashed ring under the inspected foe. */
  private readonly inspectRing = new Graphics();
  /** Fired when the hero selection changes (HUD portrait highlight). */
  onHeroSelect: ((selected: boolean) => void) | null = null;
  private down: { id: number; x: number; y: number; t: number } | null = null;
  /** Gentle map pan (mapPan.ts): the map's offset inside its pan range. */
  readonly pan = new MapPan();
  /** Phone battle camera active (bigger default zoom on playable area, pinch-to-zoom, strict inside-map clamp). */
  private phoneCamera = false;
  /** Zoom limits for the active phone camera (null on desktop). */
  private cameraLimits: PhoneCameraLimits | null = null;
  /** Active touch/primary pointers on the canvas (for two-finger pinch-to-zoom on phones). */
  private readonly activePointers = new Map<number, { clientX: number; clientY: number; x: number; y: number }>();
  /** Active two-finger pinch gesture on phones (null when not pinching). */
  private pinch: { idA: number; idB: number; lastDist: number; lastMidX: number; lastMidY: number } | null = null;
  /** A press that may become a pan drag (one pointer; a second one cancels it on desktop or pinches on phone). */
  private panPress: { id: number; x: number; y: number; active: boolean } | null = null;
  /** The horn's spot beside a cave and its map-px anchor (moves with both pan and zoom). */
  private hornPlaced: { p: HornPlacement; mx: number; my: number } | null = null;
  /** The view moved since the horn was last placed (re-placed once the pan settles). */
  private hornStale = false;
  /** Free plot under the mouse (desktop hover glow), or -1. */
  private hoverPlot = -1;
  private minCost = 0;
  private settings: GameSettings = loadSettings();
  private readonly shake = createShakeState2D();
  /** Seconds since the last wave started (camera ease, uiLayout.waveEaseZoom); -1 = none. */
  private waveEaseT = -1;
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
  private readonly cmdCounts = new Map<RunCommand['k'], number>();
  /** Fixed sim ticks run this run (the replay clock). */
  private ticks = 0;
  /** Commands of the live run (null while a replay plays). */
  private recorder: RunRecorder | null = null;
  /** The replay being shown (stays set after it ends / is left, until the next live run). */
  private replayCursor: ReplayCursor | null = null;
  /** The last finished live run, ready to be watched. */
  lastReplay: RunReplay | null = null;
  /** Hero the current live run started with, and the one `lastReplay` was recorded with. */
  private liveHero: HeroInitConfig | null | undefined;
  private replayHero: HeroInitConfig | null | undefined;
  private liveRuns = 0;
  /** The end board of that run (restored when the replay ends or is left). */
  private lastEnd: ReturnType<EndPanel['snapshot']> = null;
  /** Did the last replay reproduce its run exactly (null = not finished)? */
  replayMatched: boolean | null = null;
  private readonly onFixedTick = (fixedDt: number): void => {
    this.simClockSec += fixedDt;
    // The run clock stops with the run (the end tick must not depend on how frames chunk ticks).
    if (this.world.outcome !== 'ongoing' && !this.hooks.endless) return;
    this.replayCursor?.applyDue(this.world, this.ticks);
    this.hooks.beforeTick?.(this.world);
    this.world.fixedTick(fixedDt);
    this.ticks++;
    this.tickProbe?.(this.world, this.ticks);
  };
  /** QA: called after every fixed tick (replay determinism traces). */
  tickProbe: ((world: SimWorld, tick: number) => void) | null = null;
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
    countdown: number;
    countdownFrac: number;
    startLives: number;
  } = { startLives: 20, lives: 0, gold: 0, wave: 0, totalWaves: 0, paused: false, speed: 1, canCall: false, earlyBonus: 0, banner: '', countdown: 0, countdownFrac: 0 };
  /** Length of the running between-waves countdown (its first value seen). */
  private countdownMax = 0;

  constructor(app: Application, art: LoadedArt, level: LevelDef, hooks: Game2DHooks = {}) {
    if (!level.layout2d) throw new Error(`${level.id} has no 2D layout`);
    art = withBarracksArt(art);
    this.app = app;
    const query = new URLSearchParams(location.search);
    const gl = (app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
    this.quality = new AdaptiveQuality(
      qualityOverride(query.get('quality')),
      hooks.initialUnlockedTier ?? 'high',
      isDesktopClient(query),
      isSoftwareRenderer(gl),
    );
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
    this.hoverDisc = new Sprite(this.tex.rangeDisc);
    this.hoverDisc.anchor.set(0.5);
    this.hoverDisc.alpha = 0.5;
    this.hoverDisc.visible = false;
    this.layers.groundFx.addChild(this.hoverDisc);
    this.inspectRing.visible = false;
    this.layers.groundFx.addChild(this.inspectRing);
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
    this.map.setQuality(this.quality.tier);
    this.damageNumbers = new DamageNumbers2D(this.map, this.layers.fx);
    this.goldPops = new GoldPops2D(this.layers.fx);
    this.goldPops.enabled = this.quality.tier !== 'low';
    this.frostPatches = new FrostPatchLayer(this.map, this.layers.groundFx, this.tex);
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
    this.heroes = new HeroLayer(art, this.map, this.layers, this.tex, this.fx);
    this.hud = new Hud(art);
    this.ring = new BuildRing(art);
    this.ring.desktop = this.quality.isDesktop;
    this.hud.desktop = this.quality.isDesktop;
    this.end = new EndPanel(art);
    this.screen.addChild(this.eclipse.root, this.hud.root, this.ring.root, this.end.root);
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
    const st = towerStats(t);
    const maxSq = towerReach(t) ** 2;
    const minSq = st.minRange * st.minRange;
    const pool = this.world.enemyPool;
    for (let i = 0; i < pool.getActiveCount(); i++) {
      const e = pool.items[pool.getActiveIndex(i)];
      if (!e.active || e.hp <= 0 || e.burrowed || (e.flying && !def.hitsFlyers)) continue;
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

  /** Live play: records every command for the replay. Replay: commands come from the recording only. */
  get replaying(): boolean {
    return this.replayCursor !== null;
  }

  /** Replay progress 0..1 (by sim tick), 0 in live play. */
  get replayProgress(): number {
    return this.replayCursor ? this.replayCursor.progress(this.ticks) : 0;
  }

  /** The HUD numbers as last synced (countdown, early bonus, …). */
  debugHud(): Readonly<typeof this.hudState> {
    return this.hudState;
  }

  /** The build ring is open. */
  get ringOpen(): boolean {
    return this.ring.isOpen;
  }

  /** The build ring is open on a free plot (choosing a tower to build). */
  get buildRingOpen(): boolean {
    return this.ring.isOpen && this.ring.mode === 'build';
  }

  /** Sim ticks run so far this run. */
  get tickCount(): number {
    return this.ticks;
  }

  /**
   * The one way the UI changes the sim: records the command (live play) and applies it. While a
   * replay plays, player commands are ignored (false).
   */
  command(c: RunCommand): boolean {
    if (this.replayCursor) return false;
    if (c.k === 'item' && this.stepper.paused) return false;
    if (c.k !== 'item') this.recorder?.push(this.ticks, c);
    const ok = applyRunCommand(this.world, c);
    if (ok && c.k === 'item') this.recorder?.push(this.ticks, c);
    if (ok) this.cmdCounts.set(c.k, (this.cmdCounts.get(c.k) ?? 0) + 1);
    return ok;
  }

  /** Belt slots the HUD tray makes room for (ui/itemBelt2d.ts sets it, then resizes). */
  itemSlots = 0;

  useItem(id: ItemId, x?: number, z?: number): boolean {
    return this.command({ k: 'item', id, x, z });
  }

  /** How many commands of a kind the sim accepted this run (coach marks). */
  commandsDone(k: RunCommand['k']): number {
    return this.cmdCounts.get(k) ?? 0;
  }

  /** Watches the last finished run again from its first tick (same island, rules, hero and seed). */
  startReplay(): boolean {
    const r = this.lastReplay;
    if (!r) return false;
    this.newRun(r);
    return true;
  }

  /** Leaves a replay: back to the run's end board (the world under it stays where the replay was). */
  exitReplay(): void {
    if (!this.replayCursor) return;
    this.stepper.simActive = false;
    this.showEnd();
  }

  /** Replay viewer speed (1× / 2× / 4×). */
  setReplaySpeed(s: number): void {
    if (!this.replayCursor) return;
    this.stepper.speed = REPLAY_SPEEDS.find(speed => speed === s) ?? 1;
  }

  /** Sets the live game speed (1× / 2× / 3×) and records it. */
  setSpeed(s: SpeedMultiplier): void {
    if (this.replayCursor) {
      this.setReplaySpeed(s);
      return;
    }
    if (this.stepper.speed === s) return;
    this.stepper.speed = s;
    this.command({ k: 'speed', s });
  }

  /** Speed button / key cycle: 1×→2×→3× live, 1×→2×→4× in a replay. */
  cycleSpeed(): void {
    if (this.replayCursor) this.setReplaySpeed(nextSpeed(REPLAY_SPEEDS, this.stepper.speed));
    else this.setSpeed(nextSpeed(LIVE_SPEEDS, this.stepper.speed) as SpeedMultiplier);
  }

  /** Starts (or restarts) a run on the level; with `replay`, plays that recorded run back instead. */
  newRun(replay?: RunReplay): void {
    const wasReplay = this.replayCursor !== null;
    this.ticks = 0;
    this.cmdCounts.clear();
    this.replayCursor = replay ? new ReplayCursor(replay) : null;
    this.recorder = replay ? null : new RunRecorder(this.level.id);
    this.replayMatched = null;
    // Entering / leaving a replay starts at 1× (a live retry keeps the player's speed).
    if (wasReplay !== !!replay) this.stepper.speed = 1;
    this.unbindHaptics?.();
    this.unbindAudio?.();
    this.refreshSettings();
    this.events = new EventBus();
    this.unbindHaptics = bindHaptics(this.events);
    if (!replay) {
      // The first run uses the hero resolved at load; a Retry re-reads the save (XP from the last run).
      this.liveHero = this.liveRuns++ > 0 && this.hooks.refreshHero ? this.hooks.refreshHero() : this.hooks.hero;
    }
    const heroCfg = replay ? this.replayHero : this.liveHero;
    this.world = new SimWorld(
      this.level,
      this.events,
      this.hooks.modifiers ?? NEUTRAL_RUN_MODIFIERS,
      {
        heroId: heroCfg?.heroId,
        heroLevel: heroCfg?.level,
        heroSkills: heroCfg?.skills,
        seed: heroCfg?.seed,
        itemBelt: replay ? replay.itemBelt : this.hooks.itemBelt?.(),
        spendItem: replay ? undefined : this.hooks.spendItem,
      },
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
    this.inspected = null;
    this.inspectRing.visible = false;
    this.enemies.reset();
    this.fx.clear();
    this.damageNumbers.clear();
    this.goldPops.clear();
    resetShakeState2D(this.shake);
    this.map.root.position.set(0, 0);
    this.simClockSec = 0;
    this.activeDamagePopups = 0;
    this.soldiers.reset();
    this.melee.reset();
    this.heroes.reset();
    this.setHeroSelected(false);
    this.rallyTower = -1;
    this.boltActive = 0;
    this.hudGoldDirty = true;
    this.hudGoldTimer = 0;
    this.quality.resetForLevel();
    if (audio) {
      audio.sound.setMusicContext(LEVELS[this.level.index]?.id ?? this.level.id, 'build');
      this.unbindAudio = bindAudio2D(this.events, audio.sound,
        x => screenPan(this.map.screenX(this.map.pxX(x)), this.app.screen.width),
        id => this.world.soldierSystem.soldiers.find(s => s.id === id)?.x);
    }
    this.wireEvents();
    if (Number.isSafeInteger(this.benchWave) && this.benchWave > 0) this.world.debugSkipToWave(this.benchWave);
    if (wasReplay !== !!replay) this.hooks.onReplay?.(!!replay);
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
    this.heroes.wire(ev);
    ev.on('heroDied', () => this.setHeroSelected(false));
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
      const muzzle = t ? this.towers.muzzleOf(t.id, t.type) : p0.y;
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
    // Calling a wave early pays: the bonus rises from the horn as a gold "+N" with a coin.
    ev.on('waveStarted', (e) => {
      if (!(e.earlyBonus > 0)) return;
      const f = this.map.fit;
      const hp = this.hud.hornPosition;
      const px = (hp.x - f.offsetX) / f.scale;
      const py = (hp.y - this.hud.hornRadius - f.offsetY) / f.scale;
      this.fx.spawn('coin', px, py, 30, 0, -80, 0.9);
      this.goldPops.spawn(e.earlyBonus, px + 10, py - 20);
    });
    ev.on('enemyKilled', (e) => {
      // Painted death clip (enemies whose manifest lists one); snapshots the pose before the pool reuses the slot.
      this.enemies.playDeath(e.enemyId);
      const px = m.pxX(e.x);
      const py = m.pxY(e.z) - e.y * 0.9 * ppu;
      this.fx.puffs(px, py - 14, 7, 12);
      this.fx.spawn('coin', px, py - 30, 26, 0, -70, 0.8);
      if (!this.hooks.endless) this.goldPops.spawn(e.reward, px + 26, py - 58);
      if (!this.hooks.endless && ENEMY_DEFS[e.enemyType].isBoss) {
        triggerShake2D(this.shake, BALANCE.camera.bossHitShake, this.currentSettings());
      }
    });
    ev.on('towerBuilt', (e) => {
      this.hudGoldDirty = true;
      const px = m.pxX(e.x);
      const py = m.pxY(e.z);
      this.fx.puffs(px, py, 10, 30, 0xe9d8b4);
      // A dust ring rolling out from the plot as the tower lands.
      this.fx.spawn('ring', px, py + 4, 46, 0, 0, 0.45, 0xf3e3c0);
    });
    ev.on('towerUpgraded', (e) => {
      this.hudGoldDirty = true;
      const px = m.pxX(e.x);
      const py = m.pxY(e.z);
      if (e.tier === 3) prefetchSpecPortraits(this.art, e.type);
      // Tier IV with no ability yet = the specialization itself (an ability buy is a plain upgrade puff).
      if (e.tier === 4 && this.world.getTowerById(e.towerId)?.specialization?.abilities.length === 0) {
        this.specFlourish(px, py);
        return;
      }
      this.fx.puffs(px, py, 8, 26, 0xfff0c0);
      this.fx.spawn('flash', px, py - 60, 50, 0, 0, 0.3);
      // Gold ring at the base and sparks rising up the tower: the new tier is in.
      this.fx.spawn('ring', px, py + 4, 52, 0, 0, 0.55, 0xffd76a);
      this.fx.burst('spark', px, py - 50, 9, 9, 120, 0.6, 0xffe08a, 160);
    });
    ev.on('towerSold', (e) => {
      this.hudGoldDirty = true;
      this.fx.puffs(m.pxX(e.x), m.pxY(e.z), 10, 30, 0xe9d8b4);
      this.fx.spawn('coin', m.pxX(e.x), m.pxY(e.z) - 40, 34, 0, -60, 0.9);
      // The refund rises as a gold "+N", like a kill's bounty.
      if (e.refund > 0) this.goldPops.spawn(e.refund, m.pxX(e.x) + 12, m.pxY(e.z) - 70);
    });
    ev.on('waveStarted', () => {
      this.hudGoldDirty = true;
      // A soft camera breath as the wave marches out (off with shake off or Reduced motion).
      const reduce = typeof document !== 'undefined' && document.documentElement.classList.contains('pu-reduce-motion');
      if (!this.replayCursor && shouldShake2D(this.currentSettings()) && !reduce) this.waveEaseT = 0;
    });
    ev.on('waveCompleted', () => {
      this.hudGoldDirty = true;
    });
  }

  /**
   * A tower takes its specialization: a gold column of light, two rolling rings and a fountain of
   * sparks while the new building pops in (the sim's pop timer). Reduced motion: one soft ring and
   * a calm glow, nothing flying.
   */
  private specFlourish(px: number, py: number): void {
    const reduce = typeof document !== 'undefined' && document.documentElement.classList.contains('pu-reduce-motion');
    this.specFlourishes++;
    if (reduce) {
      this.fx.spawn('ring', px, py + 4, 64, 0, 0, 0.7, 0xffd76a);
      this.fx.spawn('glow', px, py - 60, 120, 0, 0, 0.8, 0xffe7a0);
      return;
    }
    this.fx.puffs(px, py, 8, 30, 0xfff0c0);
    this.fx.spawn('flash', px, py - 70, 56, 0, 0, 0.3, 0xfff4cc);
    this.fx.spawn('glow', px, py - 80, 120, 0, -20, 0.8, 0xffc94a);
    this.fx.spawn('ring', px, py + 4, 58, 0, 0, 0.55, 0xffd76a);
    this.fx.spawn('ring', px, py + 4, 90, 0, 0, 0.85, 0xfff0c0);
    this.fx.burst('spark', px, py - 40, 18, 11, 190, 0.9, 0xffe08a, 220);
    this.fx.burst('orb', px, py - 90, 8, 9, 70, 1.1, 0xfff4cc, -40);
  }

  /** QA: specialization flourishes played this run. */
  specFlourishes = 0;

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

  textureSources(): TextureSource[] {
    const enemies = new Set<string>();
    for (const wave of this.level.waves) {
      for (const { enemyType } of [...wave.groups].sort((a, b) => a.startDelay - b.startDelay)) {
        enemies.add(enemyArtFor(this.art.manifest, enemyType, ENEMY_DEFS[enemyType].flying).art);
      }
    }
    const { arrow, bolt, ball, shard, glow } = this.tex;
    return collectArtTextureSources(this.art, enemies, [
      arrow, bolt, ball, shard, glow, ...Object.values(this.tex), this.soldiers.flagTexture,
    ]);
  }

  /**
   * Pre-compiles the Pixi shader pipelines (`Sprite` normal/add, `Graphics` normal/add, `NineSliceSprite`, `Text`), pre-warms
   * pooled entity/particle sprites, and calibrates initial adaptive resolution before Wave 1 starts.
   */
  prewarm(opts: { readonly benchSteps?: number } = {}): void {
    const renderer = this.app.renderer as unknown as {
      gl?: WebGL2RenderingContext;
      renderPipes?: { text?: { initGpuText?: (t: Text) => void } };
    };
    const gl = renderer.gl;

    // 1. Pre-allocate pooled views so wave spawns and volleys allocate no Sprites on the hot path.
    this.enemies.prewarm(160);
    this.projectiles.prewarm(64);
    this.fx.prewarm(this.quality.tier === 'high' ? 160 : 96);

    bootPhase('allocate-pools');
    // The stress benchmark needs every combat texture resident before it starts sampling.
    if (opts.benchSteps) {
      for (const src of this.textureSources()) this.app.renderer.texture.initSource(src);
    }

    bootPhase('upload-textures');
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

    bootPhase('prepare-hud-and-text');
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

    bootPhase('shader-pass-and-gpu-flush');
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
        this.map.setQuality(this.quality.tier);
        this.applyResolution(this.app.screen.width, this.app.screen.height);
      }
      if (resized) {
        this.goldPops.enabled = this.quality.tier !== 'low';
        this.app.render();
        flushGpu(gl);
      }
      this.quality.beginGrace(MOBILE_BOOT_GRACE_MS);
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

  /**
   * The horn stands beside the cave the next wave marches out of (the cave with most of its foes on
   * a multi-cave island), clear of every road, plot, cave, the castle and the dock's other pieces;
   * it moves when the next wave changes cave. Where no such spot is clear it keeps its dock spot.
   */
  private placeHorn(force: boolean): void {
    const home = this.dockHome;
    const lay = this.level.layout2d;
    if (!home || !lay) return;
    const ws = this.world.waveSystem;
    const idx = ws.state === 'finished' ? -1 : ws.state === 'preFirstWave' ? 0 : ws.currentWaveIndex + 1;
    if (!force && idx === this.hornFor) return;
    this.hornFor = idx;
    const def = idx < 0 ? null : idx < this.level.waves.length ? this.level.waves[idx] : ws.isEndless ? buildEndlessWaveDef(idx, this.level) : null;
    let placed = null;
    if (def && (lay.paths.length > 0 || lay.flightPath.length > 0)) {
      const entries = waveEntranceCounts(def.groups, lay.paths, lay.flightPath, (ty) => Boolean(ENEMY_DEFS[ty as EnemyType]?.flying));
      const chosen = primaryWaveEntrance(entries);
      const path = chosen?.path;
      if (path && path.length > 1) {
        const scr = (p: { x: number; z: number }): { x: number; y: number } => ({ x: this.map.screenX(this.map.pxX(p.x)), y: this.map.screenY(this.map.pxY(p.z)) });
        // The road's mouth as seen: the first point along it out of the cave's painted front and on
        // screen (the path itself starts deep inside the cave, often past the screen's edge).
        const W0 = this.viewW;
        const H0 = this.viewH;
        const f0 = this.map.fit;
        const caves = (this.playShapes ??= hardShapes(lay)).gates
          .filter((g) => !g.castle)
          .map((g) => ({ x: g.x * f0.scale + f0.offsetX, y: g.y * f0.scale + f0.offsetY, w: g.w * f0.scale, h: g.h * f0.scale }));
        const outside = (q: { x: number; y: number }): boolean =>
          q.x > 0 && q.y > 0 && q.x < W0 && q.y < H0 && !caves.some((g) => q.x > g.x && q.x < g.x + g.w && q.y > g.y && q.y < g.y + g.h);
        let mouth = scr(path[0]);
        let next = scr(path[1]);
        for (let d = 0.25; d < 14; d += 0.25) {
          const a = pointAlong(path, d);
          if (!a) break;
          const q = scr(a);
          if (outside(q)) {
            mouth = q;
            const b = pointAlong(path, d + 1);
            next = b ? scr(b) : next;
            break;
          }
        }
        const shapes = (this.playShapes ??= hardShapes(lay));
        const k = lay.pxPerUnit;
        const [iw, ih] = lay.imageSize;
        const mouths = (this.mouths ??= roadMouths(
          lay.paths.map((pp) => pp.map((q) => ({ x: q.x * k + iw / 2, y: q.z * k + ih / 2 }))),
          shapes.roadR * 7,
        ));
        const fit = this.map.fit;
        // The horn may lie over decorative art and over a road only where it runs outside the safe
        // area (hudCheck rules), never over a plot, a cave, the castle or a road's mouth.
        const covers = (box: { x: number; y: number; w: number; h: number }): boolean => {
          const g = { x: box.x - 4, y: box.y - 4, w: box.w + 8, h: box.h + 8 };
          if (hardOverlaps(shapes, fit, g, true).length > 0) return true;
          const img = { x: (g.x - fit.offsetX) / fit.scale, y: (g.y - fit.offsetY) / fit.scale, w: g.w / fit.scale, h: g.h / fit.scale };
          return mouths.some((sg) => distSegRect(sg, img) < shapes.roadR);
        };
        const m = Math.max(6, home.gap * 0.5);
        const pieces = [home.buttons, home.plaque, home.banner, this.dock.tray, this.dock.info];
        const W = this.viewW;
        const H = this.viewH;
        const ins = this.insets;
        placed = hornNearCave({
          mouth,
          out: { x: next.x - mouth.x, y: next.y - mouth.y },
          r: home.horn.r,
          size: this.hud.hornLabelSize(),
          bounds: { x: ins.left + 6, y: ins.top + 6, w: W - ins.left - ins.right - 12, h: H - ins.top - ins.bottom - 12 },
          blocked: (box) => pieces.some((p) => rectsTouch(box, p, m)) || covers(box),
        });
      }
    }
    this.hud.setHornPlacement(placed);
    const fitNow = this.map.fit;
    this.hornPlaced = placed
      ? { p: placed, mx: (placed.horn.x - fitNow.offsetX) / fitNow.scale, my: (placed.horn.y - fitNow.offsetY) / fitNow.scale }
      : null;
    this.hornStale = false;
    this.dock = placed ? { ...this.dock, horn: placed.horn, hornBox: placed.hornBox } : { ...this.dock, horn: home.horn, hornBox: home.hornBox };
  }

  /** Syncs the cave-side horn (if anchored to a cave) after the camera pans or zooms. */
  private syncAnchoredHorn(): void {
    const hp = this.hornPlaced;
    if (hp) {
      const nx = this.map.screenX(hp.mx);
      const ny = this.map.screenY(hp.my);
      const p = hp.p;
      const dx = nx - p.horn.x;
      const dy = ny - p.horn.y;
      const moved: HornPlacement = {
        ...p,
        horn: { ...p.horn, x: nx, y: ny },
        hornBox: { ...p.hornBox, x: p.hornBox.x + dx, y: p.hornBox.y + dy },
      };
      this.hud.setHornPlacement(moved);
      this.dock = { ...this.dock, horn: moved.horn, hornBox: moved.hornBox };
    }
    this.hornStale = true;
    this.hoverPlot = -1;
  }

  /**
   * The pan moved the map: the world (and everything placed from `map.fit`) follows; the horn
   * beside a cave moves with its cave and is re-placed once the view settles.
   */
  private applyPan(): void {
    this.map.setOffset(this.pan.x, this.pan.y);
    this.syncAnchoredHorn();
  }

  /** Phone pinch-to-zoom moved both scale and offset; updates MapView, MapPan range, and horn. */
  private applyCamera(scale: number, offsetX: number, offsetY: number): void {
    const [iw, ih] = this.level.layout2d!.imageSize;
    const range = strictPanRange(this.viewW, this.viewH, iw, ih, scale);
    this.pan.setView(range, offsetX, offsetY);
    this.map.setTransform(scale, this.pan.x, this.pan.y);
    this.syncAnchoredHorn();
  }

  /** A pan gesture began: the screen-space build ring would float off its plot, so it closes. */
  private panStarted(): void {
    if (this.ring.isOpen) this.closeRing();
    this.down = null;
  }

  private get reducedMotion(): boolean {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('pu-reduce-motion');
  }

  /** Pans the view by (dx, dy) css px (wheel / QA); returns whether it moved. */
  panBy(dx: number, dy: number): boolean {
    const moved = this.pan.scrollBy(dx, dy);
    if (moved) {
      this.panStarted();
      this.applyPan();
    }
    return moved;
  }

  resize(w: number, h: number): void {
    const changed = this.viewW > 0 && (w !== this.viewW || h !== this.viewH);
    this.viewW = w;
    this.viewH = h;
    if (changed) this.quality.beginGrace(MOBILE_RESUME_GRACE_MS);
    this.applyResolution(w, h);
    this.insets = readSafeInsets();
    this.ring.insets = this.insets;
    const lay = this.level.layout2d!;
    const shapes = (this.playShapes ??= hardShapes(lay));
    const dockOpts = { ...this.hud.dockOptions(!!this.hooks.hero), items: this.itemSlots };
    this.phoneCamera = isPhoneCamera(this.quality.isDesktop, w, h);
    this.map.allowMirroredEdges = !this.phoneCamera;
    let placed;
    if (this.phoneCamera) {
      const w0 = this.level.waves[0];
      const entries = w0
        ? waveEntranceCounts(w0.groups, lay.paths, lay.flightPath, (ty) => Boolean(ENEMY_DEFS[ty as EnemyType]?.flying))
        : [];
      const firstSpawn = firstSpawnPointPx(lay, primaryWaveEntrance(entries)?.path);
      const phonePlaced = phoneCameraFit(
        w,
        h,
        lay,
        (itemMode) => hudDock(w, h, this.insets, { ...dockOpts, itemMode }),
        shapes,
        firstSpawn,
      );
      this.cameraLimits = phonePlaced.limits;
      placed = phonePlaced;
    } else {
      // Desktop: the map covers the screen (full bleed) and the HUD sits in its corners over the
      // decorative edges; a piece slides along its edge (or the map shrinks a little) only where it
      // would cover a plot, cave, castle or a safe-area road (fullBleed.ts).
      this.cameraLimits = null;
      placed = fullBleedFitItems(w, h, lay, (itemMode) => hudDock(w, h, this.insets, { ...dockOpts, itemMode }), shapes);
    }
    this.dock = placed.dock;
    this.fullBleed = placed.fit;
    this.map.resize(w, h, placed.fit);
    // Re-centred on every resize: the default view, with the pan range around it.
    this.pan.reset(placed.pan, placed.fit.offsetX, placed.fit.offsetY);
    this.panPress = null;
    this.pinch = null;
    this.activePointers.clear();
    this.hud.layout(w, h, this.dock, this.insets);
    this.dockHome = this.dock;
    this.placeHorn(true);
    // QA: what any dock piece still covers (exact shapes; 0 = clear).
    this.hornScore = Object.values(dockPieces(this.dock)).reduce((n, rect) => n + hardOverlaps(shapes, this.map.fit, rect).length, 0);
    this.end.layout(w, h, this.insets);
    this.ring.close();
    this.rangeDisc.visible = false;
  }

  get qualityTier(): QualityTier {
    return this.quality.tier;
  }

  /** Arms or extends mobile quality grace around async uploads (map swaps, video/sway init). */
  notifyQualityGrace(ms?: number): void {
    this.quality.beginGrace(ms);
  }

  /** Tracks whether async boot texture warmup is still uploading to the GPU (mobile hardware). */
  setQualityWarmupPending(pending: boolean): void {
    this.quality.setWarmupPending(pending);
  }

  /** One rendered frame. */
  frame(dtSec: number): void {
    const activeForQuality = !document.hidden && (this.quality.isDesktop || this.quality.isSoftware || !this.stepper.paused);
    if (this.quality.observe(this.app.ticker.elapsedMS, activeForQuality)) {
      this.fx.setQuality(this.quality.tier);
      this.map.setQuality(this.quality.tier);
      this.goldPops.enabled = this.quality.tier !== 'low';
      this.applyResolution(this.app.screen.width, this.app.screen.height);
    }
    audio?.sound.setMusicDucked(this.stepper.paused);
    const world = this.world;
    const res = this.stepper.step(dtSec, this.onFixedTick);
    const alpha = res.alpha;
    const simDt = this.stepper.paused ? 0 : dtSec * this.stepper.speed;
    const cfg = this.currentSettings();
    this.towers.sync(world.towers, dtSec, simDt);
    this.frostPatches.sync(world.enemySystem.frostPatches, simDt);
    this.eclipse.sync(world.enemySystem, this.app.screen.width, this.app.screen.height);
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
    if (this.hoverTowerId !== -1 && (this.ring.isOpen || this.heroSel || this.replayCursor || !world.getTowerById(this.hoverTowerId))) this.setHoverTower(-1);
    this.melee.update(world.soldierSystem, world.enemyPool, alpha, simDt);
    this.enemies.syncPool(world.enemyPool, alpha, simDt);
    this.projectiles.sync(world.projectilePool, alpha);
    this.soldiers.sync(world.soldierSystem, alpha, simDt, dtSec, this.selectedTower, this.rallyTower);
    if (this.heroSel && (world.outcome !== 'ongoing' || !world.hero || world.hero.state === 'dead')) this.setHeroSelected(false);
    this.heroes.sync(world, alpha, simDt, dtSec);
    this.fx.update(simDt > 0 ? simDt : dtSec * 0.25);
    this.goldPops.update(simDt > 0 ? dtSec : 0);
    this.activeDamagePopups = this.hooks.endless ? 0 : this.damageNumbers.update(simDt > 0 ? dtSec : 0, cfg);
    if (!this.hooks.endless) {
      stepShake2D(this.shake, simDt > 0 && !this.endShown ? dtSec : 0, cfg);
      let sx = 0;
      let sy = 0;
      if (simDt > 0 && !this.endShown && (this.shake.offsetX !== 0 || this.shake.offsetY !== 0)) {
        const unitPx = this.level.layout2d!.pxPerUnit * this.map.fit.scale;
        sx = this.shake.offsetX * unitPx;
        sy = this.shake.offsetY * unitPx;
      }
      // Wave-start ease: zoom about the screen centre (the HUD is outside map.root and stays put).
      let z = 1;
      if (this.waveEaseT >= 0) {
        if (simDt > 0) this.waveEaseT += dtSec;
        z = waveEaseZoom(this.waveEaseT);
        if (this.waveEaseT >= WAVE_EASE_SEC || this.endShown) this.waveEaseT = -1;
      }
      const cx = this.app.screen.width / 2;
      const cy = this.app.screen.height / 2;
      this.map.root.scale.set(z);
      this.map.root.position.set(sx + cx * (1 - z), sy + cy * (1 - z));
    }
    if (this.pan.step(dtSec)) this.applyPan();
    if (this.hornStale && !this.pan.dragging && !this.pan.gliding && !this.pinch) {
      this.hornStale = false;
      this.placeHorn(true);
    }
    this.ring.update(dtSec, world.gold);
    this.syncRangePreview();
    // A veil or the eclipse can shrink the hovered tower's range while it is shown.
    if (this.hoverTowerId !== -1 && this.hoverDisc.visible) this.setHoverTower(this.hoverTowerId);
    this.syncInspectRing();

    // A selected tower could be sold or the run reset.
    if (this.selectedTower !== -1 && !world.getTowerById(this.selectedTower)) this.closeRing();
    if (this.rallyTower !== -1 && !world.getTowerById(this.rallyTower)) this.closeRing();

    const over = this.syncHud(dtSec);
    if (over && !this.endShown) {
      if (this.replayCursor) {
        this.replayMatched = sameFingerprint(runFingerprint(world, this.ticks), this.replayCursor.replay.end);
        if (!this.replayMatched) console.warn('[replay] the replay did not reproduce the run', runFingerprint(world, this.ticks), this.replayCursor.replay.end);
        this.showEnd();
      } else {
        if (this.recorder) {
          this.lastReplay = this.recorder.finish(world, this.ticks);
          this.replayHero = this.liveHero;
        }
        this.endShown = true;
        this.closeRing();
        const won = world.outcome === 'won';
        const diff = this.hooks.difficulty;
        this.end.show({
          won,
          // An Easy win awards at most 1 star (the board shows what the save records).
          stars: endStars(won, won ? (diff ? starsAwarded(world.computeStars(), diff) : world.computeStars()) : 0),
          ...(diff ? { difficulty: diff } : {}),
          lives: world.lives,
          startLives: world.startingLives,
          gold: world.gold,
          wave: this.hudState.wave,
          totalWaves: this.hudState.totalWaves,
          hasNext: !!this.hooks.onNext,
          hasReplay: !!this.lastReplay && !this.hooks.endless,
          ...(won && diff !== 'easy' ? { starRule: { lost: Math.max(0, world.startingLives - world.lives + world.itemSystem.restoredLives), three: (STAR_RULES[this.level.difficulty] ?? STAR_RULES.Breezy).threeStarMaxLost, two: (STAR_RULES[this.level.difficulty] ?? STAR_RULES.Breezy).twoStarMaxLost } } : {}),
        });
        // main2d fills in the hero XP / mode note in this callback; the board is kept after it.
        this.hooks.onEndPanel?.(true);
        this.lastEnd = this.end.snapshot();
      }
    }
    this.end.update(dtSec);
  }

  /** Replay ended / left: the recorded run's own end board (hero XP, mode notes) comes back. */
  private showEnd(): void {
    if (this.endShown) return;
    this.endShown = true;
    this.closeRing();
    this.setHeroSelected(false);
    if (this.lastEnd) this.end.restore(this.lastEnd);
    this.hooks.onEndPanel?.(true);
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
      s.startLives = world.startingLives;
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
    // The rally plate keeps off the range circle (the road to tap is inside it).
    if (s.banner === 'Tap the road' && this.rangeDisc.visible) {
      const d = this.rangeDisc;
      const sc = this.map.fit.scale;
      this.hud.plateAvoid = { x: this.map.screenX(d.x - d.width / 2), y: this.map.screenY(d.y - d.height / 2), w: d.width * sc, h: d.height * sc };
    } else this.hud.plateAvoid = null;
    const ws = world.waveSystem;
    if (!over && ws.state === 'betweenWaves' && ws.interWaveTimer > 0) {
      if (ws.interWaveTimer > this.countdownMax) this.countdownMax = ws.interWaveTimer;
      s.countdown = ws.interWaveTimer;
      s.countdownFrac = ws.interWaveTimer / Math.max(0.001, this.countdownMax);
    } else {
      this.countdownMax = 0;
      s.countdown = 0;
      s.countdownFrac = 0;
    }
    this.placeHorn(false);
    this.hud.update(s as HudState, dtSec);
    return over;
  }

  /**
   * Freezes active 2D play when the app is sent to the background (`getPlatform().onPause` or
   * `document.visibilitychange`) and immediately updates the HUD to the existing `'Paused'` state,
   * keeping play paused on resume until the player deliberately unpauses.
   */
  pauseForBackground(): boolean {
    if (this.hooks.endless || this.endShown || this.world.outcome !== 'ongoing' || !this.stepper.simActive) return false;
    this.down = null;
    this.panPress = null;
    this.pinch = null;
    this.activePointers.clear();
    this.hoverPlot = -1;
    this.closeRing();
    this.stepper.paused = true;
    this.stepper.resetAccumulator();
    audio?.sound.setMusicDucked(true);
    this.syncHud(0, true);
    return true;
  }

  /** The foe whose info card is open, while it lives (null otherwise). */
  get inspectedEnemy(): EnemyEntity | null {
    const i = this.inspected;
    if (!i) return null;
    if (!i.e.active || i.e.uid !== i.uid || i.e.hp <= 0) return null;
    return i.e;
  }

  /** Was a foe being inspected (its card may say it fell)? */
  get inspecting(): boolean {
    return this.inspected !== null;
  }

  /** Closes the foe info card. */
  clearInspect(): void {
    this.inspected = null;
    this.inspectRing.visible = false;
  }

  /** World height (units) of a foe's figure (from its art), for hit tests and anchoring. */
  private enemyFigureHeight(e: EnemyEntity): number {
    const entry = enemyArtFor(this.art.manifest, e.type, e.flying);
    const h = this.art.enemies[entry.art]?.spec.height ?? 1.3;
    return h * (entry.scale ?? 1);
  }

  /** Screen point (css px) at the middle of a foe's figure, and the figure's height in px. */
  enemyScreen(e: EnemyEntity): { x: number; y: number; h: number } {
    const ppu = this.level.layout2d!.pxPerUnit;
    const hPx = this.enemyFigureHeight(e) * ppu;
    const px = this.map.pxX(e.x);
    const py = this.map.pxY(e.z) - e.y * 0.9 * ppu - hPx * 0.5;
    return { x: this.map.screenX(px), y: this.map.screenY(py), h: hPx * this.map.fit.scale };
  }

  /** The live foe under a screen point (nearest figure centre within a touch-sized reach), or null. */
  enemyAt(x: number, y: number): EnemyEntity | null {
    const pool = this.world.enemyPool;
    let best: EnemyEntity | null = null;
    let bd = Infinity;
    for (let i = 0; i < pool.getActiveCount(); i++) {
      const e = pool.items[pool.getActiveIndex(i)];
      if (!e.active || e.hp <= 0 || e.burrowed) continue;
      const c = this.enemyScreen(e);
      const reach = Math.max(26, c.h * 0.55);
      const d = Math.hypot(x - c.x, (y - c.y) * 0.8);
      if (d <= reach && d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private syncInspectRing(): void {
    const e = this.inspectedEnemy;
    const g = this.inspectRing;
    if (!e) {
      g.visible = false;
      return;
    }
    const ppu = this.level.layout2d!.pxPerUnit;
    const r = Math.max(0.55, this.enemyFigureHeight(e) * 0.42) * ppu;
    const px = this.map.pxX(e.x);
    const py = this.map.pxY(e.z);
    if (!g.visible || g.label !== `r${Math.round(r)}`) {
      g.clear();
      const n = 14;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2;
        const a1 = a0 + (Math.PI * 2) / n * 0.55;
        g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r).arc(0, 0, r, a0, a1);
      }
      g.stroke({ color: 0x3a2412, width: 7, alpha: 0.55, cap: 'round' });
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2;
        const a1 = a0 + (Math.PI * 2) / n * 0.55;
        g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r).arc(0, 0, r, a0, a1);
      }
      g.stroke({ color: 0xffd76a, width: 4, cap: 'round' });
      g.label = `r${Math.round(r)}`;
      g.scale.set(1, 0.5);
    }
    g.visible = true;
    g.position.set(px, py);
    g.rotation = 0;
  }

  /** Range circle on the map: the tower the ring points at (selected / hovered), else the selected tower. */
  private syncRangePreview(): void {
    if (!this.ring.isOpen) return;
    const pv = this.ring.preview;
    const p = this.level.layout2d!.plots[this.ring.plot];
    if (!p) return;
    let type: TowerType | null = pv ? pv.type : null;
    let tier: 1 | 2 | 3 = pv ? pv.tier : 1;
    const built = this.selectedTower !== -1 ? this.world.getTowerById(this.selectedTower) : null;
    if (!type && built) {
      type = built.type;
      tier = built.tier as 1 | 2 | 3;
    }
    if (!type) {
      this.rangeDisc.visible = false;
      return;
    }
    const range = built && built.type === type ? towerReach(built, tier, pv?.range) : (pv?.range ?? getTowerTierStats(type, tier).range);
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
    return this.command({ k: 'heroMove', x: worldX, z: worldZ });
  }

  /** Orders the active hero to walk along the ground road graph to screen (css px) coordinates `(screenX, screenY)`. */
  commandHeroMoveAtScreen(screenX: number, screenY: number): boolean {
    return this.commandHeroMove(this.map.worldXFromScreen(screenX), this.map.worldZFromScreen(screenY));
  }

  /** Casts hero active skill `slot` (`0` or `1`) at optional world coordinates `(worldX, worldZ)`. */
  castHeroSkill(slot: HeroSkillSlot, worldX = NaN, worldZ = NaN): boolean {
    return this.command({ k: 'heroSkill', slot, x: Number.isFinite(worldX) ? worldX : null, z: Number.isFinite(worldZ) ? worldZ : null });
  }

  /** Casts hero active skill `slot` (`0` or `1`) targeting screen (css px) coordinates `(screenX, screenY)`. */
  castHeroSkillAtScreen(slot: HeroSkillSlot, screenX: number, screenY: number): boolean {
    return this.castHeroSkill(slot, this.map.worldXFromScreen(screenX), this.map.worldZFromScreen(screenY));
  }

  /** Casts a global active ability (`'meteor'` or `'overcharge'`) at optional world coordinates `(worldX, worldZ)`. */
  castAbility(id: AbilityId, worldX = 0, worldZ = 0): boolean {
    return id === 'meteor' ? this.command({ k: 'meteor', x: worldX, z: worldZ }) : this.command({ k: 'overcharge' });
  }

  /** Casts a global active ability (`'meteor'` or `'overcharge'`) targeting screen (css px) coordinates `(screenX, screenY)`. */
  castAbilityAtScreen(id: AbilityId, screenX: number, screenY: number): boolean {
    return this.castAbility(id, this.map.worldXFromScreen(screenX), this.map.worldZFromScreen(screenY));
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

  /** Selects / deselects the hero (move mode). Opening it closes the build ring. */
  setHeroSelected(on: boolean): void {
    const h = this.world?.hero;
    const ok = on && !!h && h.state !== 'dead' && this.world.outcome === 'ongoing' && !this.replayCursor;
    if (ok && this.ring.isOpen) this.closeRing();
    if (ok) this.rallyTower = -1;
    const was = this.heroSel;
    this.heroSel = ok;
    this.heroes.selected = ok;
    if (!ok) this.heroes.setHover(null);
    if (was !== ok) this.onHeroSelect?.(ok);
  }

  get heroSelected(): boolean {
    return this.heroSel;
  }

  /** Screen (css px) position of the hero's feet, or null without a hero. */
  heroScreen(): { x: number; y: number } | null {
    const f = this.heroes.feet();
    return f ? { x: this.map.screenX(f.x), y: this.map.screenY(f.y) } : null;
  }

  /** Screen (css px) top centre of the hero's body (the head), or null without a hero. */
  heroHeadScreen(): { x: number; y: number } | null {
    const b = this.heroes.bodyRect();
    return b ? { x: this.map.screenX(b.x + b.w / 2), y: this.map.screenY(b.y) } : null;
  }

  /** Is the screen point on the hero (body box grown to a touch-sized target)? */
  private onHeroAt(x: number, y: number): boolean {
    const b = this.heroes.bodyRect();
    if (!b) return false;
    const sb = { x: this.map.screenX(b.x), y: this.map.screenY(b.y), w: b.w * this.map.fit.scale, h: b.h * this.map.fit.scale };
    return inBox(heroHitBox(sb, 44), x, y);
  }

  /** Distance (world units) from a world point to the nearest road the hero can walk. */
  offRoad(wx: number, wz: number): number {
    const c = this.world.heroSystem.groundGraph.clampToGround(wx, wz, Infinity);
    return Math.hypot(wx - c.roadX, wz - c.roadZ);
  }

  /** Move order at a screen point: walks there (true) or shows the invalid cross (false). */
  private heroMoveAt(x: number, y: number): boolean {
    const wx = this.map.worldXFromScreen(x);
    const wz = this.map.worldZFromScreen(y);
    if (this.offRoad(wx, wz) > HERO_RULES.maxOffRoadDist + HERO_TAP_SLACK) {
      this.heroes.flashInvalid(wx, wz);
      return false;
    }
    if (this.commandHeroMove(wx, wz)) haptics.pulse('tap');
    return true;
  }

  /** Desktop right click: with the hero selected, a move order that keeps it selected. */
  rightClick(x: number, y: number): void {
    if (this.end.visible || this.replayCursor) return;
    if (!this.heroSel) {
      // PC convention: right click cancels — it closes the build ring and the foe card.
      if (this.ring.isOpen || this.inspecting) {
        this.closeRing();
        this.clearInspect();
      }
      return;
    }
    if (this.stepper.paused) return;
    if (this.ring.isOpen) this.closeRing();
    this.heroMoveAt(x, y);
  }

  /** Desktop hover range of a built tower (-1 hides it). */
  private setHoverTower(id: number): void {
    const t = id !== -1 ? this.world.getTowerById(id) : null;
    this.hoverTowerId = t ? id : -1;
    this.hoverDisc.visible = !!t;
    if (!t) return;
    const ppu = this.level.layout2d!.pxPerUnit;
    this.hoverDisc.position.set(this.map.pxX(t.x), this.map.pxY(t.z));
    this.hoverDisc.scale.set((towerReach(t) * ppu * 2) / this.tex.rangeDisc.width);
  }

  /**
   * The build ring's tier-III "compare" (main2d opens the comparison card). Without a handler
   * (bench / debug scenes) the tokens still show, the card just does not open.
   */
  onSpecCompare: ((req: { readonly towerId: number; readonly type: TowerType; readonly focus: string }) => void) | null = null;

  /** A branch token's confirming tap (or the card's "Choose"): recorded command, closes the ring. */
  specializeTower(towerId: number, specId: string): boolean {
    const ok = this.command({ k: 'spec', id: towerId, spec: specId });
    if (this.ring.isOpen) this.closeRing();
    return ok;
  }

  /** Buys a specialized tower's ability through the recorded command layer. */
  buyTowerAbility(towerId: number, abilityId: string): boolean {
    return this.command({ k: 'ability', id: towerId, ability: abilityId });
  }

  /** Screen (css px) top centre of a built tower's painted body (tips point at it), or null. */
  towerTopScreen(id: number): { x: number; y: number } | null {
    const box = this.towers.spriteRect(id);
    if (box) return { x: this.map.screenX(box.x + box.w / 2), y: this.map.screenY(box.y) };
    const t = this.world.getTowerById(id);
    if (!t) return null;
    const p = this.plotScreen(t.col);
    return { x: p.x, y: p.y - 40 };
  }

  /** QA: the open ring's plot and its tower (if any). */
  get ringTower(): number {
    return this.ring.isOpen ? this.selectedTower : -1;
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

  /**
   * Pad / keyboard cursor (ui/padCursor.ts): where it may jump right now (screen css px). `ring` =
   * the open ring's tokens; `end` = the end board's buttons; `free` = the cursor glides (hero move
   * order, rally flag); `snap` = the plots and the hero.
   */
  padTargets(): { mode: 'ring' | 'end' | 'free' | 'snap'; points: { x: number; y: number }[] } {
    if (this.end.visible) {
      // The main action first: the pad reticle jumps there when the board appears.
      const main = this.end.primaryAction();
      const bs = this.end.debug()?.buttons ?? [];
      const sorted = [...bs.filter((b) => b.action === main), ...bs.filter((b) => b.action !== main)];
      return { mode: 'end', points: sorted.map((b) => ({ x: b.x, y: b.y })) };
    }
    if (this.ring.isOpen) {
      // The tokens, then a branch tip's "(i) Compare" row (the optional comparison card).
      const points = this.ring.tokenPositions().map((p) => ({ x: p.x, y: p.y }));
      const cmp = this.ring.compareSpot();
      if (cmp) points.push(cmp);
      return { mode: 'ring', points };
    }
    if (this.heroSel || this.rallyTower !== -1) return { mode: 'free', points: [] };
    const lay = this.level.layout2d;
    const points = lay ? lay.plots.map((_, i) => this.plotScreen(i)) : [];
    const h = this.world.hero;
    if (h && h.state !== 'dead') {
      const head = this.heroHeadScreen();
      const feet = this.heroScreen();
      if (head && feet) points.push({ x: head.x, y: (head.y + feet.y) / 2 });
    }
    // Canvas HUD buttons: the horn (call the wave), pause and speed.
    const r = this.hud.rects();
    if (this.world.outcome === 'ongoing') points.push(this.hud.hornPosition);
    for (const k of ['pause', 'speed'] as const) if (r[k].w > 1) points.push({ x: r[k].x + r[k].w / 2, y: r[k].y + r[k].h / 2 });
    return { mode: 'snap', points };
  }

  /**
   * Where a pad / keyboard click lands: in hero move mode the nearest road point (gliding a reticle
   * exactly onto a road is fiddly with a stick), else the reticle's own spot.
   */
  padClickPoint(x: number, y: number): { x: number; y: number } {
    if (!this.heroSel || !this.world.hero) return { x, y };
    const c = this.world.heroSystem.groundGraph.clampToGround(this.map.worldXFromScreen(x), this.map.worldZFromScreen(y), Infinity);
    return { x: this.map.screenX(this.map.pxX(c.roadX)), y: this.map.screenY(this.map.pxY(c.roadZ)) };
  }

  /**
   * Phone camera: a ring that had to move far off its plot (a plot near the top edge on a short
   * screen, the tray in the way) leaves the player guessing which plot it is for. The map glides by
   * the same drift (clamped to the pan range), so the plot slides in under its ring.
   */
  private followRing(): void {
    if (!this.phoneCamera) return;
    const d = this.ring.drift;
    if (Math.hypot(d.dx, d.dy) <= this.ring.tokenRadius) return;
    if (this.pan.glideBy(d.dx, d.dy, this.reducedMotion)) this.applyPan();
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
      this.followRing();
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
        record: { kills: t.kills, damage: t.totalDamageDealt },
        // Tier III: the family's two specializations; specialized: its branch, abilities and stats.
        ...(t.tier === 3 && !t.specialization ? { branches: specializationsFor(t.type) } : {}),
        ...(t.specialization ? { specialization: { id: t.specialization.id, abilities: t.specialization.abilities }, stats: towerStats(t) } : {}),
      },
      world.gold,
      w,
      h,
      this.hud.topBand,
    );
    this.followRing();
    const range = towerReach(t);
    const ppu = this.level.layout2d!.pxPerUnit;
    this.rangeDisc.position.set(this.map.pxX(t.x), this.map.pxY(t.z));
    this.rangeDisc.scale.set((range * ppu * 2) / this.tex.rangeDisc.width);
    this.rangeDisc.visible = true;
  }

  private doRing(action: RingAction): void {
    const world = this.world;
    const plot = this.ring.plot;
    if (action.kind === 'build') {
      this.command({ k: 'build', plot, type: action.type });
    } else if (action.kind === 'upgrade') {
      if (this.selectedTower !== -1) this.command({ k: 'upgrade', id: this.selectedTower });
    } else if (action.kind === 'spec') {
      // The branch's second tap: bought straight from the ring (recorded command; closes the ring).
      if (this.selectedTower !== -1) this.specializeTower(this.selectedTower, action.id);
      return;
    } else if (action.kind === 'compare') {
      // Optional detail: the comparison card (DOM, main2d); the ring stays open under it.
      const t = this.selectedTower !== -1 ? world.getTowerById(this.selectedTower) : null;
      if (t && this.onSpecCompare) this.onSpecCompare({ towerId: t.id, type: t.type, focus: this.ring.selectedBranch ?? action.id });
      return;
    } else if (action.kind === 'ability') {
      if (this.selectedTower !== -1) this.command({ k: 'ability', id: this.selectedTower, ability: action.id });
    } else if (action.kind === 'target') {
      const t = this.selectedTower !== -1 ? world.getTowerById(this.selectedTower) : null;
      if (t) {
        const next = TARGET_CYCLE[(TARGET_CYCLE.indexOf(t.targetingMode) + 1) % TARGET_CYCLE.length];
        this.command({ k: 'target', id: t.id, mode: next });
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
      if (this.selectedTower !== -1) this.command({ k: 'sell', id: this.selectedTower });
    }
    this.closeRing();
  }

  /** Handles a tap at screen (css px) coordinates. */
  tap(x: number, y: number): void {
    const world = this.world;
    if (this.end.visible) {
      const a = this.end.hit(x, y);
      if (a === 'retry') this.newRun();
      else if (a === 'replay') this.startReplay();
      else if (a === 'next') this.hooks.onNext?.();
      else if (a === 'menu') this.hooks.onMenu?.();
      return;
    }
    if (this.replayCursor) {
      // Watching: only the pause / speed buttons answer (the replay bar has the rest).
      const hudHit = this.hud.hit(x, y);
      if (hudHit === 'pause') this.stepper.paused = !this.stepper.paused;
      else if (hudHit === 'speed') this.cycleSpeed();
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
      else if (hudHit === 'speed') this.cycleSpeed();
      else if (hudHit === 'horn' && !this.stepper.paused) this.command({ k: 'wave' });
      return;
    }
    if (this.stepper.paused) return;
    const wx = this.map.worldXFromScreen(x);
    const wz = this.map.worldZFromScreen(y);
    if (this.rallyTower !== -1) {
      this.command({ k: 'rally', id: this.rallyTower, x: wx, z: wz });
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
    // Hero rules (heroInput.ts): select / move / invalid before plots, a plot tap drops the hero.
    const h = world.hero;
    const heroAct = resolveHeroTap({
      hasHero: !!h,
      heroAlive: !!h && h.state !== 'dead',
      selected: this.heroSel,
      onHero: !!h && this.onHeroAt(x, y),
      onPlot: plot !== -1,
      offRoad: h ? this.offRoad(wx, wz) : Infinity,
      maxOffRoad: HERO_RULES.maxOffRoadDist,
    });
    if (heroAct === 'select' || heroAct === 'deselect') {
      haptics.pulse('tap');
      this.setHeroSelected(heroAct === 'select');
      return;
    }
    if (heroAct === 'move') {
      this.heroMoveAt(x, y);
      this.setHeroSelected(false);
      return;
    }
    if (heroAct === 'invalid') {
      this.heroMoveAt(x, y);
      return;
    }
    if (this.heroSel) this.setHeroSelected(false);
    if (plot === -1 && !this.ring.isOpen) {
      // A tap on a foe opens its info card; any other empty tap closes it.
      const foe = this.enemyAt(x, y);
      if (foe) {
        haptics.pulse('tap');
        this.inspected = { e: foe, uid: foe.uid };
        return;
      }
    }
    this.clearInspect();
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
    const beginPinch = (idA: number, idB: number): void => {
      const a = this.activePointers.get(idA);
      const b = this.activePointers.get(idB);
      if (!a || !b) return;
      this.pan.stop();
      this.panPress = null;
      this.panStarted();
      this.pinch = {
        idA,
        idB,
        lastDist: Math.hypot(b.x - a.x, b.y - a.y),
        lastMidX: (a.x + b.x) / 2,
        lastMidY: (a.y + b.y) / 2,
      };
    };
    const updatePointer = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      this.activePointers.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
        x: e.clientX - r.left,
        y: e.clientY - r.top,
      });
    };
    // Prevent iOS Safari / WKWebView from hijacking two-finger canvas pinches for page zoom.
    canvas.addEventListener('gesturestart', (e) => {
      if (this.phoneCamera) e.preventDefault();
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        // Right click: a hero move order (when the hero is selected); never a tap.
        this.down = null;
        const r = canvas.getBoundingClientRect();
        this.rightClick(e.clientX - r.left, e.clientY - r.top);
        return;
      }
      if (this.phoneCamera) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        updatePointer(e);
        if (this.activePointers.size === 1) {
          this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
          this.panPress = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false };
        } else if (this.activePointers.size === 2 && !this.replayCursor && !this.endShown && !anySheetOpen()) {
          const ids = Array.from(this.activePointers.keys());
          beginPinch(ids[0], ids[1]);
        } else {
          this.down = null;
        }
        return;
      }
      this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
      // Desktop: one pointer may become a pan drag; a second pointer cancels both.
      if (this.panPress && this.panPress.id !== e.pointerId) {
        if (this.panPress.active) this.pan.release(performance.now(), true);
        this.panPress = null;
        this.down = null;
      } else if (e.button === 0) this.panPress = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false };
    });
    // Drag on the map: past PAN_SLOP the press pans instead of tapping (plots, towers, hero
    // orders keep their taps). Two fingers on phones pinch-zoom. Ability / skill aiming swallows
    // these events (abilityBar2d.ts).
    canvas.addEventListener('pointermove', (e) => {
      if (this.phoneCamera && this.activePointers.has(e.pointerId)) {
        updatePointer(e);
        const pin = this.pinch;
        if (pin && this.cameraLimits) {
          const a = this.activePointers.get(pin.idA);
          const b = this.activePointers.get(pin.idB);
          if (a && b && !this.replayCursor && !this.endShown && !anySheetOpen()) {
            const dist = Math.hypot(b.x - a.x, b.y - a.y);
            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;
            const ratio = pin.lastDist > 4 && dist > 4 ? dist / pin.lastDist : 1;
            const [iw, ih] = this.level.layout2d!.imageSize;
            const f = this.map.fit;
            const next = pinchStep(
              { scale: f.scale, offsetX: f.offsetX, offsetY: f.offsetY },
              pin.lastMidX,
              pin.lastMidY,
              midX,
              midY,
              ratio,
              this.viewW,
              this.viewH,
              iw,
              ih,
              this.cameraLimits,
            );
            this.applyCamera(next.scale, next.offsetX, next.offsetY);
            pin.lastDist = dist;
            pin.lastMidX = midX;
            pin.lastMidY = midY;
          }
          return;
        }
      }
      const pp = this.panPress;
      if (!pp || pp.id !== e.pointerId) return;
      if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
        this.panPress = null;
        return;
      }
      const now = performance.now();
      if (!pp.active) {
        if (!exceedsDragThreshold(pp.x, pp.y, e.clientX, e.clientY, PAN_SLOP) || this.replayCursor || this.endShown) return;
        pp.active = true;
        this.pan.beginDrag(now);
        this.panStarted();
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          // a synthetic / already released pointer: the drag still works inside the canvas
        }
        canvas.style.cursor = 'grabbing';
      }
      const dx = e.clientX - pp.x;
      const dy = e.clientY - pp.y;
      pp.x = e.clientX;
      pp.y = e.clientY;
      if (this.pan.dragBy(dx, dy, now)) this.applyPan();
    });
    const endPan = (e: PointerEvent): void => {
      if (this.phoneCamera) {
        this.activePointers.delete(e.pointerId);
        const pin = this.pinch;
        if (pin && (e.pointerId === pin.idA || e.pointerId === pin.idB)) {
          this.pinch = null;
          this.down = null;
          if (e.type !== 'pointercancel') {
            if (this.activePointers.size >= 2) {
              const ids = Array.from(this.activePointers.keys());
              beginPinch(ids[0], ids[1]);
            } else if (this.activePointers.size === 1) {
              // Seamless handoff from two-finger pinch to one-finger drag (never triggers a tap).
              const [[remId, rem]] = Array.from(this.activePointers.entries());
              this.panPress = { id: remId, x: rem.clientX, y: rem.clientY, active: true };
              this.pan.beginDrag(performance.now());
            }
          }
          return;
        }
      }
      const pp = this.panPress;
      if (!pp || pp.id !== e.pointerId) return;
      this.panPress = null;
      if (!pp.active) return;
      this.pan.release(performance.now(), this.reducedMotion || e.type === 'pointercancel');
      canvas.style.cursor = '';
    };
    canvas.addEventListener('pointerup', endPan);
    canvas.addEventListener('pointercancel', endPan);
    // Two-finger trackpad scroll / mouse wheel: the map slides with it (pinch-zoom is the page's).
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || this.replayCursor || this.endShown || anySheetOpen()) return;
        e.preventDefault();
        const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        this.panBy(-e.deltaX * k, -e.deltaY * k);
      },
      { passive: false },
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerup', (e) => {
      const d = this.down;
      if (!d || d.id !== e.pointerId) return;
      this.down = null;
      if (this.pinch || this.activePointers.size > 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP || performance.now() - d.t > TAP_MS) return;
      const r = canvas.getBoundingClientRect();
      this.tap(e.clientX - r.left, e.clientY - r.top);
    });
    canvas.addEventListener('pointercancel', (e) => {
      if (this.down && this.down.id === e.pointerId) this.down = null;
    });
    // Desktop hover: glow the free plot under the mouse (touch has no hover).
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (this.replayCursor) {
        this.hoverPlot = -1;
        canvas.style.cursor = '';
        return;
      }
      const r = canvas.getBoundingClientRect();
      if (this.ring.isOpen && this.ring.hover(e.clientX - r.left, e.clientY - r.top)) {
        this.hoverPlot = -1;
        canvas.style.cursor = 'pointer';
        return;
      }
      const mx = (e.clientX - r.left - this.map.fit.offsetX) / this.map.fit.scale;
      const my = (e.clientY - r.top - this.map.fit.offsetY) / this.map.fit.scale;
      this.hoverPlot = this.plots.plotAtPx(mx, my);
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const overHero = !!this.world.hero && this.onHeroAt(sx, sy);
      if (this.heroSel) {
        const wx = this.map.worldXFromScreen(sx);
        const wz = this.map.worldZFromScreen(sy);
        const onPlot = this.hoverPlot !== -1 || this.towers.plotAtSprite(mx, my, this.world.towers) !== -1;
        if (overHero || onPlot) this.heroes.setHover(null);
        else {
          const valid = this.offRoad(wx, wz) <= HERO_RULES.maxOffRoadDist + HERO_TAP_SLACK;
          const c = this.world.heroSystem.groundGraph.clampToGround(wx, wz);
          this.heroes.setHover(valid ? { x: c.x, z: c.z, valid } : { x: wx, z: wz, valid });
        }
      }
      // A built tower under the mouse (ring closed, no hero order): pointer + its range, faint.
      const towerPlot = !this.ring.isOpen && !this.heroSel && !overHero ? this.towers.plotAtSprite(mx, my, this.world.towers) : -1;
      this.setHoverTower(towerPlot === -1 ? -1 : this.world.grid.getTowerIdAt(towerPlot, 0));
      canvas.style.cursor =
        overHero || this.hoverTowerId !== -1 || (this.hoverPlot !== -1 && this.world.grid.getTowerIdAt(this.hoverPlot, 0) === -1) ? 'pointer' : this.heroSel ? 'crosshair' : '';
    });
    canvas.addEventListener('pointerleave', () => {
      this.hoverPlot = -1;
      this.heroes.setHover(null);
      this.setHoverTower(-1);
    });
    // Desktop: the run pauses when the window loses focus (alt-tab, another app on top), like
    // backgrounding does; the player resumes on purpose. Touch devices pause via visibility already.
    // The desktop shell (Electron) always pauses on blur, also on a touchscreen laptop.
    window.addEventListener('blur', () => {
      if (shouldPauseOnBlur({ touch: isTouchDevice(), desktopShell: isDesktopShell(), simActive: this.stepper.simActive, paused: this.stepper.paused, endless: !!this.hooks.endless, sheetOpen: anySheetOpen() })) this.pauseForBackground();
    });
    // Steam overlay (Shift+Tab): steamworks.js 0.4 reports no overlay callback, so the overlay's
    // own hotkey pauses the run too (the GameOverlayActivated path in bindBackgroundLifecycle2D
    // takes over once the shell reports it).
    window.addEventListener(
      'keydown',
      (e) => {
        if (isSteamOverlayHotkey(e, getPlatform().isSteam)) this.pauseForBackground();
      },
      { capture: true },
    );
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
        this.quality.beginGrace(MOBILE_RESUME_GRACE_MS);
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
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (this.replayCursor) {
        // Replay viewer: Space pauses, 1 / 2 / 4 pick the speed, Esc leaves it.
        if (this.endShown) return;
        if (e.key === ' ') this.stepper.paused = !this.stepper.paused;
        else if (e.key === '1' || e.key === '2' || e.key === '4') this.setReplaySpeed(Number(e.key));
        else if (e.key === 'Escape') this.exitReplay();
        else return;
        e.preventDefault();
        return;
      }
      if (e.shiftKey && e.key.startsWith('Arrow')) {
        const dx = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
        const dy = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
        if (dx === 0 && dy === 0) return;
        e.preventDefault();
        this.panStarted();
        if (this.pan.nudge(dx, dy, this.reducedMotion)) this.applyPan();
        return;
      }
      // Rebindable (Settings → Controls, ui/keyBindings.ts): pause, speeds, horn, hero select.
      const action = e.key === 'Escape' ? null : actionForKey(loadKeyBindings(), e);
      if (action === 'pause') {
        if (e.repeat) return;
        e.preventDefault();
        this.stepper.paused = !this.stepper.paused;
      } else if (action === 'speed1') this.setSpeed(1);
      else if (action === 'speed2') this.setSpeed(2);
      else if (action === 'speed3') this.setSpeed(3);
      else if (action === 'wave') this.command({ k: 'wave' });
      else if (action === 'heroSelect' && !e.repeat && !this.stepper.paused) this.setHeroSelected(!this.heroSel);
      else if (e.key === 'Escape') {
        // Esc closes what is open (ring, hero move mode, foe card); with nothing open it opens /
        // closes the pause menu, as in most games. Synthetic Esc (the ability bar closing the
        // ring) and an Esc that already cancelled an aim never pause.
        const busy = this.ring.isOpen || this.heroSel || this.inspecting;
        this.closeRing();
        this.setHeroSelected(false);
        this.clearInspect();
        if (!busy && e.isTrusted && !e.defaultPrevented && !this.endShown && this.world.outcome === 'ongoing') this.stepper.paused = !this.stepper.paused;
      }
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
      ticks: this.ticks,
      replay: {
        playing: !!this.replayCursor,
        recorded: this.recorder?.count ?? 0,
        last: this.lastReplay ? { commands: this.lastReplay.commands.length, endTick: this.lastReplay.endTick, end: this.lastReplay.end } : null,
        applied: this.replayCursor?.applied ?? 0,
        progress: this.replayProgress,
        matched: this.replayMatched,
      },
      towers: w.towers.map((t) => ({ id: t.id, type: t.type, tier: t.tier, plot: t.col, targeting: t.targetingMode, frostSlow: t.frostSlow ?? 0, frozen: t.frostLockTimer ?? 0, veil: t.veilTimer ?? 0, rangeCut: t.rangeCut ?? 0 })),
      ring: { open: this.ring.isOpen, mode: this.ring.mode, plot: this.ring.plot, tokens: this.ring.tokenPositions(), compare: this.ring.compareSpot(), layout: this.ring.layoutInfo, rangeShown: this.rangeDisc.visible },
      hud: this.hud.rects(),
      end: this.end.debug(),
      insets: this.insets,
      fit: this.map.fit,
      pan: { x: Math.round(this.pan.x), y: Math.round(this.pan.y), range: this.pan.range, dragging: this.pan.dragging },
      camera: this.cameraLimits
        ? {
            phone: true,
            scale: this.map.fit.scale,
            minScale: this.cameraLimits.minScale,
            defaultScale: this.cameraLimits.defaultScale,
            maxScale: this.cameraLimits.maxScale,
            playable: this.cameraLimits.playable,
            pinching: !!this.pinch,
          }
        : { phone: false, scale: this.map.fit.scale },
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
      hornScore: this.hornScore,
      /** 'cave' = beside the next wave's cave, 'dock' = at its dock corner (no clear spot by the cave). */
      hornSpot: this.hud.hornSpot,
      plaque: this.hud.rects().plaque,
      hoverTower: this.hoverTowerId,
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
        deathClips: this.enemies.deathsPlayed,
        sideFrames: this.enemies.sideFrames,
        frostPatches: this.frostPatches.drawn,
        eclipse: { timer: w.enemySystem.eclipseTimer, cut: w.enemySystem.eclipseCut, shade: this.eclipse.alpha, drawn: this.eclipse.debug() },
      },
      foes: (() => {
        const n: Record<string, number> = {};
        const pool = w.enemyPool;
        for (let i = 0; i < pool.getActiveCount(); i++) {
          const e = pool.items[pool.getActiveIndex(i)];
          if (e.active) n[e.type] = (n[e.type] ?? 0) + 1;
        }
        return n;
      })(),
      bosses: (() => {
        const out: { type: string; hp: number; phase: number; elite: boolean }[] = [];
        const pool = w.enemyPool;
        for (let i = 0; i < pool.getActiveCount(); i++) {
          const e = pool.items[pool.getActiveIndex(i)];
          if (e.active && ENEMY_DEFS[e.type].isBoss) out.push({ type: e.type, hp: e.hp / e.maxHp, phase: e.bossPhase ?? 0, elite: e.elite });
        }
        return out;
      })(),
      barracks: { ...this.soldiers.debug(w.soldierSystem), rallyMode: this.rallyTower, melee: { ...this.melee.stats } },
      heroView: { ...this.heroes.debug(), screen: this.heroScreen() },
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
