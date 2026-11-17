import { ENEMY_DEFS } from '../data/enemies.ts';
import { TOWER_DEFS } from '../data/towers.ts';
import type { EnemyEntity, TowerEntity } from '../sim/entities.ts';

export class EnemyTooltip {
  private readonly el: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly hpEl: HTMLSpanElement;
  private readonly armorEl: HTMLSpanElement;
  private readonly statusEl: HTMLSpanElement;
  private visible = false;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'enemy-tooltip gx gx-slate hidden';

    this.nameEl = document.createElement('div');
    this.nameEl.className = 'enemy-tooltip-name';

    const statsRow = document.createElement('div');
    statsRow.className = 'enemy-tooltip-stats';

    this.hpEl = document.createElement('span');
    this.armorEl = document.createElement('span');
    this.statusEl = document.createElement('span');
    this.statusEl.className = 'enemy-tooltip-slow';

    statsRow.append(this.hpEl, this.armorEl, this.statusEl);
    this.el.append(this.nameEl, statsRow);
    root.appendChild(this.el);
  }

  show(enemy: EnemyEntity, clientX: number, clientY: number): void {
    const def = ENEMY_DEFS[enemy.type];
    this.nameEl.textContent = enemy.elite ? `Empowered ${def.name}` : def.name;
    this.hpEl.textContent =
      `HP ${Math.ceil(enemy.hp)}/${enemy.maxHp}` +
      (enemy.shield > 0 ? ` · Shield ${Math.ceil(enemy.shield)}` : '');
    this.armorEl.textContent =
      enemy.armor > 0
        ? ` · Armor ${enemy.armor}${enemy.armorBreakTimer > 0 ? ' (cracked)' : ''}`
        : '';
    this.statusEl.textContent =
      enemy.slowTimer > 0 ? ` · Slowed ${Math.round(enemy.slowRatio * 100)}%` : '';

    const offsetX = 14;
    const offsetY = -14;
    const left = Math.min(window.innerWidth - 190, clientX + offsetX);
    const top = Math.max(12, clientY + offsetY);

    this.el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    if (!this.visible) {
      this.el.classList.remove('hidden');
      this.visible = true;
    }
  }

  showTower(tower: TowerEntity, clientX: number, clientY: number): void {
    const def = TOWER_DEFS[tower.type];
    const hint = tower.tier < 3 ? (document.documentElement.classList.contains('is-touch') ? 'Tap to upgrade' : 'Click to upgrade') : 'Max tier';
    this.nameEl.textContent = `${def.name} T${tower.tier} · ${hint}`;
    this.hpEl.textContent = '';
    this.armorEl.textContent = '';
    this.statusEl.textContent = '';

    const offsetX = 14;
    const offsetY = -14;
    const left = Math.min(window.innerWidth - 260, clientX + offsetX);
    const top = Math.max(12, clientY + offsetY);

    this.el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    if (!this.visible) {
      this.el.classList.remove('hidden');
      this.visible = true;
    }
  }

  hide(): void {
    if (!this.visible) return;
    this.el.classList.add('hidden');
    this.visible = false;
  }

  dispose(): void {
    this.el.remove();
  }
}
