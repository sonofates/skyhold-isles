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

export class TowerPanel {
  private readonly rootEl: HTMLDivElement;
  private readonly iconEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly coverageBadgeEl: HTMLSpanElement;
  private readonly statsEl: HTMLDivElement;
  private readonly targetBtns: Map<TargetingMode, HTMLButtonElement> = new Map();
  private readonly upgradeBtn: HTMLButtonElement;
  private readonly upgradeTitleEl: HTMLSpanElement;
  private readonly upgradeDiffEl: HTMLSpanElement;
  private readonly sellBtn: HTMLButtonElement;
  private sellConfirmArmed = false;

  private boundTowerId: number | null = null;

  constructor(parent: HTMLElement, callbacks: TowerPanelCallbacks) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'tower-panel hidden ui-interactive';

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
    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'tower-panel-sub';
    this.coverageBadgeEl = document.createElement('span');
    this.coverageBadgeEl.className = 'target-badge';
    metaRow.append(this.subtitleEl, this.coverageBadgeEl);
    titleWrap.append(this.titleEl, metaRow);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tower-panel-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close tower inspector');
    closeBtn.addEventListener('click', () => callbacks.onClose());

    header.append(this.iconEl, titleWrap, closeBtn);

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'tower-stats-grid';

    const targetWrap = document.createElement('div');
    targetWrap.className = 'tower-targeting';
    const targetLbl = document.createElement('div');
    targetLbl.className = 'tower-section-label';
    targetLbl.textContent = 'Targeting [T]';

    const targetRow = document.createElement('div');
    targetRow.className = 'tower-target-row';
    for (let i = 0; i < TARGET_MODES.length; i++) {
      const item = TARGET_MODES[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tower-target-btn';
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        if (this.boundTowerId !== null) {
          callbacks.onSetTargeting(this.boundTowerId, item.mode);
        }
      });
      this.targetBtns.set(item.mode, btn);
      targetRow.appendChild(btn);
    }
    targetWrap.append(targetLbl, targetRow);

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'tower-actions';

    this.upgradeBtn = document.createElement('button');
    this.upgradeBtn.type = 'button';
    this.upgradeBtn.className = 'tower-upgrade-btn';
    this.upgradeTitleEl = document.createElement('span');
    this.upgradeTitleEl.className = 'tower-upgrade-title';
    this.upgradeDiffEl = document.createElement('span');
    this.upgradeDiffEl.className = 'tower-upgrade-diff';
    this.upgradeBtn.append(this.upgradeTitleEl, this.upgradeDiffEl);
    this.upgradeBtn.addEventListener('click', () => {
      if (this.boundTowerId !== null) {
        callbacks.onUpgrade(this.boundTowerId);
      }
    });

    this.sellBtn = document.createElement('button');
    this.sellBtn.type = 'button';
    this.sellBtn.className = 'tower-sell-btn';
    this.sellBtn.addEventListener('click', () => {
      if (this.boundTowerId !== null) {
        callbacks.onSell(this.boundTowerId);
      }
    });

    actionsWrap.append(this.upgradeBtn, this.sellBtn);
    this.rootEl.append(header, this.statsEl, targetWrap, actionsWrap);
    parent.appendChild(this.rootEl);
  }

  setSellConfirmArmed(armed: boolean): void {
    this.sellConfirmArmed = armed;
    this.sellBtn.classList.toggle('confirming', armed);
  }

  update(tower: TowerEntity | null, gold: number): void {
    if (!tower) {
      this.boundTowerId = null;
      this.sellConfirmArmed = false;
      this.sellBtn.classList.remove('confirming');
      this.rootEl.classList.add('hidden');
      return;
    }

    this.boundTowerId = tower.id;
    this.rootEl.classList.remove('hidden');

    const def = TOWER_DEFS[tower.type];
    const stats = getTowerTierStats(tower.type, tower.tier);
    const tierNumerals = ['I', 'II', 'III'] as const;

    this.iconEl.innerHTML = TOWER_ICON_SVGS[tower.type];
    this.titleEl.textContent = def.name;
    this.subtitleEl.textContent = `Tier ${tierNumerals[tower.tier - 1]}`;
    const coverageLabel = def.hitsFlyers ? 'Air + Ground' : 'Ground only';
    this.coverageBadgeEl.className = `target-badge ${def.hitsFlyers ? 'air-ground' : 'ground-only'}`;
    this.coverageBadgeEl.innerHTML = `<span class="target-badge-icon">${
      def.hitsFlyers ? UI_ICON_SVGS.airGround : UI_ICON_SVGS.groundOnly
    }</span><span>${coverageLabel}</span>`;

    const specialStatLabel =
      stats.chainCount > 0
        ? `<span>Chains</span><strong>${stats.chainCount}</strong>`
        : stats.slowRatio > 0
          ? `<span>Slow</span><strong>${Math.round(stats.slowRatio * 100)}%</strong>`
          : stats.splashRadius > 0
            ? `<span>Splash</span><strong>${stats.splashRadius.toFixed(1)}m</strong>`
            : `<span>Kills</span><strong>${tower.kills}</strong>`;

    this.statsEl.innerHTML = `
      <div class="stat-cell"><span>Damage</span><strong>${stats.damage}</strong></div>
      <div class="stat-cell"><span>Rate</span><strong>${stats.fireRate.toFixed(2)}/s</strong></div>
      <div class="stat-cell"><span>Range</span><strong>${
        stats.minRange > 0 ? `${stats.minRange.toFixed(1)}-${stats.range.toFixed(1)}` : stats.range.toFixed(1)
      }</strong></div>
      <div class="stat-cell">${specialStatLabel}</div>
    `;

    this.targetBtns.forEach((btn, mode) => {
      btn.classList.toggle('active', tower.targetingMode === mode);
    });

    if (tower.tier < 3) {
      const nextTier = (tower.tier + 1) as 2 | 3;
      const nextStats = getTowerTierStats(tower.type, nextTier);
      const canAfford = gold >= nextStats.upgradeCost;

      this.upgradeBtn.disabled = !canAfford;
      this.upgradeBtn.classList.toggle('unaffordable', !canAfford);
      this.upgradeBtn.classList.remove('maxed');
      this.upgradeTitleEl.textContent = `[U] Upgrade T${nextTier} · ${nextStats.upgradeCost}g`;

      const diffs: string[] = [];
      const dmgDiff = nextStats.damage - stats.damage;
      const rateDiff = nextStats.fireRate - stats.fireRate;
      const rngDiff = nextStats.range - stats.range;
      if (dmgDiff > 0) diffs.push(`+${dmgDiff} DMG`);
      if (rateDiff > 0.01) diffs.push(`+${rateDiff.toFixed(2)}/s`);
      if (rngDiff > 0.05) diffs.push(`+${rngDiff.toFixed(1)} RNG`);
      if (nextStats.chainCount > stats.chainCount) {
        diffs.push(`+${nextStats.chainCount - stats.chainCount} Chain`);
      } else if (nextStats.slowRatio > stats.slowRatio) {
        diffs.push(`+${Math.round((nextStats.slowRatio - stats.slowRatio) * 100)}% Slow`);
      } else if (nextStats.splashRadius > stats.splashRadius) {
        diffs.push(`+${(nextStats.splashRadius - stats.splashRadius).toFixed(1)} AoE`);
      }
      this.upgradeDiffEl.textContent = diffs.join(' · ');
    } else {
      this.upgradeBtn.disabled = true;
      this.upgradeBtn.classList.remove('unaffordable');
      this.upgradeBtn.classList.add('maxed');
      this.upgradeTitleEl.textContent = 'Max Tier (III)';
      this.upgradeDiffEl.textContent = `Total DMG: ${Math.round(tower.totalDamageDealt)}`;
    }

    const refund = computeSellRefund(tower.totalInvested);
    this.sellBtn.classList.toggle('confirming', this.sellConfirmArmed);
    this.sellBtn.textContent = this.sellConfirmArmed
      ? `Confirm Sell [S] +${refund}g`
      : `[S] Sell +${refund}g (70%)`;
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
