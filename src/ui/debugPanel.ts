import type { EnemyType, QualityLevel } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { ENEMY_TYPES } from '../data/enemies.ts';
import type { QualityTier, StartupTimingMetrics } from '../render/perfGovernor.ts';

export type DebugPanelMode = 'debug' | 'perf';

export interface DebugTelemetry {
  fps: number;
  frameTimeMs: number;
  p95FrameMs?: number;
  maxFrameMs?: number;
  workAvgMs?: number;
  workP95Ms?: number;
  drawCalls: number;
  drawsWithShadows: number;
  drawsNoShadows: number;
  triangles: number;
  enemiesActive: number;
  enemiesMax: number;
  towersCount: number;
  projectilesActive: number;
  projectilesMax: number;
  particlesActive: number;
  particlesMax: number;
  floatingTextsActive: number;
  floatingTextsMax: number;
  geometries?: number;
  textures?: number;
  programs?: number;
  dpr?: number;
  nativeDpr?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  composerEnabled?: boolean;
  activePasses?: string;
  shadowsEnabled?: boolean;
  shadowMapSize?: number;
  qualityMode?: QualityLevel;
  activeTier?: QualityTier;
  tierLabel?: string;
  lockedCeilingTier?: QualityTier;
  defaultMaxTier?: QualityTier;
  tierTransitions?: number;
  pacingMode?: string;
  pacingFps?: number | null;
  startup?: StartupTimingMetrics | null;
}

export interface DebugActions {
  onAddGold: (amount: number) => void;
  onSetLives: (lives: number) => void;
  onSkipToWave: (waveOneBased: number) => void;
  onSpawnEnemies: (type: EnemyType, count: number) => void;
  onInstantWin: () => void;
  onInstantLose: () => void;
  onToggleAllRangeRings: (show: boolean) => void;
  getTelemetry: () => DebugTelemetry;
}

export function formatPerfLogLine(t: DebugTelemetry): string {
  const fpsStr = t.fps > 0 ? t.fps.toFixed(1) : '0.0';
  const p95Str = typeof t.p95FrameMs === 'number' ? t.p95FrameMs.toFixed(1) : t.frameTimeMs.toFixed(1);
  const maxStr = typeof t.maxFrameMs === 'number' ? ` max=${t.maxFrameMs.toFixed(1)}ms` : '';
  const workAvg = typeof t.workAvgMs === 'number' ? t.workAvgMs.toFixed(2) : '0.00';
  const workStr =
    typeof t.workP95Ms === 'number' ? `${workAvg}/${t.workP95Ms.toFixed(2)}` : workAvg;
  const dprStr = typeof t.dpr === 'number' ? t.dpr.toFixed(2) : '1.00';
  const resStr =
    typeof t.pixelWidth === 'number' && typeof t.pixelHeight === 'number'
      ? `${t.pixelWidth}x${t.pixelHeight}`
      : 'n/a';
  const composerStr = t.composerEnabled ? `ON[${t.activePasses ?? ''}]` : 'OFF';
  const shadowStr =
    t.shadowsEnabled === false ? 'OFF' : t.shadowMapSize ? `ON(${t.shadowMapSize})` : 'ON';
  const tierStr =
    typeof t.activeTier === 'number' ? `T${t.activeTier}(${t.tierLabel ?? ''})` : 'n/a';
  const capStr =
    typeof t.lockedCeilingTier === 'number' &&
    typeof t.defaultMaxTier === 'number' &&
    t.lockedCeilingTier < t.defaultMaxTier
      ? ` cap=T${t.lockedCeilingTier}`
      : '';
  const chgStr =
    typeof t.tierTransitions === 'number' && t.tierTransitions > 0
      ? ` chg=${t.tierTransitions}`
      : '';
  const progsStr = typeof t.programs === 'number' ? ` progs=${t.programs}` : '';
  const loopLabel =
    t.pacingFps && t.pacingFps > 0
      ? `${t.pacingMode ?? 'cap'}@${t.pacingFps}fps`
      : (t.pacingMode ?? 'active');
  return (
    `[Skyhold Perf] fps=${fpsStr} p95=${p95Str}ms${maxStr} work=${workStr}ms loop=${loopLabel} ` +
    `draws=${t.drawCalls} tris=${t.triangles} tex=${t.textures ?? 0} geos=${t.geometries ?? 0}${progsStr} ` +
    `dpr=${dprStr}(${resStr}) composer=${composerStr} sh=${shadowStr} quality=${t.qualityMode ?? 'auto'}->${tierStr}${capStr}${chgStr}`
  );
}

export class DebugPanel {
  private readonly rootEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly telemetryEl: HTMLPreElement;
  private readonly actions: DebugActions;
  private readonly mode: DebugPanelMode;
  private collapsed = false;
  private showAllRanges = false;
  private frameDtAccum = 0;
  private frameCount = 0;
  private smoothedFps = 0;
  private smoothedMs = 0;
  private hasSmoothedSample = false;
  private uiRefreshAccum = 0.2;

  constructor(parent: HTMLElement, actions: DebugActions, mode: DebugPanelMode = 'debug') {
    this.actions = actions;
    this.mode = mode;

    this.rootEl = document.createElement('div');
    this.rootEl.id = 'debug-panel';
    this.rootEl.className = 'debug-panel ui-interactive';

    const header = document.createElement('div');
    header.className = 'debug-header';
    const title = document.createElement('span');
    title.textContent = mode === 'perf' ? 'PERF (?perf)' : 'DEV DEBUG (?debug)';
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'debug-btn debug-btn-mini';
    toggleBtn.textContent = 'Hide';
    toggleBtn.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.bodyEl.classList.toggle('hidden', this.collapsed);
      toggleBtn.textContent = this.collapsed ? 'Show' : 'Hide';
    });
    header.append(title, toggleBtn);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'debug-body';

    this.telemetryEl = document.createElement('pre');
    this.telemetryEl.className = 'debug-telemetry';

    if (mode === 'perf') {
      const perfRow = document.createElement('div');
      perfRow.className = 'debug-row';
      perfRow.append(
        this.makeButton('Log Snapshot', () => {
          console.info(formatPerfLogLine(this.actions.getTelemetry()));
        }),
      );
      this.bodyEl.append(this.telemetryEl, perfRow);
    } else {
      // Gold & Lives row
      const ecoRow = document.createElement('div');
      ecoRow.className = 'debug-row';
      ecoRow.append(
        this.makeButton('+100g', () => this.actions.onAddGold(100)),
        this.makeButton('+500g', () => this.actions.onAddGold(500)),
        this.makeButton('Lives=20', () => this.actions.onSetLives(20)),
        this.makeButton('Lives=1', () => this.actions.onSetLives(1)),
      );

      // Wave skip row
      const waveRow = document.createElement('div');
      waveRow.className = 'debug-row';
      const waveInput = document.createElement('input');
      waveInput.type = 'number';
      waveInput.min = '1';
      waveInput.max = '25';
      waveInput.value = '1';
      waveInput.className = 'debug-input';
      waveInput.setAttribute('aria-label', 'Wave number');
      const skipBtn = this.makeButton('Skip Wave', () => {
        const n = Math.max(1, Math.floor(Number(waveInput.value) || 1));
        this.actions.onSkipToWave(n);
      });
      waveRow.append(waveInput, skipBtn);

      // Spawn enemies row
      const spawnRow = document.createElement('div');
      spawnRow.className = 'debug-row';
      const typeSelect = document.createElement('select');
      typeSelect.className = 'debug-select';
      typeSelect.setAttribute('aria-label', 'Enemy type');
      for (let i = 0; i < ENEMY_TYPES.length; i++) {
        const opt = document.createElement('option');
        opt.value = ENEMY_TYPES[i];
        opt.textContent = ENEMY_TYPES[i];
        typeSelect.appendChild(opt);
      }
      const countInput = document.createElement('input');
      countInput.type = 'number';
      countInput.min = '1';
      countInput.max = String(BALANCE.pools.maxEnemies);
      countInput.value = '10';
      countInput.className = 'debug-input';
      countInput.setAttribute('aria-label', 'Enemy spawn count');
      const spawnBtn = this.makeButton('Spawn', () => {
        const type = typeSelect.value as EnemyType;
        const count = Math.max(1, Math.min(BALANCE.pools.maxEnemies, Math.floor(Number(countInput.value) || 1)));
        this.actions.onSpawnEnemies(type, count);
      });
      spawnRow.append(typeSelect, countInput, spawnBtn);

      // Instant outcome & ranges row
      const stateRow = document.createElement('div');
      stateRow.className = 'debug-row';
      const rangeBtn = this.makeButton('Ranges: OFF', () => {
        this.showAllRanges = !this.showAllRanges;
        rangeBtn.textContent = this.showAllRanges ? 'Ranges: ON' : 'Ranges: OFF';
        rangeBtn.classList.toggle('active', this.showAllRanges);
        this.actions.onToggleAllRangeRings(this.showAllRanges);
      });
      stateRow.append(
        this.makeButton('Win', () => this.actions.onInstantWin()),
        this.makeButton('Lose', () => this.actions.onInstantLose()),
        rangeBtn,
      );

      this.bodyEl.append(this.telemetryEl, ecoRow, waveRow, spawnRow, stateRow);
    }

    this.rootEl.append(header, this.bodyEl);
    parent.appendChild(this.rootEl);
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'debug-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  update(frameDt: number): void {
    if (frameDt > 0) {
      this.frameDtAccum += frameDt;
      this.frameCount++;
      this.uiRefreshAccum += frameDt;
      if (this.frameDtAccum >= 0.2) {
        this.smoothedMs = (this.frameDtAccum / this.frameCount) * 1000;
        this.smoothedFps = this.frameCount / this.frameDtAccum;
        this.hasSmoothedSample = true;
        this.frameDtAccum = 0;
        this.frameCount = 0;
      }
    }

    if (this.collapsed || this.uiRefreshAccum < 0.2) {
      return;
    }
    this.uiRefreshAccum = 0;

    const t = this.actions.getTelemetry();
    const displayFps =
      t.fps > 0 ? t.fps.toFixed(1) : this.hasSmoothedSample ? this.smoothedFps.toFixed(1) : '--';
    const displayMs = t.frameTimeMs > 0 ? t.frameTimeMs : this.hasSmoothedSample ? this.smoothedMs : 0;
    const p95Ms = typeof t.p95FrameMs === 'number' && t.p95FrameMs > 0 ? t.p95FrameMs : displayMs;
    const maxMs = typeof t.maxFrameMs === 'number' && t.maxFrameMs > 0 ? t.maxFrameMs : p95Ms;
    const workMs = typeof t.workAvgMs === 'number' ? t.workAvgMs : 0;
    const workP95 = typeof t.workP95Ms === 'number' ? t.workP95Ms : workMs;
    const dprStr =
      typeof t.dpr === 'number'
        ? `${t.dpr.toFixed(2)}/${(t.nativeDpr ?? t.dpr).toFixed(2)}`
        : '1.00';
    const resStr =
      typeof t.pixelWidth === 'number' && typeof t.pixelHeight === 'number'
        ? ` (${t.pixelWidth}x${t.pixelHeight})`
        : '';
    const composerLabel = t.composerEnabled
      ? `ON [${t.activePasses ?? ''}]`
      : 'OFF [Direct]';
    const shadowsLabel =
      t.shadowsEnabled === false ? 'OFF' : t.shadowMapSize ? `ON (${t.shadowMapSize})` : 'ON';
    const capSuffix =
      typeof t.lockedCeilingTier === 'number' &&
      typeof t.defaultMaxTier === 'number' &&
      t.lockedCeilingTier < t.defaultMaxTier
        ? ` [cap:T${t.lockedCeilingTier}]`
        : '';
    const chgSuffix =
      typeof t.tierTransitions === 'number' && t.tierTransitions > 0
        ? ` (${t.tierTransitions})`
        : '';
    const qualityLabel =
      typeof t.activeTier === 'number'
        ? `${t.qualityMode ?? 'auto'} -> T${t.activeTier} ${t.tierLabel ?? ''}${capSuffix}${chgSuffix}`
        : `${t.qualityMode ?? 'auto'}`;
    const texStr = typeof t.textures === 'number' ? String(t.textures) : 'n/a';
    const geoStr = typeof t.geometries === 'number' ? String(t.geometries) : 'n/a';
    const progsStr = typeof t.programs === 'number' ? String(t.programs) : 'n/a';
    const pacingSuffix = t.pacingFps
      ? `${t.pacingMode ?? 'cap'} ${t.pacingFps}fps`
      : (t.pacingMode ?? 'active');

    if (this.mode === 'perf') {
      const bootLine = t.startup
        ? `\nBoot: ${Math.round(t.startup.timeToMenuMs)}ms (A:${Math.round(t.startup.assetsMs)} S:${Math.round(t.startup.sceneSetupMs)} W:${Math.round(t.startup.warmupMs)})`
        : '';
      this.telemetryEl.textContent =
        `FPS: ${displayFps} (${displayMs.toFixed(1)} | p95 ${p95Ms.toFixed(1)} | max ${maxMs.toFixed(1)})\n` +
        `Work: ${workMs.toFixed(2)}ms (p95 ${workP95.toFixed(2)}) · ${pacingSuffix}\n` +
        `Draws: ${t.drawCalls} · Tris: ${t.triangles.toLocaleString()}\n` +
        `Tex: ${texStr} · Geos: ${geoStr} · Progs: ${progsStr}\n` +
        `DPR: ${dprStr}${resStr}\n` +
        `Post: ${composerLabel} · Sh: ${shadowsLabel}\n` +
        `Quality: ${qualityLabel}${bootLine}`;
      return;
    }

    this.telemetryEl.textContent =
      `FPS: ${displayFps} (${displayMs.toFixed(1)}ms | p95 ${p95Ms.toFixed(1)}ms)\n` +
      `Draws: ${t.drawsWithShadows} w/sh | ${t.drawsNoShadows} no-sh\n` +
      `Tris: ${t.triangles.toLocaleString()} · Tex: ${texStr} · Geos: ${geoStr}\n` +
      `DPR: ${dprStr} · Post: ${composerLabel}\n` +
      `Qual: ${qualityLabel} (${pacingSuffix})\n` +
      `Enemies: ${t.enemiesActive}/${t.enemiesMax} · Towers: ${t.towersCount}\n` +
      `Proj: ${t.projectilesActive}/${t.projectilesMax} · FX: ${t.particlesActive}/${t.particlesMax}\n` +
      `FloatTxt: ${t.floatingTextsActive}/${t.floatingTextsMax}`;
  }

  getTelemetrySnapshot(): DebugTelemetry {
    return this.actions.getTelemetry();
  }

  setVisible(visible: boolean): void {
    this.rootEl.classList.toggle('hidden', !visible);
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
