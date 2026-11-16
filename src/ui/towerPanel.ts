import type { TargetingMode } from '../core/types.ts';
import { getTowerTierStats, TOWER_DEFS } from '../data/towers.ts';
import type { TowerEntity } from '../sim/entities.ts';
import { computeSellRefund } from '../sim/world.ts';
import { TOWER_ICON_SVGS, UI_ICON_SVGS } from './icons.ts';

export interface TowerPanelCallbacks {
  onUpgrade: (towerId: number) => void;
  onSell: (towerId: number) => void;
  onSetTargeting: (towerId: number, mode: TargetingMode) => void;
  onClose: () => void;
}

const TARGET_MODES: readonly { mode: TargetingMode; label: string }[] = [
  { mode: 'first', label: 'First' },
  { mode: 'last', label: 'Last' },
  { mode: 'strongest', label: 'Strongest' },
  { mode: 'closest', label: 'Closest' },
];

const TIER_LABELS: readonly string[] = ['Tier I', 'Tier II', 'Tier III · Max'];

const DESKTOP_BREAKPOINT = 768;
const EDGE_MARGIN_X = 12;
const TOP_SAFE_MARGIN = 72;
const BOTTOM_SAFE_MARGIN = 128;
const ANCHOR_HORIZONTAL_GAP = 56;
/** Phone-landscape layouts (short viewports) pin the panel to a screen edge instead of floating it. */
const COMPACT_LANDSCAPE_MAX_HEIGHT = 500;
/** Dead zone around the viewport midline so the outward side doesn't flicker while panning. */
const SIDE_HYSTERESIS_PX = 70;

interface StatChip {
  value: string;
  unit: string;
}

function formatDamageDealt(rawDamage: number): string {
  const rounded = Math.max(0, Math.round(rawDamage));
  if (rounded >= 1_000_000) {
    return `${(rounded / 1_000_000).toFixed(1)}M`;
  }
  if (rounded >= 1000) {
    return `${(rounded / 1000).toFixed(1)}k`;
  }
  return String(rounded);
}

export class TowerPanel {
  private readonly rootEl: HTMLDivElement;
  private readonly iconEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLSpanElement;
  private readonly coverageBadgeEl: HTMLSpanElement;
  private readonly statsEl: HTMLDivElement;
  private readonly telemetryEl: HTMLDivElement;
  private readonly killsValEl: HTMLElement;
  private readonly dmgDealtValEl: HTMLElement;
  private readonly targetBtns: Map<TargetingMode, HTMLButtonElement> = new Map();
  private readonly upgradeBtn: HTMLButtonElement;
  private readonly upgradeTitleEl: HTMLSpanElement;
  private readonly upgradeCostEl: HTMLSpanElement;
  private readonly upgradeDiffEl: HTMLSpanElement;
  private readonly sellBtn: HTMLButtonElement;
  private readonly sellLabelEl: HTMLSpanElement;
  private readonly sellValueEl: HTMLSpanElement;

  private sellConfirmArmed = false;
  private boundTowerId: number | null = null;
  private lastSignature = '';
  private lastBaseSignature = '';
  private cachedPanelW = 288;
  private cachedPanelH = 178;
  private metricsDirty = true;

  private lastAnchorX = NaN;
  private lastAnchorY = NaN;
  private lastAnchorSide = '';
  private lastCaretY = NaN;
  private lastCaretVisible = false;

  constructor(parent: HTMLElement, callbacks: TowerPanelCallbacks) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'tower-panel hidden ui-interactive';
    this.rootEl.setAttribute('role', 'region');
    this.rootEl.setAttribute('aria-label', 'Selected tower inspector');

    const header = document.createElement('div');
    header.className = 'tower-panel-header';

    this.iconEl = document.createElement('div');
    this.iconEl.className = 'tower-panel-icon';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'tower-panel-titles';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'tower-panel-title';

    const metaRow = document.createElement('div');
    metaRow.className = 'tower-panel-meta';
    this.subtitleEl = document.createElement('span');
    this.subtitleEl.className = 'tower-panel-sub';
    this.coverageBadgeEl = document.createElement('span');
    this.coverageBadgeEl.className = 'tower-panel-badge';
    metaRow.append(this.subtitleEl, this.coverageBadgeEl);

    titleWrap.append(this.titleEl, metaRow);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tower-panel-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close (Esc)';
    closeBtn.setAttribute('aria-label', 'Close tower panel');
    closeBtn.addEventListener('click', () => callbacks.onClose());

    header.append(this.iconEl, titleWrap, closeBtn);

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'tower-panel-stats';

    this.telemetryEl = document.createElement('div');
    this.telemetryEl.className = 'tower-panel-stats tower-panel-telemetry';
    this.telemetryEl.style.gap = '4px 6px';
    this.telemetryEl.style.background = 'rgba(79, 179, 217, 0.1)';

    const killsChip = document.createElement('span');
    killsChip.className = 'tower-stat-chip';
    killsChip.style.gap = '3px';
    const killsUnit = document.createElement('span');
    killsUnit.className = 'tower-stat-unit';
    killsUnit.textContent = 'Kills';
    this.killsValEl = document.createElement('strong');
    this.killsValEl.className = 'tower-stat-val';
    this.killsValEl.textContent = '0';
    killsChip.append(killsUnit, this.killsValEl);

    const telemetryDot = document.createElement('span');
    telemetryDot.className = 'tower-stat-dot';
    telemetryDot.setAttribute('aria-hidden', 'true');
    telemetryDot.textContent = '·';

    const dmgChip = document.createElement('span');
    dmgChip.className = 'tower-stat-chip';
    dmgChip.style.gap = '3px';
    const dmgUnit = document.createElement('span');
    dmgUnit.className = 'tower-stat-unit';
    dmgUnit.textContent = 'DMG';
    this.dmgDealtValEl = document.createElement('strong');
    this.dmgDealtValEl.className = 'tower-stat-val';
    this.dmgDealtValEl.textContent = '0';
    dmgChip.append(dmgUnit, this.dmgDealtValEl);

    this.telemetryEl.append(killsChip, telemetryDot, dmgChip);

    const actions = document.createElement('div');
    actions.className = 'tower-panel-actions';

    this.upgradeBtn = document.createElement('button');
    this.upgradeBtn.type = 'button';
    this.upgradeBtn.className = 'tower-upgrade-btn';
    const upgradeTop = document.createElement('span');
    upgradeTop.className = 'tower-upgrade-top';
    this.upgradeTitleEl = document.createElement('span');
    this.upgradeTitleEl.className = 'tower-upgrade-title';
    this.upgradeCostEl = document.createElement('span');
    this.upgradeCostEl.className = 'tower-upgrade-cost';
    upgradeTop.append(this.upgradeTitleEl, this.upgradeCostEl);

    this.upgradeDiffEl = document.createElement('span');
    this.upgradeDiffEl.className = 'tower-upgrade-diff';
    this.upgradeBtn.append(upgradeTop, this.upgradeDiffEl);
    this.upgradeBtn.addEventListener('click', () => {
      if (this.boundTowerId !== null) {
        callbacks.onUpgrade(this.boundTowerId);
      }
    });

    this.sellBtn = document.createElement('button');
    this.sellBtn.type = 'button';
    this.sellBtn.className = 'tower-sell-btn';
    this.sellLabelEl = document.createElement('span');
    this.sellLabelEl.className = 'tower-sell-label';
    this.sellValueEl = document.createElement('span');
    this.sellValueEl.className = 'tower-sell-value';
    this.sellBtn.append(this.sellLabelEl, this.sellValueEl);
    this.sellBtn.addEventListener('click', () => {
      if (this.boundTowerId !== null) {
        callbacks.onSell(this.boundTowerId);
      }
    });

    actions.append(this.upgradeBtn, this.sellBtn);

    const targetWrap = document.createElement('div');
    targetWrap.className = 'tower-targeting';
    const targetHeader = document.createElement('div');
    targetHeader.className = 'tower-targeting-header';
    const targetLabel = document.createElement('span');
    targetLabel.className = 'tower-targeting-label';
    targetLabel.textContent = 'Target';
    const targetKbd = document.createElement('kbd');
    targetKbd.className = 'tower-panel-kbd';
    targetKbd.textContent = 'T';
    targetHeader.append(targetLabel, targetKbd);

    const targetGrid = document.createElement('div');
    targetGrid.className = 'tower-targeting-grid';
    for (const item of TARGET_MODES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tower-target-btn';
      btn.textContent = item.label;
      btn.title = `Target ${item.label.toLowerCase()} (T to cycle)`;
      btn.addEventListener('click', () => {
        if (this.boundTowerId !== null) {
          callbacks.onSetTargeting(this.boundTowerId, item.mode);
        }
      });
      this.targetBtns.set(item.mode, btn);
      targetGrid.appendChild(btn);
    }
    targetWrap.append(targetHeader, targetGrid);

    this.rootEl.append(header, this.statsEl, this.telemetryEl, actions, targetWrap);
    parent.appendChild(this.rootEl);
  }

  setSellConfirmArmed(armed: boolean): void {
    this.sellConfirmArmed = armed;
  }

  update(tower: TowerEntity | null, currentGold: number): void {
    if (!tower) {
      if (this.boundTowerId !== null) {
        this.boundTowerId = null;
        this.lastSignature = '';
        this.lastBaseSignature = '';
        this.rootEl.classList.add('hidden');
      }
      return;
    }

    const wasHidden = this.boundTowerId === null;
    this.boundTowerId = tower.id;
    this.rootEl.classList.remove('hidden');

    const def = TOWER_DEFS[tower.type];
    const stats = getTowerTierStats(tower.type, tower.tier);
    const nextStats = tower.tier < 3 ? getTowerTierStats(tower.type, (tower.tier + 1) as 2 | 3) : null;
    const canUpgrade = nextStats !== null && currentGold >= nextStats.upgradeCost;
    const refund = computeSellRefund(tower.totalInvested);
    const kills = Math.max(0, Math.round(tower.kills));
    const dmgFloor = Math.max(0, Math.floor(tower.totalDamageDealt));

    const baseSig = `${tower.id}:${tower.tier}:${tower.targetingMode}:${canUpgrade ? 1 : 0}:${refund}:${this.sellConfirmArmed ? 1 : 0}`;
    const sig = `${baseSig}:${kills}:${dmgFloor}`;
    if (sig === this.lastSignature) {
      if (wasHidden) this.metricsDirty = true;
      return;
    }
    this.lastSignature = sig;

    this.killsValEl.textContent = String(kills);
    this.dmgDealtValEl.textContent = formatDamageDealt(tower.totalDamageDealt);

    if (!wasHidden && baseSig === this.lastBaseSignature) {
      return;
    }
    this.lastBaseSignature = baseSig;
    this.metricsDirty = true;

    this.iconEl.innerHTML = TOWER_ICON_SVGS[tower.type];
    this.titleEl.textContent = def.name;
    this.subtitleEl.textContent = TIER_LABELS[tower.tier - 1] ?? `Tier ${tower.tier}`;
    this.subtitleEl.classList.toggle('is-max', tower.tier >= 3);

    this.coverageBadgeEl.innerHTML = `<span class="target-badge-icon">${
      def.hitsFlyers ? UI_ICON_SVGS.airGround : UI_ICON_SVGS.groundOnly
    }</span><span>${def.hitsFlyers ? 'Air + Ground' : 'Ground'}</span>`;
    this.coverageBadgeEl.className = `target-badge ${def.hitsFlyers ? 'air-ground' : 'ground-only'}`;

    const chips: StatChip[] = [
      { value: `${stats.damage}`, unit: 'DMG' },
      { value: `${stats.fireRate.toFixed(2)}`, unit: '/s' },
      { value: `${stats.range.toFixed(1)}`, unit: 'RNG' },
    ];
    if (stats.splashRadius > 0) {
      chips.push({ value: `${stats.splashRadius.toFixed(1)}m`, unit: 'AoE' });
    } else if (stats.slowRatio > 0) {
      chips.push({ value: `${Math.round(stats.slowRatio * 100)}%`, unit: 'Slow' });
    } else if (stats.chainCount > 1) {
      chips.push({ value: `${stats.chainCount}×`, unit: 'Chain' });
    }

    this.statsEl.innerHTML = chips
      .map(
        (c) =>
          `<span class="tower-stat-chip"><strong class="tower-stat-val">${c.value}</strong><span class="tower-stat-unit">${c.unit}</span></span>`,
      )
      .join('<span class="tower-stat-dot" aria-hidden="true">·</span>');

    for (const [mode, btn] of this.targetBtns) {
      const isActive = tower.targetingMode === mode;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }

    if (nextStats) {
      this.upgradeBtn.disabled = !canUpgrade;
      this.upgradeBtn.classList.toggle('is-maxed', false);
      this.upgradeBtn.classList.toggle('is-affordable', canUpgrade);
      this.upgradeTitleEl.innerHTML = `Upgrade T${nextStats.tier} <kbd class="tower-panel-kbd on-cta">U</kbd>`;
      this.upgradeCostEl.textContent = `${nextStats.upgradeCost}g`;
      this.upgradeCostEl.hidden = false;

      const diffs: string[] = [];
      const dmgDiff = nextStats.damage - stats.damage;
      if (dmgDiff > 0) diffs.push(`+${dmgDiff} DMG`);
      const rateDiff = +(nextStats.fireRate - stats.fireRate).toFixed(2);
      if (rateDiff > 0) diffs.push(`+${rateDiff}/s`);
      const rngDiff = +(nextStats.range - stats.range).toFixed(1);
      if (rngDiff > 0) diffs.push(`+${rngDiff} RNG`);
      const aoEDiff = +(nextStats.splashRadius - stats.splashRadius).toFixed(1);
      if (aoEDiff > 0) diffs.push(`+${aoEDiff} AoE`);
      const slowDiff = Math.round((nextStats.slowRatio - stats.slowRatio) * 100);
      if (slowDiff > 0) diffs.push(`+${slowDiff}%`);
      const chainDiff = nextStats.chainCount - stats.chainCount;
      if (chainDiff > 0) diffs.push(`+${chainDiff} Chain`);
      this.upgradeDiffEl.textContent = diffs.join(' · ');
      this.upgradeDiffEl.hidden = diffs.length === 0;
    } else {
      this.upgradeBtn.disabled = true;
      this.upgradeBtn.classList.toggle('is-maxed', true);
      this.upgradeBtn.classList.toggle('is-affordable', false);
      this.upgradeTitleEl.textContent = 'Max Tier III';
      this.upgradeCostEl.textContent = '';
      this.upgradeCostEl.hidden = true;
      this.upgradeDiffEl.textContent = '';
      this.upgradeDiffEl.hidden = true;
    }

    this.sellBtn.classList.toggle('is-confirm', this.sellConfirmArmed);
    if (this.sellConfirmArmed) {
      this.sellLabelEl.innerHTML = 'Confirm <kbd class="tower-panel-kbd on-danger">Del</kbd>';
      this.sellValueEl.textContent = `+${refund}g`;
    } else {
      this.sellLabelEl.innerHTML = 'Sell <kbd class="tower-panel-kbd">Del</kbd>';
      this.sellValueEl.textContent = `+${refund}g`;
    }
  }

  /**
   * Positions the inspector next to the selected tower in screen space with viewport edge flipping
   * and safe-area clamping so it stays clear of the HUD bar and bottom build dock.
   */
  setAnchorScreenPos(screenX: number, screenY: number, viewportW: number, viewportH: number): void {
    if (this.boundTowerId === null) return;

    if (viewportH <= COMPACT_LANDSCAPE_MAX_HEIGHT && viewportW > viewportH) {
      // Edge sheet on the half of the screen the tower is NOT in, so the tower stays visible.
      const mid = viewportW * 0.5;
      let side: string = this.lastAnchorSide === 'edge-left' ? 'edge-left' : 'edge-right';
      if (screenX > mid + SIDE_HYSTERESIS_PX) side = 'edge-left';
      else if (screenX < mid - SIDE_HYSTERESIS_PX) side = 'edge-right';
      this.setStaticSide(side);
      return;
    }

    if (viewportW <= DESKTOP_BREAKPOINT) {
      this.setStaticSide('dock');
      return;
    }

    if (this.metricsDirty) {
      this.cachedPanelW = this.rootEl.offsetWidth || 288;
      this.cachedPanelH = this.rootEl.offsetHeight || 178;
      this.metricsDirty = false;
    }

    const panelW = this.cachedPanelW;
    const panelH = this.cachedPanelH;

    const rightCandidateX = screenX + ANCHOR_HORIZONTAL_GAP;
    const leftCandidateX = screenX - ANCHOR_HORIZONTAL_GAP - panelW;

    // Prefer the side facing away from the island centre so the panel doesn't sit on top of
    // neighbouring towers and the path; fall back to whichever side actually fits.
    const rightFits = rightCandidateX + panelW <= viewportW - EDGE_MARGIN_X;
    const leftFits = leftCandidateX >= EDGE_MARGIN_X;
    const mid = viewportW * 0.5;
    let preferred: 'right' | 'left' =
      this.lastAnchorSide === 'left' || this.lastAnchorSide === 'right' ? this.lastAnchorSide : 'right';
    if (screenX < mid - SIDE_HYSTERESIS_PX) preferred = 'left';
    else if (screenX > mid + SIDE_HYSTERESIS_PX) preferred = 'right';

    let side: 'right' | 'left';
    let targetX: number;
    if (preferred === 'left' ? leftFits : !rightFits && leftFits) {
      side = 'left';
      targetX = leftCandidateX;
    } else if (rightFits) {
      side = 'right';
      targetX = rightCandidateX;
    } else if (viewportW - screenX >= screenX) {
      side = 'right';
      targetX = rightCandidateX;
    } else {
      side = 'left';
      targetX = leftCandidateX;
    }

    const maxX = Math.max(EDGE_MARGIN_X, viewportW - EDGE_MARGIN_X - panelW);
    const clampedX = Math.round(Math.max(EDGE_MARGIN_X, Math.min(maxX, targetX)));

    const maxY = Math.max(TOP_SAFE_MARGIN, viewportH - BOTTOM_SAFE_MARGIN - panelH);
    const idealY = screenY - panelH * 0.5;
    const clampedY = Math.round(Math.max(TOP_SAFE_MARGIN, Math.min(maxY, idealY)));

    const rawCaretY = screenY - clampedY;
    const caretY = Math.round(Math.max(22, Math.min(panelH - 22, rawCaretY)));
    const showCaret =
      Math.abs(clampedX - targetX) <= 12 &&
      screenY >= clampedY + 14 &&
      screenY <= clampedY + panelH - 14;

    if (
      clampedX !== this.lastAnchorX ||
      clampedY !== this.lastAnchorY ||
      side !== this.lastAnchorSide ||
      caretY !== this.lastCaretY ||
      showCaret !== this.lastCaretVisible
    ) {
      this.lastAnchorX = clampedX;
      this.lastAnchorY = clampedY;
      this.lastAnchorSide = side;
      this.lastCaretY = caretY;
      this.lastCaretVisible = showCaret;

      this.rootEl.dataset.anchorSide = side;
      this.rootEl.dataset.anchorCaret = showCaret ? '1' : '0';
      this.rootEl.style.setProperty('--tp-x', `${clampedX}px`);
      this.rootEl.style.setProperty('--tp-y', `${clampedY}px`);
      this.rootEl.style.setProperty('--tp-caret-y', `${caretY}px`);
    }
  }

  /** Mobile docks and landscape edge sheets are positioned purely by CSS (no --tp-* offsets). */
  private setStaticSide(side: string): void {
    if (this.lastAnchorSide === side) return;
    this.lastAnchorSide = side;
    this.lastAnchorX = NaN;
    this.lastAnchorY = NaN;
    this.lastCaretY = NaN;
    this.lastCaretVisible = false;
    this.rootEl.dataset.anchorSide = side;
    this.rootEl.dataset.anchorCaret = '0';
    this.rootEl.style.removeProperty('--tp-x');
    this.rootEl.style.removeProperty('--tp-y');
    this.rootEl.style.removeProperty('--tp-caret-y');
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
