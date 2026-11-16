import type { TowerType } from '../core/types.ts';
import { getTowerTierStats, TOWER_DEFS, TOWER_TYPES } from '../data/towers.ts';
import { TOWER_ICON_SVGS, UI_ICON_SVGS } from './icons.ts';

export class BuildBar {
  private readonly rootEl: HTMLDivElement;
  private readonly cards: Map<
    TowerType,
    { btn: HTMLButtonElement; costEl: HTMLSpanElement }
  > = new Map();
  private lastGold = -1;
  private lastActive: TowerType | null | undefined = undefined;

  constructor(parent: HTMLElement, onSelectTowerType: (type: TowerType) => void) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'build-bar ui-interactive';

    for (let i = 0; i < TOWER_TYPES.length; i++) {
      const type = TOWER_TYPES[i];
      const def = TOWER_DEFS[type];
      const baseCost = getTowerTierStats(type, 1).upgradeCost;
      const coverageLabel = def.hitsFlyers ? 'Air + Ground' : 'Ground only';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'build-card';
      btn.title = `${def.name} (${def.hotkey}) [${coverageLabel}] — ${def.shortDesc}`;
      btn.setAttribute('data-tower', type);

      const hotkeyEl = document.createElement('span');
      hotkeyEl.className = 'build-hotkey';
      hotkeyEl.textContent = String(def.hotkey);

      const iconEl = document.createElement('div');
      iconEl.className = 'build-icon';
      iconEl.innerHTML = TOWER_ICON_SVGS[type];

      const shortNames: Record<TowerType, string> = {
        archer: 'Archer',
        cannon: 'Cannon',
        frost: 'Frost',
        tesla: 'Tesla',
        mortar: 'Mortar',
        ballista: 'Ballista',
        beacon: 'Beacon',
      };
      const nameEl = document.createElement('div');
      nameEl.className = 'build-name';
      nameEl.textContent = shortNames[type];

      const costEl = document.createElement('span');
      costEl.className = 'build-cost';
      costEl.textContent = `${baseCost}g`;

      const coverageEl = document.createElement('span');
      coverageEl.className = `target-badge ${def.hitsFlyers ? 'air-ground' : 'ground-only'}`;
      coverageEl.innerHTML = `<span class="target-badge-icon">${
        def.hitsFlyers ? UI_ICON_SVGS.airGround : UI_ICON_SVGS.groundOnly
      }</span><span>${coverageLabel}</span>`;

      btn.append(hotkeyEl, iconEl, nameEl, costEl, coverageEl);
      btn.addEventListener('click', () => onSelectTowerType(type));

      this.cards.set(type, { btn, costEl });
      this.rootEl.appendChild(btn);
    }

    parent.appendChild(this.rootEl);
  }

  update(gold: number, activeType: TowerType | null): void {
    if (gold === this.lastGold && activeType === this.lastActive) return;
    this.lastGold = gold;
    this.lastActive = activeType;

    for (let i = 0; i < TOWER_TYPES.length; i++) {
      const type = TOWER_TYPES[i];
      const cost = getTowerTierStats(type, 1).upgradeCost;
      const card = this.cards.get(type);
      if (!card) continue;
      const affordable = gold >= cost;
      card.btn.classList.toggle('unaffordable', !affordable);
      card.btn.classList.toggle('active', activeType === type);
    }
  }

  setVisible(visible: boolean): void {
    this.rootEl.classList.toggle('hidden', !visible);
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
