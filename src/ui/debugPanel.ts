import type { EnemyType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { ENEMY_TYPES } from '../data/enemies.ts';

export interface DebugTelemetry {
  fps: number;
  frameTimeMs: number;
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

export class DebugPanel {
  private readonly rootEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly telemetryEl: HTMLPreElement;
  private readonly actions: DebugActions;
  private collapsed = false;
  private showAllRanges = false;
  private frameDtAccum = 0;
  private frameCount = 0;
  private smoothedFps = 60;
  private smoothedMs = 16.7;

  constructor(parent: HTMLElement, actions: DebugActions) {
    this.actions = actions;

    this.rootEl = document.createElement('div');
    this.rootEl.id = 'debug-panel';
    this.rootEl.className = 'debug-panel ui-interactive';

    const header = document.createElement('div');
    header.className = 'debug-header';
    const title = document.createElement('span');
    title.textContent = 'DEV DEBUG (?debug)';
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
    this.frameDtAccum += frameDt;
    this.frameCount++;
    if (this.frameDtAccum >= 0.2) {
      this.smoothedMs = (this.frameDtAccum / this.frameCount) * 1000;
      this.smoothedFps = this.frameCount / this.frameDtAccum;
      this.frameDtAccum = 0;
      this.frameCount = 0;
    }

    const t = this.actions.getTelemetry();
    const geoSuffix = typeof t.geometries === 'number' ? ` · Geos: ${t.geometries}` : '';
    this.telemetryEl.textContent =
      `FPS: ${this.smoothedFps.toFixed(1)} (${this.smoothedMs.toFixed(1)} ms)\n` +
      `Draws: ${t.drawsWithShadows} w/sh | ${t.drawsNoShadows} no-sh\n` +
      `Tris: ${t.triangles.toLocaleString()}${geoSuffix}\n` +
      `Enemies: ${t.enemiesActive}/${t.enemiesMax} · Towers: ${t.towersCount}\n` +
      `Proj: ${t.projectilesActive}/${t.projectilesMax} · FX: ${t.particlesActive}/${t.particlesMax}\n` +
      `FloatTxt: ${t.floatingTextsActive}/${t.floatingTextsMax}`;
  }

  setVisible(visible: boolean): void {
    this.rootEl.classList.toggle('hidden', !visible);
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
