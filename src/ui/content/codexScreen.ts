import '../styles/codex.css';
import { ENEMY_ICON_SVGS, TOWER_ICON_SVGS, UI_ICON_SVGS } from '../icons.ts';
import {
  allEnemyEntries,
  allTowerEntries,
  eliteEntry,
  type CodexEliteEntry,
  type CodexEnemyEntry,
  type CodexStat,
  type CodexTowerEntry,
} from './codexData.ts';

export type CodexTab = 'enemies' | 'towers';

export interface CodexCallbacks {
  isSeen: (seenId: string) => boolean;
  onClose: () => void;
}

type EnemyLikeEntry = CodexEnemyEntry | CodexEliteEntry;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function statChips(stats: readonly CodexStat[]): HTMLDivElement {
  const row = h('div', 'cx-stats');
  for (const s of stats) {
    const chip = h('div', 'cx-stat');
    chip.append(h('span', 'cx-stat-label', s.label), h('span', 'cx-stat-val', s.value));
    row.appendChild(chip);
  }
  return row;
}

function tagRow(tags: readonly string[]): HTMLDivElement {
  const row = h('div', 'cx-tags');
  for (const t of tags) row.appendChild(h('span', 'cx-tag', t));
  return row;
}

function tipPanel(label: string, text: string, tone: 'good' | 'warn' = 'good'): HTMLDivElement {
  const p = h('div', `cx-tip cx-tip-${tone}`);
  p.append(h('span', 'cx-tip-label', label), h('span', 'cx-tip-text', text));
  return p;
}

/** Bestiary + tower reference. Unseen enemies are silhouettes until they appear in a run. */
export class CodexScreen {
  private readonly rootEl: HTMLDivElement;
  private readonly tabBtns = new Map<CodexTab, HTMLButtonElement>();
  private readonly countEl: HTMLSpanElement;
  private readonly gridEl: HTMLDivElement;
  private readonly detailEl: HTMLDivElement;
  private readonly detailBodyEl: HTMLDivElement;
  private readonly cb: CodexCallbacks;
  private tab: CodexTab = 'enemies';
  private selectedId = '';
  private openState = false;
  private readonly keyHandler = (e: KeyboardEvent): void => {
    if (!this.openState || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'keydown') this.handleBack();
  };

  constructor(parent: HTMLElement, cb: CodexCallbacks) {
    this.cb = cb;
    this.rootEl = h('div', 'cx-root hidden ui-interactive');
    this.rootEl.setAttribute('data-testid', 'codex');

    const card = h('div', 'cx-card gx gx-slate');

    const header = h('div', 'cx-header');
    const backBtn = h('button', 'cx-back gx gx-slate-btn');
    backBtn.type = 'button';
    backBtn.setAttribute('aria-label', 'Close codex');
    backBtn.setAttribute('data-testid', 'codex-close');
    backBtn.innerHTML = UI_ICON_SVGS.close;
    backBtn.addEventListener('click', () => this.close());
    const title = h('h2', 'cx-title', 'Codex');
    this.countEl = h('span', 'cx-count');
    header.append(backBtn, title, this.countEl);

    const tabs = h('div', 'cx-tabs');
    for (const [id, label] of [
      ['enemies', 'Foes'],
      ['towers', 'Towers'],
    ] as const) {
      const b = h('button', 'cx-tab gx gx-slate-btn', label);
      b.type = 'button';
      b.setAttribute('data-testid', `codex-tab-${id}`);
      b.addEventListener('click', () => this.setTab(id));
      this.tabBtns.set(id, b);
      tabs.appendChild(b);
    }

    const body = h('div', 'cx-body');
    this.gridEl = h('div', 'cx-grid');
    this.detailEl = h('div', 'cx-detail');
    const detailBack = h('button', 'cx-detail-back gx gx-slate-btn', '‹ All');
    detailBack.type = 'button';
    detailBack.addEventListener('click', () => this.showGridView());
    this.detailBodyEl = h('div', 'cx-detail-body');
    this.detailEl.append(detailBack, this.detailBodyEl);
    body.append(this.gridEl, this.detailEl);

    card.append(header, tabs, body);
    this.rootEl.appendChild(card);
    this.rootEl.addEventListener('click', (e) => {
      if (e.target === this.rootEl) this.close();
    });
    parent.appendChild(this.rootEl);
    window.addEventListener('keydown', this.keyHandler, true);
    window.addEventListener('keyup', this.keyHandler, true);
  }

  isOpen(): boolean {
    return this.openState;
  }

  open(tab: CodexTab = 'enemies', id?: string): void {
    this.openState = true;
    this.rootEl.classList.remove('hidden');
    this.tab = tab;
    this.selectedId = id ?? this.defaultId(tab);
    this.rebuild();
    // Phones: jump straight to the detail view when a specific entry was asked for.
    this.rootEl.dataset.view = id ? 'detail' : 'grid';
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.rootEl.classList.add('hidden');
    this.cb.onClose();
  }

  private handleBack(): void {
    if (this.rootEl.dataset.view === 'detail' && this.isNarrow()) {
      this.showGridView();
      return;
    }
    this.close();
  }

  private isNarrow(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 719px)').matches;
  }

  private showGridView(): void {
    this.rootEl.dataset.view = 'grid';
  }

  private defaultId(tab: CodexTab): string {
    return tab === 'enemies' ? allEnemyEntries()[0].id : allTowerEntries()[0].id;
  }

  private setTab(tab: CodexTab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.selectedId = this.defaultId(tab);
    this.rebuild();
    this.rootEl.dataset.view = 'grid';
  }

  private enemyEntries(): EnemyLikeEntry[] {
    return [...allEnemyEntries(), eliteEntry()];
  }

  private rebuild(): void {
    for (const [id, b] of this.tabBtns) b.classList.toggle('active', id === this.tab);
    const enemies = this.enemyEntries();
    const seen = enemies.filter((e) => this.cb.isSeen(e.seenId)).length;
    this.countEl.textContent = this.tab === 'enemies' ? `${seen}/${enemies.length} met` : `${allTowerEntries().length} towers`;

    this.gridEl.replaceChildren();
    if (this.tab === 'enemies') {
      for (const e of enemies) this.gridEl.appendChild(this.enemyTile(e));
    } else {
      for (const t of allTowerEntries()) this.gridEl.appendChild(this.towerTile(t));
    }
    this.renderDetail();
  }

  private tile(id: string, iconSvg: string, label: string, locked: boolean, boss = false): HTMLButtonElement {
    const b = h('button', `cx-tile gx gx-slate-btn${id === this.selectedId ? ' active' : ''}${locked ? ' is-locked' : ''}${boss ? ' is-boss' : ''}`);
    b.type = 'button';
    b.dataset.id = id;
    b.setAttribute('data-testid', `codex-tile-${id}`);
    const icon = h('span', 'cx-tile-icon');
    icon.innerHTML = iconSvg;
    b.append(icon, h('span', 'cx-tile-name', label));
    b.addEventListener('click', () => {
      this.selectedId = id;
      for (const el of Array.from(this.gridEl.children)) {
        el.classList.toggle('active', (el as HTMLElement).dataset.id === id);
      }
      this.renderDetail();
      this.rootEl.dataset.view = 'detail';
    });
    return b;
  }

  private enemyTile(e: EnemyLikeEntry): HTMLButtonElement {
    const seen = this.cb.isSeen(e.seenId);
    const icon = e.kind === 'enemy' ? ENEMY_ICON_SVGS[e.id] : UI_ICON_SVGS.star;
    return this.tile(e.id, icon, seen ? e.name.replace('Empowered ', '') : '???', !seen, e.kind === 'enemy' && e.isBoss);
  }

  private towerTile(t: CodexTowerEntry): HTMLButtonElement {
    return this.tile(t.id, TOWER_ICON_SVGS[t.id], t.name.split(' ')[0], false);
  }

  private renderDetail(): void {
    const body = this.detailBodyEl;
    body.replaceChildren();
    if (this.tab === 'enemies') {
      const e = this.enemyEntries().find((x) => x.id === this.selectedId);
      if (e) this.renderEnemyDetail(body, e);
    } else {
      const t = allTowerEntries().find((x) => x.id === this.selectedId);
      if (t) this.renderTowerDetail(body, t);
    }
    this.detailEl.scrollTop = 0;
  }

  private head(iconSvg: string, name: string, kicker: string, locked: boolean): HTMLDivElement {
    const head = h('div', 'cx-d-head');
    const icon = h('div', `cx-d-icon${locked ? ' is-locked' : ''}`);
    icon.innerHTML = iconSvg;
    const titles = h('div', 'cx-d-titles');
    titles.append(h('div', 'cx-d-kicker', kicker), h('div', 'cx-d-name', name));
    head.append(icon, titles);
    return head;
  }

  private renderEnemyDetail(body: HTMLElement, e: EnemyLikeEntry): void {
    const seen = this.cb.isSeen(e.seenId);
    const icon = e.kind === 'enemy' ? ENEMY_ICON_SVGS[e.id] : UI_ICON_SVGS.star;
    if (!seen) {
      body.append(
        this.head(icon, 'Unknown foe', 'Not yet met', true),
        h('p', 'cx-desc', 'You have not run into this one yet. Reach later islands to learn what it does and how to stop it.'),
      );
      return;
    }
    const kicker = e.kind === 'elite' ? 'Variant' : e.isBoss ? 'Boss' : e.flying ? 'Flyer' : 'Foe';
    body.append(
      this.head(icon, e.name, kicker, false),
      tagRow(e.tags),
      h('p', 'cx-desc', e.description),
      statChips(e.stats),
      tipPanel('How to stop it', e.counter),
    );
  }

  private renderTowerDetail(body: HTMLElement, t: CodexTowerEntry): void {
    body.append(
      this.head(TOWER_ICON_SVGS[t.id], t.name, 'Tower', false),
      tagRow(t.tags),
      h('p', 'cx-desc', t.description),
      statChips(t.stats),
      tipPanel('Strong at', t.strong),
      tipPanel('Watch out', t.weak, 'warn'),
    );
    const tiers = h('div', 'cx-tiers');
    for (const tier of t.tiers) {
      const row = h('div', 'cx-tier');
      row.append(
        h('span', 'cx-tier-num', ['I', 'II', 'III'][tier.tier - 1]),
        h('span', 'cx-tier-sum', tier.summary),
        h('span', 'cx-tier-cost', `${tier.cost}g`),
      );
      tiers.appendChild(row);
    }
    const sig = h('div', 'cx-sig');
    sig.append(
      h('span', 'cx-sig-label', `Tier III signature — ${t.signatureName}`),
      h('span', 'cx-sig-text', t.signatureDesc),
    );
    body.append(tiers, sig);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keyHandler, true);
    window.removeEventListener('keyup', this.keyHandler, true);
    this.rootEl.remove();
  }
}
