import './radialMenu.css';
import type { TargetingMode, TowerType } from '../core/types.ts';
import { getTowerTierStats, TOWER_DEFS, TOWER_TYPES } from '../data/towers.ts';
import type { GameSession } from '../platform/gameSession.ts';
import { readSafeArea, type Insets } from '../platform/safeArea.ts';
import type { RenderWorld } from '../render/renderWorld.ts';
import { getTowerPickHeight } from '../render/towerPicking.ts';
import { computeSellRefund } from '../sim/world.ts';
import { TOWER_ICON_SVGS, UI_ICON_SVGS } from './icons.ts';
import { FOOTPRINT, layoutRing, placeBox, ringBounds, TOKEN_SIZE, type Point } from './radialLayout.ts';

type Mode = 'closed' | 'build' | 'tower' | 'info';

export type RadialTarget =
  | { kind: 'build'; col: number; row: number }
  | { kind: 'tower'; id: number };

const BASE_RADIUS = 78;
const CLICK_GUARD_MS = 280;
const TARGET_LABELS: Record<TargetingMode, string> = {
  first: 'First',
  last: 'Last',
  strongest: 'Strong',
  closest: 'Close',
};
const TIER_LABELS = ['Tier I', 'Tier II', 'Tier III'];

const ACTION_ICONS = {
  upgrade:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 20 12.5h-5V20.5H9V12.5H4z" fill="currentColor" stroke="var(--gx-ink,#1b1936)" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  sell: UI_ICON_SVGS.coin,
  confirm:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5 9.5 17.5 19.5 6.5" fill="none" stroke="var(--gx-ink,#1b1936)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 12.5 9.5 17.5 19.5 6.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  target:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="var(--gx-ink,#1b1936)" stroke-width="4.4"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" stroke="var(--gx-ink,#1b1936)" stroke-width="4.4" stroke-linecap="round"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" stroke="var(--gx-ink,#1b1936)" stroke-width="1.8"/><circle cx="12" cy="7.6" r="1.7" fill="var(--gx-ink,#1b1936)"/><path d="M12 11v6.2" stroke="var(--gx-ink,#1b1936)" stroke-width="2.6" stroke-linecap="round"/></svg>',
} as const;

interface Slot {
  key: string;
  slot: HTMLDivElement;
  token: HTMLButtonElement;
  iconEl: HTMLSpanElement;
  plateEl: HTMLSpanElement;
  x: number;
  y: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent?.appendChild(node);
  return node;
}

/**
 * Touch build / tower menu: a ring of faceted tokens around the tapped tile or tower. Pure UI —
 * every game change goes through GameSession; ring math lives in radialLayout.ts.
 */
export class RadialMenu {
  private readonly session: GameSession;
  private readonly renderWorld: RenderWorld;
  private readonly rootEl: HTMLDivElement;
  private readonly ringEl: HTMLDivElement;
  private readonly infoEl: HTMLDivElement;
  private readonly infoBodyEl: HTMLDivElement;
  private slots: Slot[] = [];

  private mode: Mode = 'closed';
  private col = 0;
  private row = 0;
  private towerId = -1;
  private previewType: TowerType = TOWER_TYPES[0];
  private lastBuilt: TowerType | null = null;
  private safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private lastSig = '';
  private lastLayoutSig = '';
  /** Taps that opened the ring are followed by a synthetic click under the finger; ignore it. */
  private openedAt = 0;
  private infoSize = { w: 250, h: 150 };
  private readonly scratch = { x: 0, y: 0 };
  private readonly onResize = (): void => {
    this.safe = readSafeArea();
    this.lastLayoutSig = '';
  };

  constructor(parent: HTMLElement, session: GameSession, renderWorld: RenderWorld) {
    this.session = session;
    this.renderWorld = renderWorld;

    this.rootEl = el('div', 'radial-root hidden', parent);
    this.rootEl.setAttribute('data-testid', 'radial-menu');
    this.ringEl = el('div', 'radial-ring', this.rootEl);

    this.infoEl = el('div', 'radial-info hidden ui-interactive', this.rootEl);
    this.infoEl.setAttribute('data-testid', 'radial-info');
    this.infoBodyEl = el('div', 'radial-info-body', this.infoEl);
    const closeBtn = el('button', 'radial-info-close', this.infoEl);
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close info');
    closeBtn.innerHTML =
      '<span class="radial-face"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg></span>';
    closeBtn.addEventListener('click', () => this.setMode('tower'));

    this.safe = readSafeArea();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
  }

  isOpen(): boolean {
    return this.mode !== 'closed';
  }

  openedFor(): RadialTarget | null {
    if (this.mode === 'closed') return null;
    if (this.mode === 'build') return { kind: 'build', col: this.col, row: this.row };
    return { kind: 'tower', id: this.towerId };
  }

  openBuild(col: number, row: number): void {
    if (this.mode === 'tower' || this.mode === 'info') this.session.selectTower(null);
    this.col = col;
    this.row = row;
    this.towerId = -1;
    const gold = this.session.simWorld.gold;
    const affordable = (t: TowerType): boolean => gold >= TOWER_DEFS[t].tiers[0].upgradeCost;
    this.previewType =
      this.lastBuilt && affordable(this.lastBuilt)
        ? this.lastBuilt
        : (TOWER_TYPES.find(affordable) ?? TOWER_TYPES[0]);
    this.setMode('build');
    this.syncPreview();
  }

  openTower(towerId: number): void {
    this.session.setRadialPlacementPreview(null);
    this.towerId = towerId;
    this.session.selectTower(towerId);
    this.setMode('tower');
  }

  /** Long-press entry: the tower ring opens directly on its info card. */
  openTowerInfo(towerId: number): void {
    this.openTower(towerId);
    this.setMode('info');
  }

  /** Closes the menu. `deselect` also clears the tower selection when a tower ring was open. */
  close(deselect = true): void {
    if (this.mode === 'closed') return;
    const wasTower = this.mode === 'tower' || this.mode === 'info';
    const id = this.towerId;
    this.mode = 'closed';
    this.rootEl.classList.add('hidden');
    this.rootEl.removeAttribute('data-kind');
    this.ringEl.replaceChildren();
    this.slots = [];
    this.lastSig = '';
    this.lastLayoutSig = '';
    this.session.setRadialPlacementPreview(null);
    if (wasTower) this.renderWorld.setXrayTarget(null);
    if (wasTower && deselect && this.session.getSelectedTowerId() === id) {
      this.session.selectTower(null);
    }
  }

  /** A one-finger camera pan started: a build ring is cancelled, a tower ring follows its tower. */
  onUserPan(): void {
    if (this.mode === 'build') this.close();
  }

  private setMode(mode: Mode): void {
    const prev = this.mode;
    this.mode = mode;
    this.rootEl.classList.remove('hidden');
    this.rootEl.setAttribute('data-kind', mode);
    this.rootEl.dataset.col = String(this.col);
    this.rootEl.dataset.row = String(this.row);
    this.rootEl.dataset.towerId = String(this.towerId);
    this.infoEl.classList.toggle('hidden', mode !== 'info');
    this.ringEl.classList.toggle('hidden', mode === 'info');
    if (mode !== prev || mode === 'build') {
      if (mode === 'build' || mode === 'tower') {
        this.buildSlots();
        this.openedAt = performance.now();
      }
    }
    this.lastSig = '';
    this.lastLayoutSig = '';
    this.update();
  }

  private buildSlots(): void {
    this.ringEl.replaceChildren();
    this.slots = [];
    // Restart the pop animation.
    this.ringEl.classList.remove('is-open');
    void this.ringEl.offsetWidth;
    this.ringEl.classList.add('is-open');

    if (this.mode === 'build') {
      for (const type of TOWER_TYPES) {
        const def = TOWER_DEFS[type];
        const s = this.makeSlot(`build:${type}`, 'radial-token is-tower');
        s.token.setAttribute('aria-label', `${def.name}, ${def.tiers[0].upgradeCost} gold`);
        s.token.dataset.tower = type;
        s.iconEl.innerHTML = TOWER_ICON_SVGS[type];
        s.token.addEventListener('pointerdown', () => {
          if (!this.tooSoon()) this.setPreview(type);
        });
        s.token.addEventListener('pointerenter', (e) => {
          if (e.pointerType === 'mouse') this.setPreview(type);
        });
        s.token.addEventListener('click', () => this.onBuildClick(type, s.token));
      }
    } else if (this.mode === 'tower') {
      const defs: Array<{ key: string; cls: string; label: string; run: () => void }> = [
        { key: 'upgrade', cls: 'is-gold', label: 'Upgrade', run: () => this.onUpgrade() },
        { key: 'sell', cls: 'is-coral', label: 'Sell', run: () => this.onSell() },
        { key: 'target', cls: 'is-sky', label: 'Target', run: () => this.onTarget() },
        { key: 'info', cls: 'is-slate', label: 'Info', run: () => this.onInfo() },
      ];
      for (const d of defs) {
        const s = this.makeSlot(`act:${d.key}`, `radial-token is-action ${d.cls}`);
        s.token.setAttribute('aria-label', d.label);
        s.token.dataset.action = d.key;
        s.iconEl.innerHTML = ACTION_ICONS[d.key as keyof typeof ACTION_ICONS];
        s.token.addEventListener('click', d.run);
      }
    }
  }

  private makeSlot(key: string, tokenClass: string): Slot {
    const slot = el('div', 'radial-slot', this.ringEl);
    const token = el('button', `${tokenClass} ui-interactive`, slot);
    token.type = 'button';
    const face = el('span', 'radial-face', token);
    const iconEl = el('span', 'radial-icon', face);
    const plateEl = el('span', 'radial-plate', slot);
    const s: Slot = { key, slot, token, iconEl, plateEl, x: NaN, y: NaN };
    this.slots.push(s);
    return s;
  }

  // ---- actions -----------------------------------------------------------------------------

  private setPreview(type: TowerType): void {
    if (this.mode !== 'build') return;
    this.previewType = type;
    this.syncPreview();
    this.lastSig = '';
  }

  private syncPreview(): void {
    this.session.setRadialPlacementPreview({ type: this.previewType, col: this.col, row: this.row });
  }

  private tooSoon(): boolean {
    return performance.now() - this.openedAt < CLICK_GUARD_MS;
  }

  private onBuildClick(type: TowerType, token: HTMLElement): void {
    if (this.tooSoon()) return;
    const cost = TOWER_DEFS[type].tiers[0].upgradeCost;
    if (this.session.simWorld.gold < cost) {
      this.shake(token);
      return;
    }
    if (this.session.buildTowerAt(this.col, this.row, type)) {
      this.lastBuilt = type;
      this.close();
    } else {
      this.shake(token);
    }
  }

  private onUpgrade(): void {
    if (this.tooSoon()) return;
    const tower = this.session.simWorld.getTowerById(this.towerId);
    if (!tower || tower.tier >= 3) return;
    const next = getTowerTierStats(tower.type, (tower.tier + 1) as 2 | 3);
    const btn = this.slots.find((s) => s.key === 'act:upgrade')?.token;
    if (this.session.simWorld.gold < next.upgradeCost) {
      if (btn) this.shake(btn);
      return;
    }
    this.session.upgradeTower(tower.id);
  }

  private onSell(): void {
    if (this.tooSoon()) return;
    // First tap arms (3.5s window), second tap confirms: same logic as the Delete hotkey.
    this.session.onTowerActionHotkey('sell');
    this.lastSig = '';
  }

  private onInfo(): void {
    if (this.tooSoon()) return;
    this.setMode('info');
  }

  private onTarget(): void {
    if (this.tooSoon()) return;
    this.session.onTowerActionHotkey('target');
    this.lastSig = '';
  }

  private shake(node: HTMLElement): void {
    node.classList.remove('is-shake');
    void node.offsetWidth;
    node.classList.add('is-shake');
  }

  // ---- per-frame ---------------------------------------------------------------------------

  update(): void {
    if (this.mode === 'closed') return;
    const sim = this.session.simWorld;
    if (sim.outcome !== 'ongoing') {
      this.close();
      return;
    }

    let wx: number;
    let wy: number;
    let wz: number;
    let tower = null as ReturnType<typeof sim.getTowerById> | null;
    if (this.mode === 'build') {
      wx = sim.grid.gridToWorldX(this.col);
      wz = sim.grid.gridToWorldZ(this.row);
      wy = 0.35;
      if (!sim.grid.canPlaceTower(this.col, this.row)) {
        this.close();
        return;
      }
    } else {
      tower = sim.getTowerById(this.towerId);
      if (!tower) {
        this.close();
        return;
      }
      wx = tower.x;
      wz = tower.z;
      wy = getTowerPickHeight(tower.type, tower.tier) * 0.52;
      // Keep the selected tower readable: whatever is drawn in front of it fades.
      this.renderWorld.setXrayTarget({
        x: tower.x,
        z: tower.z,
        height: getTowerPickHeight(tower.type, tower.tier),
        excludeTowerId: tower.id,
      });
    }

    this.syncState(tower);

    const cam = this.renderWorld.cameraController;
    cam.worldCoordsToScreen(wx, wy, wz, this.scratch);
    const ax = this.scratch.x;
    const ay = this.scratch.y;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bounds = ringBounds({ width: vw, height: vh, safe: this.safe }, 6, this.coachBottom());

    if (this.mode === 'info') {
      this.positionInfo(ax, ay, bounds);
      return;
    }

    const sig = `${Math.round(ax * 2)}|${Math.round(ay * 2)}|${vw}|${vh}|${this.slots.length}|${Math.round(bounds.top)}`;
    if (sig === this.lastLayoutSig) return;
    this.lastLayoutSig = sig;

    // Larger zoom (tablets) => bigger tiles on screen => push the ring out a little.
    const tilePx = (vh / 2 / 13.5) * cam.camera.zoom * 2;
    const radius = Math.min(112, Math.max(BASE_RADIUS, tilePx * 0.55 + 46));
    const layout = layoutRing({
      cx: ax,
      cy: ay,
      count: this.slots.length,
      radius,
      footprint: FOOTPRINT,
      bounds,
    });
    this.rootEl.dataset.span = String(layout.span);
    for (let i = 0; i < this.slots.length; i++) {
      this.placeSlot(this.slots[i], layout.positions[i], ax, ay);
    }
  }

  /** Bottom edge of the first-run coach card when it is showing (0 otherwise); the ring stays below it. */
  private coachBottom(): number {
    const card = this.rootEl.parentElement?.querySelector<HTMLElement>('.onb-coach:not(.hidden)');
    return card ? card.getBoundingClientRect().bottom : 0;
  }

  private placeSlot(s: Slot, p: Point, ax: number, ay: number): void {
    const x = Math.round(p.x - TOKEN_SIZE / 2);
    const y = Math.round(p.y - TOKEN_SIZE / 2);
    if (x === s.x && y === s.y) return;
    s.x = x;
    s.y = y;
    s.slot.style.transform = `translate(${x}px, ${y}px)`;
    // Pop outwards from the anchor.
    s.slot.style.setProperty('--pop-x', `${Math.round(ax - p.x)}px`);
    s.slot.style.setProperty('--pop-y', `${Math.round(ay - p.y)}px`);
  }

  private positionInfo(ax: number, ay: number, bounds: ReturnType<typeof ringBounds>): void {
    const w = this.infoEl.offsetWidth || this.infoSize.w;
    const h = this.infoEl.offsetHeight || this.infoSize.h;
    this.infoSize = { w, h };
    const mid = (bounds.top + bounds.bottom) / 2;
    const above = ay > mid;
    const p = placeBox(ax, ay, w, h, bounds, 0, above ? -(h / 2 + 46) : h / 2 + 46);
    this.infoEl.style.transform = `translate(${Math.round(p.x - w / 2)}px, ${Math.round(p.y - h / 2)}px)`;
  }

  private syncState(tower: ReturnType<GameSession['simWorld']['getTowerById']> | null): void {
    const sim = this.session.simWorld;
    const gold = sim.gold;
    const armed = tower ? this.session.isSellArmedFor(tower.id) : false;
    const sig =
      this.mode === 'build'
        ? `b|${gold}|${this.previewType}`
        : `t|${gold}|${tower?.id}|${tower?.tier}|${tower?.targetingMode}|${armed ? 1 : 0}|${
            this.mode === 'info' ? `${tower?.kills}|${Math.floor(tower?.totalDamageDealt ?? 0)}` : ''
          }`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    if (this.mode === 'build') {
      for (const s of this.slots) {
        const type = s.token.dataset.tower as TowerType;
        const cost = TOWER_DEFS[type].tiers[0].upgradeCost;
        const poor = gold < cost;
        s.token.classList.toggle('is-poor', poor);
        s.token.setAttribute('aria-disabled', poor ? 'true' : 'false');
        s.token.classList.toggle('is-focus', type === this.previewType);
        s.plateEl.classList.toggle('is-poor', poor);
        s.plateEl.innerHTML = `${UI_ICON_SVGS.coin}<b>${cost}</b>`;
      }
      return;
    }
    if (!tower) return;

    const next = tower.tier < 3 ? getTowerTierStats(tower.type, (tower.tier + 1) as 2 | 3) : null;
    for (const s of this.slots) {
      const action = s.token.dataset.action;
      if (action === 'upgrade') {
        const poor = next === null || gold < next.upgradeCost;
        s.token.classList.toggle('is-poor', poor);
        s.token.classList.toggle('is-max', next === null);
        s.token.setAttribute('aria-disabled', poor ? 'true' : 'false');
        s.plateEl.classList.toggle('is-poor', next !== null && poor);
        s.plateEl.innerHTML = next
          ? `${UI_ICON_SVGS.coin}<b>${next.upgradeCost}</b>`
          : '<b class="is-max">MAX</b>';
      } else if (action === 'sell') {
        s.token.classList.toggle('is-armed', armed);
        s.iconEl.innerHTML = armed ? ACTION_ICONS.confirm : ACTION_ICONS.sell;
        const refund = computeSellRefund(tower.totalInvested);
        s.plateEl.innerHTML = armed ? '<b>Sell?</b>' : `<b class="plus">+${refund}</b>`;
        s.token.setAttribute('aria-label', armed ? 'Confirm sell' : `Sell for ${refund} gold`);
      } else if (action === 'target') {
        s.plateEl.innerHTML = `<b>${TARGET_LABELS[tower.targetingMode]}</b>`;
      } else if (action === 'info') {
        s.plateEl.innerHTML = '<b>Info</b>';
      }
    }
    if (this.mode === 'info') this.renderInfo(tower);
  }

  private renderInfo(tower: NonNullable<ReturnType<GameSession['simWorld']['getTowerById']>>): void {
    const def = TOWER_DEFS[tower.type];
    const st = getTowerTierStats(tower.type, tower.tier);
    const chips: Array<[string, string]> = [
      [String(st.damage), 'DMG'],
      [st.fireRate.toFixed(2), '/s'],
      [st.range.toFixed(1), 'RNG'],
    ];
    if (st.splashRadius > 0) chips.push([`${st.splashRadius.toFixed(1)}m`, 'AoE']);
    else if (st.slowRatio > 0) chips.push([`${Math.round(st.slowRatio * 100)}%`, 'Slow']);
    else if (st.chainCount > 1) chips.push([`${st.chainCount}x`, 'Chain']);
    const dmg = Math.floor(tower.totalDamageDealt);
    const dmgLabel = dmg >= 1000 ? `${(dmg / 1000).toFixed(1)}k` : String(dmg);
    this.infoBodyEl.innerHTML = `
      <div class="radial-info-head">
        <span class="radial-info-icon">${TOWER_ICON_SVGS[tower.type]}</span>
        <span class="radial-info-titles">
          <b class="radial-info-name">${def.name}</b>
          <span class="radial-info-sub">${TIER_LABELS[tower.tier - 1]} · ${def.hitsFlyers ? 'Air + Ground' : 'Ground'}</span>
        </span>
      </div>
      <div class="radial-info-stats">${chips
        .map(([v, u]) => `<span><b>${v}</b><i>${u}</i></span>`)
        .join('')}</div>
      <div class="radial-info-foot">
        <span><i>Kills</i><b>${tower.kills}</b></span>
        <span><i>Dealt</i><b>${dmgLabel}</b></span>
        <span><i>Target</i><b>${TARGET_LABELS[tower.targetingMode]}</b></span>
      </div>`;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    this.rootEl.remove();
  }
}
