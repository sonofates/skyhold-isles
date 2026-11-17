import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSettings, ProgressData, TowerType } from '../../src/core/types.ts';
import { ABILITY_DEFS } from '../../src/data/abilities.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { getTowerTierStats, TOWER_DEFS, TOWER_TYPES } from '../../src/data/towers.ts';
import type { EnemyEntity, TowerEntity } from '../../src/sim/entities.ts';
import { computeSellRefund } from '../../src/sim/world.ts';
import { AbilityBar } from '../../src/ui/abilityBar.ts';
import { BuildBar } from '../../src/ui/buildBar.ts';
import { OutcomeOverlay, PauseMenuModal } from '../../src/ui/gameModals.ts';
import { GameOverlays } from '../../src/ui/gameOverlays.ts';
import { HudBar, type HudStateView } from '../../src/ui/hud.ts';
import { UI_ICON_SVGS } from '../../src/ui/icons.ts';
import { LoadingScreen } from '../../src/ui/loadingScreen.ts';
import { LevelSelectOverlay, MainMenuOverlay, renderStarsHtml } from '../../src/ui/menus.ts';
import { SettingsModal } from '../../src/ui/settingsModal.ts';
import { GameToast } from '../../src/ui/toast.ts';
import { EnemyTooltip } from '../../src/ui/tooltip.ts';
import { TowerPanel } from '../../src/ui/towerPanel.ts';

class FakeClassList {
  private readonly tokens = new Set<string>();

  sync(name: string): void {
    this.tokens.clear();
    for (const part of name.split(/\s+/)) {
      if (part) this.tokens.add(part);
    }
  }

  add(...items: string[]): void {
    for (const t of items) this.tokens.add(t);
  }

  remove(...items: string[]): void {
    for (const t of items) this.tokens.delete(t);
  }

  toggle(token: string, force?: boolean): boolean {
    if (force === undefined) {
      if (this.tokens.has(token)) {
        this.tokens.delete(token);
        return false;
      }
      this.tokens.add(token);
      return true;
    }
    if (force) this.tokens.add(token);
    else this.tokens.delete(token);
    return force;
  }

  contains(token: string): boolean {
    return this.tokens.has(token);
  }
}

interface FakeStyleMap {
  [key: string]: unknown;
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
  getPropertyValue(name: string): string;
}

function createFakeStyle(): FakeStyleMap {
  const store = new Map<string, string>();
  const api: FakeStyleMap = {
    setProperty(name: string, value: string): void {
      store.set(name, String(value));
    },
    removeProperty(name: string): void {
      store.delete(name);
    },
    getPropertyValue(name: string): string {
      return store.get(name) ?? '';
    },
  };
  return new Proxy(api, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) {
        return target[prop];
      }
      if (typeof prop === 'string') {
        return store.get(prop) ?? '';
      }
      return undefined;
    },
    set(target, prop, value) {
      if (typeof prop === 'string' && prop !== 'setProperty' && prop !== 'removeProperty' && prop !== 'getPropertyValue') {
        store.set(prop, String(value));
        return true;
      }
      void target;
      return false;
    },
  });
}

function parseSimpleHtmlInto(parent: FakeElement, html: string): void {
  const stack: FakeElement[] = [parent];
  const tokenRe = /<\/?([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(html)) !== null) {
    if (match[3] !== undefined) {
      const top = stack[stack.length - 1];
      top._appendParsedText(match[3]);
      continue;
    }
    const full = match[0];
    const tag = match[1].toLowerCase();
    const attrStr = match[2] ?? '';
    const isClose = full.startsWith('</');
    if (isClose) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = new FakeElement(tag);
    const attrRe = /([a-zA-Z0-9:-]+)\s*=\s*"([^"]*)"/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrStr)) !== null) {
      const [, name, val] = am;
      if (name === 'class') el.className = val;
      else if (name === 'id') el.id = val;
      else el.setAttribute(name, val);
    }
    stack[stack.length - 1].appendChild(el);
    if (!attrStr.trimEnd().endsWith('/')) {
      stack.push(el);
    }
  }
}

class FakeElement {
  readonly tagName: string;
  id = '';
  type = '';
  min = '';
  max = '';
  value = '';
  checked = false;
  disabled = false;
  hidden = false;
  title = '';
  offsetWidth = 0;
  offsetHeight = 0;
  focused = false;
  dataset: Record<string, string> = {};
  readonly style: FakeStyleMap = createFakeStyle();
  readonly classList = new FakeClassList();
  readonly attrs = new Map<string, string>();
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  private _className = '';
  private _textContent = '';
  private _innerHTML = '';
  private readonly listeners = new Map<string, Array<(ev: { target: unknown }) => void>>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get className(): string {
    return this._className;
  }

  set className(val: string) {
    this._className = val;
    this.classList.sync(val);
  }

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    let out = this._textContent;
    for (const child of this.children) {
      out += child.textContent;
    }
    return out;
  }

  set textContent(val: string | null) {
    this._textContent = val ?? '';
    this.children.forEach((c) => {
      c.parentElement = null;
    });
    this.children = [];
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(html: string) {
    this._innerHTML = html;
    this.children.forEach((c) => {
      c.parentElement = null;
    });
    this.children = [];
    this._textContent = '';
    if (html) {
      parseSimpleHtmlInto(this, html);
    }
  }

  _appendParsedText(text: string): void {
    this._textContent += text;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: Array<FakeElement | string>): void {
    for (const node of nodes) {
      if (typeof node === 'string') {
        this._textContent += node;
      } else {
        this.appendChild(node);
      }
    }
  }

  replaceChildren(...nodes: Array<FakeElement | string>): void {
    for (const child of this.children) {
      child.parentElement = null;
    }
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }

  remove(): void {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx !== -1) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
  }

  focus(): void {
    this.focused = true;
  }

  addEventListener(type: string, cb: (ev: { target: unknown }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  dispatch(type: string, target: unknown = this): void {
    for (const cb of this.listeners.get(type) ?? []) {
      cb({ target });
    }
  }

  click(target: unknown = this): void {
    this.dispatch('click', target);
  }

  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      return this.findAll((el) => el.classList.contains(cls))[0] ?? null;
    }
    return null;
  }

  findAll(pred: (el: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    const visit = (node: FakeElement): void => {
      if (pred(node)) out.push(node);
      for (const child of node.children) visit(child);
    };
    visit(this);
    return out;
  }

  findByClass(cls: string): FakeElement[] {
    return this.findAll((el) => el.classList.contains(cls));
  }

  findByTestId(testId: string): FakeElement | undefined {
    return this.findAll((el) => el.getAttribute('data-testid') === testId)[0];
  }
}

function installFakeDom() {
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const findById = (node: FakeElement, id: string): FakeElement | null => {
    if (node.id === id) return node;
    for (const child of node.children) {
      const hit = findById(child, id);
      if (hit) return hit;
    }
    return null;
  };
  const doc = {
    head,
    body,
    createElement: (tag: string) => new FakeElement(tag),
    getElementById: (id: string) => findById(head, id) ?? findById(body, id),
  };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const reloadSpy = vi.fn();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', {
    innerWidth: 1280,
    innerHeight: 720,
    location: { reload: reloadSpy },
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length;
    },
  });
  return { head, body, timers, reloadSpy };
}

function makeTower(
  id: number,
  type: TowerType,
  tier: 1 | 2 | 3,
  overrides: Partial<TowerEntity> = {},
): TowerEntity {
  let invested = getTowerTierStats(type, 1).upgradeCost;
  if (tier >= 2) invested += getTowerTierStats(type, 2).upgradeCost;
  if (tier >= 3) invested += getTowerTierStats(type, 3).upgradeCost;
  return {
    id,
    col: 2,
    row: 3,
    x: 0,
    z: 0,
    type,
    tier,
    totalInvested: invested,
    targetingMode: 'first',
    cooldownTimer: 0,
    stunTimer: 0,
    yaw: 0,
    prevYaw: 0,
    targetYaw: 0,
    recoil: 0,
    popAnimTimer: 0,
    totalDamageDealt: 0,
    kills: 0,
    ...overrides,
  };
}

describe('In-play UI widgets (HudBar, AbilityBar, BuildBar, TowerPanel, GameToast, EnemyTooltip)', () => {
  let dom: ReturnType<typeof installFakeDom>;

  beforeEach(() => {
    dom = installFakeDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('HudBar syncs resources, wave CTA states, flyer preview warnings, speed/pause, and memoizes preview DOM', () => {
    const callbacks = {
      onStartWave: vi.fn(),
      onToggleAutoWave: vi.fn(),
      onToggleRoutes: vi.fn(),
      onSetSpeed: vi.fn(),
      onTogglePause: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenMenu: vi.fn(),
      onRotateCamera: vi.fn(),
    };

    const hud = new HudBar(dom.body as unknown as HTMLElement, callbacks);
    const root = dom.body.children[0];
    const waveBtn = root.findByClass('hud-wave-btn')[0];
    const waveTitle = root.findByClass('hud-wave-btn-title')[0];
    const waveSub = root.findByClass('hud-wave-btn-sub')[0];
    const previewEl = root.findByClass('hud-wave-preview')[0];
    const autoBtn = root.findByTestId('btn-hud-autowave')!;
    const routesBtn = root.findByTestId('btn-hud-routes')!;
    const pauseBtn = root.findByClass('hud-pause-btn')[0];
    const speedBtns = root.findByClass('hud-speed-btn');

    const previewRef = {
      waveOneBased: 2,
      items: [
        { enemyType: 'grunt' as const, count: 2 },
        { enemyType: 'flyer' as const, count: 4 },
      ],
    };

    const baseView: HudStateView = {
      gold: 150,
      lives: 18,
      currentWave: 1,
      totalWaves: 10,
      speed: 2,
      paused: false,
      canStartWave: true,
      isPreFirstWave: true,
      earlyBonus: 0,
      countdownSec: 0,
      nextPreview: previewRef,
      autoWave: false,
      routesVisible: false,
      isEndless: false,
    };

    hud.update(baseView);
    expect(root.findByClass('hud-gold')[0].findByClass('hud-val')[0].textContent).toBe('150g');
    expect(root.findByClass('hud-lives')[0].findByClass('hud-val')[0].textContent).toBe('18');
    expect(root.findByClass('hud-wave-counter')[0].findByClass('hud-val')[0].textContent).toBe('Wave 1/10');
    expect(waveTitle.textContent).toBe('Start Wave 1');
    expect(waveSub.textContent).toBe('Click when ready');
    expect(waveBtn.disabled).toBe(false);
    expect(speedBtns[1].classList.contains('active')).toBe(true);
    expect(pauseBtn.innerHTML).toBe(UI_ICON_SVGS.pause);
    expect(previewEl.findByClass('hud-preview-chip-flyer-warn')).toHaveLength(1);
    expect(previewEl.findByClass('hud-preview-chip-flyer-warn')[0].innerHTML).toContain('4 Flyers incoming');

    // Reference identity check: changing gold without changing nextPreview ref keeps exact preview node instances
    const originalPreviewNodes = [...previewEl.children];
    hud.update({ ...baseView, gold: 210 });
    expect(previewEl.children[0]).toBe(originalPreviewNodes[0]);
    expect(root.findByClass('hud-gold')[0].findByClass('hud-val')[0].textContent).toBe('210g');

    // Between waves with countdown & early-call bonus, then 0s early-call, then active wave, then final wave & endless
    hud.update({
      ...baseView,
      isPreFirstWave: false,
      earlyBonus: 12,
      countdownSec: 4.2,
      autoWave: true,
      routesVisible: true,
    });
    expect(waveTitle.textContent).toBe('Next Wave 2');
    expect(waveSub.textContent).toBe('Call Early +12g (5s)');
    expect(autoBtn.classList.contains('active')).toBe(true);
    expect(autoBtn.getAttribute('aria-pressed')).toBe('true');
    expect(routesBtn.classList.contains('active')).toBe(true);
    expect(routesBtn.getAttribute('aria-pressed')).toBe('true');

    hud.update({ ...baseView, isPreFirstWave: false, earlyBonus: 15, countdownSec: 0 });
    expect(waveSub.textContent).toBe('Call Early +15g');

    hud.update({ ...baseView, isPreFirstWave: false, earlyBonus: 0, countdownSec: 0 });
    expect(waveSub.textContent).toBe('Send wave now');

    // < 3 flyers renders normal chip instead of flyer-warn
    hud.update({
      ...baseView,
      nextPreview: { waveOneBased: 3, items: [{ enemyType: 'flyer', count: 2 }] },
    });
    expect(previewEl.findByClass('hud-preview-chip-flyer-warn')).toHaveLength(0);
    expect(previewEl.findByClass('hud-preview-chip')[0].innerHTML).toContain('2× Flyer');

    hud.update({
      ...baseView,
      isPreFirstWave: false,
      canStartWave: false,
      currentWave: 10,
      totalWaves: 10,
      paused: true,
      nextPreview: null,
    });
    expect(waveBtn.disabled).toBe(true);
    expect(waveTitle.textContent).toBe('Final Wave');
    expect(waveSub.textContent).toBe('Hold the Skyhold!');
    expect(speedBtns.every((b) => !b.classList.contains('active'))).toBe(true);
    expect(pauseBtn.classList.contains('active')).toBe(true);
    expect(pauseBtn.innerHTML).toBe(UI_ICON_SVGS.play);
    expect(previewEl.findByClass('hud-preview-label')[0].textContent).toBe('Final Wave!');

    hud.update({
      ...baseView,
      isPreFirstWave: false,
      canStartWave: false,
      currentWave: 12,
      totalWaves: 12,
      isEndless: true,
      nextPreview: null,
    });
    const waveVal = root.findByClass('hud-wave-counter')[0].findByClass('hud-val')[0];
    expect(waveVal.textContent).toBe('Wave 12 ∞');
    expect(waveVal.classList.contains('is-endless')).toBe(true);
    expect(waveTitle.textContent).toBe('Wave 12 Active');
    expect(waveSub.textContent).toBe('Deploying foes...');
    expect(previewEl.findByClass('hud-preview-label')[0].textContent).toBe('Endless Surge');

    // Callbacks & visibility/dispose
    waveBtn.click();
    autoBtn.click();
    routesBtn.click();
    root.findByClass('hud-rot-left')[0].click();
    root.findByClass('hud-rot-right')[0].click();
    speedBtns[2].click();
    pauseBtn.click();
    root.findByClass('hud-settings-btn')[0].click();
    root.findByTestId('btn-hud-menu')!.click();

    expect(callbacks.onStartWave).toHaveBeenCalledTimes(1);
    expect(callbacks.onToggleAutoWave).toHaveBeenCalledTimes(1);
    expect(callbacks.onToggleRoutes).toHaveBeenCalledTimes(1);
    expect(callbacks.onRotateCamera).toHaveBeenNthCalledWith(1, -1);
    expect(callbacks.onRotateCamera).toHaveBeenNthCalledWith(2, 1);
    expect(callbacks.onSetSpeed).toHaveBeenCalledWith(3);
    expect(callbacks.onTogglePause).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenMenu).toHaveBeenCalledTimes(1);

    hud.setVisible(false);
    expect(root.classList.contains('hidden')).toBe(true);
    hud.dispose();
    expect(dom.body.children).toHaveLength(0);
  });

  it('AbilityBar injects singleton styles and renders ready, targeting, cooldown, buff+cooldown, and disabled states', () => {
    const onActivate = vi.fn();
    const bar1 = new AbilityBar(dom.body as unknown as HTMLElement, onActivate);
    const bar2 = new AbilityBar(dom.body as unknown as HTMLElement, onActivate);
    expect(dom.head.findAll((el) => el.id === 'skyhold-ability-bar-styles')).toHaveLength(1);
    bar2.dispose();

    const root = dom.body.children[0];
    const meteorBtn = root.findByTestId('btn-ability-meteor')!;
    const overchargeBtn = root.findByTestId('btn-ability-overcharge')!;

    // Ready + targeting
    bar1.update({
      activeAbility: 'meteor',
      meteorCooldown: 0,
      meteorMaxCooldown: ABILITY_DEFS.meteor.cooldownSec,
      overchargeCooldown: 0,
      overchargeMaxCooldown: ABILITY_DEFS.overcharge.cooldownSec,
      overchargeRemaining: 0,
    });
    expect(meteorBtn.disabled).toBe(false);
    expect(meteorBtn.classList.contains('is-ready')).toBe(true);
    expect(meteorBtn.classList.contains('is-targeting')).toBe(true);
    expect(meteorBtn.findByClass('ability-status')[0].textContent).toBe('Aim Target');
    expect(overchargeBtn.findByClass('ability-status')[0].textContent).toBe('Ready');

    // Cooldown + Overcharge active buff + simultaneous cooldown
    bar1.update({
      activeAbility: null,
      meteorCooldown: 7.2,
      meteorMaxCooldown: 30,
      overchargeCooldown: 32.1,
      overchargeMaxCooldown: 36,
      overchargeRemaining: 3.2,
      overchargeDuration: 7,
    });
    expect(meteorBtn.disabled).toBe(true);
    expect(meteorBtn.classList.contains('on-cooldown')).toBe(true);
    expect(meteorBtn.findByClass('ability-cd-fill')[0].style.height).toBe('24%');
    expect(meteorBtn.findByClass('ability-cd-badge')[0].textContent).toBe('8s');
    expect(meteorBtn.findByClass('ability-cd-badge')[0].classList.contains('hidden')).toBe(false);
    expect(meteorBtn.findByClass('ability-status')[0].textContent).toBe('8s');

    expect(overchargeBtn.classList.contains('is-buff-active')).toBe(true);
    expect(overchargeBtn.classList.contains('on-cooldown')).toBe(true);
    expect(overchargeBtn.findByClass('ability-cd-fill')[0].style.height).toBe('46%');
    expect(overchargeBtn.findByClass('ability-cd-badge')[0].textContent).toBe('33s');
    expect(overchargeBtn.findByClass('ability-status')[0].textContent).toBe('Active 4s');

    // Disabled clears targeting highlight even if activeAbility === 'meteor'
    bar1.update({
      activeAbility: 'meteor',
      meteorCooldown: 0,
      meteorMaxCooldown: 30,
      overchargeCooldown: 0,
      overchargeMaxCooldown: 36,
      overchargeRemaining: 0,
      disabled: true,
    });
    expect(meteorBtn.disabled).toBe(true);
    expect(meteorBtn.classList.contains('is-disabled')).toBe(true);
    expect(meteorBtn.classList.contains('is-targeting')).toBe(false);

    meteorBtn.click();
    overchargeBtn.click();
    expect(onActivate).toHaveBeenNthCalledWith(1, 'meteor');
    expect(onActivate).toHaveBeenNthCalledWith(2, 'overcharge');

    bar1.setVisible(false);
    expect(root.classList.contains('hidden')).toBe(true);
    bar1.dispose();
    expect(dom.body.children).toHaveLength(0);
  });

  it('BuildBar renders all tower cards, toggles affordability/active states, and invokes selection callbacks', () => {
    const onSelect = vi.fn();
    const bar = new BuildBar(dom.body as unknown as HTMLElement, onSelect);
    const root = dom.body.children[0];
    const cards = root.findByClass('build-card');
    expect(cards).toHaveLength(TOWER_TYPES.length);

    bar.update(70, 'frost'); // archer=50, frost=65 affordable; cannon=75, tesla=90, mortar=110 unaffordable
    for (const type of TOWER_TYPES) {
      const card = cards.find((c) => c.getAttribute('data-tower') === type)!;
      const affordable = 70 >= getTowerTierStats(type, 1).upgradeCost;
      expect(card.classList.contains('unaffordable')).toBe(!affordable);
      expect(card.classList.contains('active')).toBe(type === 'frost');
      expect(card.findByClass('target-badge')[0].classList.contains(TOWER_DEFS[type].hitsFlyers ? 'air-ground' : 'ground-only')).toBe(true);
    }

    cards.find((c) => c.getAttribute('data-tower') === 'tesla')!.click();
    expect(onSelect).toHaveBeenCalledWith('tesla');

    bar.setVisible(false);
    expect(root.classList.contains('hidden')).toBe(true);
    bar.dispose();
    expect(dom.body.children).toHaveLength(0);
  });

  it('TowerPanel formats stats/diffs across tower types, handles telemetry fast-path, sell-confirm, and anchor positioning', () => {
    const callbacks = {
      onUpgrade: vi.fn(),
      onSell: vi.fn(),
      onSetTargeting: vi.fn(),
      onClose: vi.fn(),
    };
    const panel = new TowerPanel(dom.body as unknown as HTMLElement, callbacks);
    const root = dom.body.children[0];
    expect(root.classList.contains('hidden')).toBe(true);

    const archerT1 = makeTower(9, 'archer', 1);
    panel.update(archerT1, 200);
    expect(root.findByClass('tower-panel-stats')[0].findByClass('tower-stat-unit').map((e) => e.textContent)).toEqual([
      'DMG',
      '/s',
      'RNG',
    ]);

    const cannon = makeTower(10, 'cannon', 1, { kills: 3, totalDamageDealt: 1250 });
    panel.update(cannon, 40);
    expect(root.classList.contains('hidden')).toBe(false);
    expect(root.findByClass('tower-panel-title')[0].textContent).toBe('Cannon Bastion');
    expect(root.findByClass('tower-panel-sub')[0].textContent).toBe('Tier I');
    expect(root.findByClass('tower-stat-val').map((e) => e.textContent)).toContain('1.3k');
    expect(root.findByClass('tower-stat-unit').map((e) => e.textContent)).toContain('AoE');
    const upgBtn = root.findByClass('tower-upgrade-btn')[0];
    expect(upgBtn.disabled).toBe(true);
    expect(root.findByClass('tower-upgrade-diff')[0].textContent).toContain('+0.3 AoE');

    // Telemetry-only fast path updates kills & formatted damage (2.5M) without clearing stats children
    const origStatsChildren = [...root.findByClass('tower-panel-stats')[0].children];
    cannon.kills = 99;
    cannon.totalDamageDealt = 2_460_000;
    panel.update(cannon, 40);
    expect(root.findByClass('tower-panel-telemetry')[0].findByClass('tower-stat-val')[0].textContent).toBe('99');
    expect(root.findByClass('tower-panel-telemetry')[0].findByClass('tower-stat-val')[1].textContent).toBe('2.5M');
    expect(root.findByClass('tower-panel-stats')[0].children[0]).toBe(origStatsChildren[0]);

    // Frost T1 has both splashRadius (1.65 -> AoE chip) and slowRatio (0.28 -> +7% slow upgrade diff)
    const frost = makeTower(11, 'frost', 1);
    panel.update(frost, 200);
    expect(root.findByClass('tower-stat-unit').map((e) => e.textContent)).toContain('AoE');
    expect(root.findByClass('tower-upgrade-diff')[0].textContent).toContain('+7%');
    expect(upgBtn.disabled).toBe(false);
    expect(upgBtn.classList.contains('is-affordable')).toBe(true);

    const tesla = makeTower(12, 'tesla', 1);
    panel.update(tesla, 200);
    expect(root.findByClass('tower-stat-unit').map((e) => e.textContent)).toContain('Chain');
    expect(root.findByClass('tower-upgrade-diff')[0].textContent).toContain('+1 Chain');

    const mortarT3 = makeTower(13, 'mortar', 3, { targetingMode: 'strongest' });
    panel.setSellConfirmArmed(true);
    panel.update(mortarT3, 500);
    expect(root.findByClass('tower-panel-sub')[0].textContent).toBe('Tier III · Max');
    expect(root.findByClass('tower-panel-sub')[0].classList.contains('is-max')).toBe(true);
    expect(upgBtn.disabled).toBe(true);
    expect(upgBtn.classList.contains('is-maxed')).toBe(true);
    expect(root.findByClass('tower-upgrade-title')[0].textContent).toBe('Max Tier III');
    const sellBtn = root.findByClass('tower-sell-btn')[0];
    expect(sellBtn.classList.contains('is-confirm')).toBe(true);
    expect(root.findByClass('tower-sell-label')[0].innerHTML).toContain('Confirm');
    expect(root.findByClass('tower-sell-value')[0].textContent).toBe(
      `+${computeSellRefund(mortarT3.totalInvested)}g`,
    );

    const targetBtns = root.findByClass('tower-target-btn');
    expect(targetBtns[2].classList.contains('is-active')).toBe(true);
    expect(targetBtns[2].getAttribute('aria-pressed')).toBe('true');

    upgBtn.click();
    sellBtn.click();
    targetBtns[1].click();
    root.findByClass('tower-panel-close')[0].click();
    expect(callbacks.onUpgrade).toHaveBeenCalledWith(13);
    expect(callbacks.onSell).toHaveBeenCalledWith(13);
    expect(callbacks.onSetTargeting).toHaveBeenCalledWith(13, 'last');
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);

    // Anchor positioning across desktop left/right/hysteresis, mobile dock, and compact landscape
    panel.setAnchorScreenPos(180, 320, 1280, 720);
    expect(root.dataset.anchorSide).toBe('right'); // leftCandidateX = 180 - 56 - 288 < 12 -> flips right
    expect(root.style.getPropertyValue('--tp-x')).toBe('236px');
    expect(root.dataset.anchorCaret).toBe('1');

    panel.setAnchorScreenPos(1100, 360, 1280, 720);
    expect(root.dataset.anchorSide).toBe('left');
    panel.setAnchorScreenPos(640, 360, 1280, 720); // within hysteresis deadzone -> keeps left
    expect(root.dataset.anchorSide).toBe('left');
    panel.setAnchorScreenPos(640, 0, 1280, 720); // clamped above top safe margin -> hides caret
    expect(root.style.getPropertyValue('--tp-y')).toBe('72px');
    expect(root.dataset.anchorCaret).toBe('0');

    panel.setAnchorScreenPos(300, 300, 768, 1024);
    expect(root.dataset.anchorSide).toBe('dock');
    expect(root.dataset.anchorCaret).toBe('0');
    expect(root.style.getPropertyValue('--tp-x')).toBe('');

    panel.setAnchorScreenPos(700, 200, 844, 390);
    expect(root.dataset.anchorSide).toBe('edge-left');
    panel.setAnchorScreenPos(120, 200, 844, 390);
    expect(root.dataset.anchorSide).toBe('edge-right');

    panel.update(null, 0);
    expect(root.classList.contains('hidden')).toBe(true);
    panel.dispose();
    expect(dom.body.children).toHaveLength(0);
  });

  it('GameToast and EnemyTooltip handle timers, clamping, armor/slow formatting, and dismissal', () => {
    const toast = new GameToast(dom.body as unknown as HTMLElement);
    const toastRoot = dom.body.children[0];
    expect(toastRoot.classList.contains('hidden')).toBe(true);

    toast.show('Wave alert!', 2.0);
    expect(toastRoot.classList.contains('hidden')).toBe(false);
    expect(toastRoot.findByClass('game-toast-msg')[0].textContent).toBe('Wave alert!');
    toast.update(0);
    toast.update(1.2);
    expect(toastRoot.classList.contains('hidden')).toBe(false);
    toast.update(0.9);
    expect(toastRoot.classList.contains('hidden')).toBe(true);

    toast.show('Manual close', 5.0);
    toastRoot.findByClass('game-toast-close')[0].click();
    expect(toastRoot.classList.contains('hidden')).toBe(true);
    toast.dispose();

    const tooltip = new EnemyTooltip(dom.body as unknown as HTMLElement);
    const tipRoot = dom.body.children[0];
    const brute = {
      type: 'brute',
      hp: 150.2,
      maxHp: 260,
      armor: 6,
      slowTimer: 1.5,
      slowRatio: 0.35,
    } as EnemyEntity;
    tooltip.show(brute, 1270, 5);
    expect(tipRoot.classList.contains('hidden')).toBe(false);
    expect(tipRoot.findByClass('enemy-tooltip-name')[0].textContent).toBe('Iron Brute');
    expect(tipRoot.findByClass('enemy-tooltip-stats')[0].children[0].textContent).toBe('HP 151/260');
    expect(tipRoot.findByClass('enemy-tooltip-stats')[0].children[1].textContent).toBe(' · Armor 6');
    expect(tipRoot.findByClass('enemy-tooltip-slow')[0].textContent).toBe(' · Slowed 35%');
    // Clamped to innerWidth - 190 = 1090 and top >= 12
    expect(tipRoot.style.transform).toBe('translate3d(1090px, 12px, 0)');

    tooltip.showTower(makeTower(1, 'archer', 1), 100, 200);
    expect(tipRoot.findByClass('enemy-tooltip-name')[0].textContent).toBe('Archer Tower T1 · Click to upgrade');
    tooltip.showTower(makeTower(2, 'frost', 3), 100, 200);
    expect(tipRoot.findByClass('enemy-tooltip-name')[0].textContent).toBe('Frost Spire T3 · Max tier');

    tooltip.hide();
    expect(tipRoot.classList.contains('hidden')).toBe(true);
    tooltip.dispose();
    expect(dom.body.children).toHaveLength(0);
  });
});

describe('Menus, modals, SettingsModal, LoadingScreen, and GameOverlays integration', () => {
  let dom: ReturnType<typeof installFakeDom>;

  beforeEach(() => {
    dom = installFakeDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('MainMenuOverlay, LevelSelectOverlay, and renderStarsHtml render progression, clamping, and endless badges', () => {
    expect(renderStarsHtml(2).match(/star-slot earned/g)).toHaveLength(2);
    expect(renderStarsHtml(2).match(/star-slot empty/g)).toHaveLength(1);

    const onPlay = vi.fn();
    const onOpenLevels = vi.fn();
    const onOpenSettings = vi.fn();
    const mainMenu = new MainMenuOverlay(dom.body as unknown as HTMLElement, {
      onPlay,
      onOpenLevelSelect: onOpenLevels,
      onOpenSettings,
    });
    const progress: ProgressData = {
      unlockedLevelIndex: 99,
      bestStars: [3, 2, 1],
      bestEndlessWaves: [0, 14, 0],
    };
    mainMenu.setOpen(true, progress);
    const menuRoot = dom.body.children[0];
    const playBtn = menuRoot.findByTestId('btn-play')!;
    expect(playBtn.textContent).toBe(`Play · ${LEVELS[LEVELS.length - 1].name}`);
    expect(menuRoot.findByClass('menu-progress-pill')[0].innerHTML).toContain(
      `6 / ${LEVELS.length * 3} Stars · ${LEVELS.length}/${LEVELS.length} Islands Unlocked`,
    );
    playBtn.click();
    menuRoot.findByTestId('btn-level-select')!.click();
    menuRoot.findByTestId('btn-main-settings')!.click();
    expect(onPlay).toHaveBeenCalledWith(LEVELS.length - 1);
    expect(onOpenLevels).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    mainMenu.setOpen(false);
    expect(menuRoot.classList.contains('hidden')).toBe(true);
    mainMenu.dispose();

    const onSelectLevel = vi.fn();
    const onBack = vi.fn();
    const levelSelect = new LevelSelectOverlay(dom.body as unknown as HTMLElement, {
      onSelectLevel,
      onBack,
    });
    levelSelect.setOpen(true, {
      unlockedLevelIndex: 2,
      bestStars: [3, 0, 0],
      bestEndlessWaves: [0, 14, 0],
    });
    const lsRoot = dom.body.children[0];
    const cards = lsRoot.findByClass('level-card');
    expect(cards).toHaveLength(LEVELS.length);
    expect(cards[0].classList.contains('locked')).toBe(false);
    expect(cards[0].findByClass('level-play-btn')[0].textContent).toBe('Replay Island');
    expect(cards[1].findByClass('level-endless-chip')[0].textContent).toBe('Endless: W14');
    expect(cards[2].findByClass('level-play-btn')[0].textContent).toBe('Deploy');
    expect(cards[3].classList.contains('locked')).toBe(true);
    expect(cards[3].findByClass('level-play-btn')[0].disabled).toBe(true);
    expect(cards[3].findByClass('level-play-btn')[0].textContent).toBe(`Locked · Clear ${LEVELS[2].name}`);

    cards[2].findByClass('level-play-btn')[0].click();
    lsRoot.findByTestId('btn-level-back')!.click();
    expect(onSelectLevel).toHaveBeenCalledWith(2);
    expect(onBack).toHaveBeenCalledTimes(1);
    levelSelect.dispose();
    expect(dom.body.children).toHaveLength(0);
  });

  it('PauseMenuModal, OutcomeOverlay, and SettingsModal handle backdrop clicks, MVP/endless stats, and controls', () => {
    const pauseCb = {
      onResume: vi.fn(),
      onRestart: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenLevelSelect: vi.fn(),
      onMainMenu: vi.fn(),
    };
    const pauseModal = new PauseMenuModal(dom.body as unknown as HTMLElement, pauseCb);
    const pauseBackdrop = dom.body.children[0];
    const pauseCard = pauseBackdrop.findByClass('pause-card')[0];
    pauseModal.setOpen(true, 'Sunlit Meadow · Wave 4/10');
    expect(pauseModal.isOpen()).toBe(true);
    expect(pauseBackdrop.findByClass('modal-subtitle')[0].textContent).toBe('Sunlit Meadow · Wave 4/10');

    // Card click must NOT resume; backdrop self-target click resumes
    pauseBackdrop.click(pauseCard);
    expect(pauseCb.onResume).toHaveBeenCalledTimes(0);
    pauseBackdrop.click(pauseBackdrop);
    expect(pauseCb.onResume).toHaveBeenCalledTimes(1);
    pauseBackdrop.findByTestId('btn-pause-restart')!.click();
    pauseBackdrop.findByTestId('btn-pause-settings')!.click();
    pauseBackdrop.findByTestId('btn-pause-levels')!.click();
    pauseBackdrop.findByTestId('btn-pause-menu')!.click();
    expect(pauseCb.onRestart).toHaveBeenCalledTimes(1);
    expect(pauseCb.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(pauseCb.onOpenLevelSelect).toHaveBeenCalledTimes(1);
    expect(pauseCb.onMainMenu).toHaveBeenCalledTimes(1);
    pauseModal.dispose();

    const outCb = {
      onNextLevel: vi.fn(),
      onEndlessMode: vi.fn(),
      onReplay: vi.fn(),
      onLevelSelect: vi.fn(),
      onMainMenu: vi.fn(),
    };
    const outcome = new OutcomeOverlay(dom.body as unknown as HTMLElement, outCb);
    const outBackdrop = dom.body.children[0];
    outcome.showWin(LEVELS[0], 3, 20, 88, false, {
      name: 'Siege Mortar',
      type: 'mortar',
      tier: 3,
      damageDealt: 1540,
      kills: 1,
    });
    expect(outcome.isOpen()).toBe(true);
    expect(outBackdrop.findByTestId('btn-outcome-next')!.classList.contains('hidden')).toBe(true);
    expect(outBackdrop.findByTestId('btn-outcome-endless')!.className).toBe('btn-primary btn-lg');
    expect(outBackdrop.findByClass('outcome-mvp')[0].classList.contains('hidden')).toBe(false);
    expect(outBackdrop.findByClass('outcome-mvp')[0].textContent).toContain('MVP · Siege Mortar III');
    expect(outBackdrop.findByClass('outcome-mvp')[0].textContent).toContain('1.5k DMG · 1 Kill');

    outcome.showWin(LEVELS[0], 2, 14, 70, true, {
      name: 'Tesla Coil',
      type: 'tesla',
      tier: 2,
      damageDealt: 1_240_000,
      kills: 12,
    });
    expect(outBackdrop.findByTestId('btn-outcome-next')!.classList.contains('hidden')).toBe(false);
    expect(outBackdrop.findByTestId('btn-outcome-endless')!.className).toBe('btn-secondary btn-lg');
    expect(outBackdrop.findByClass('outcome-mvp')[0].textContent).toContain('MVP · Tesla Coil II');
    expect(outBackdrop.findByClass('outcome-mvp')[0].textContent).toContain('1.2M DMG · 12 Kills');

    outcome.showLose(LEVELS[1], 7, 90);
    expect(outBackdrop.findByClass('outcome-title')[0].textContent).toBe('Defeat');
    expect(outBackdrop.findByClass('outcome-stats')[0].innerHTML).toContain(`7 / ${LEVELS[1].waves.length}`);

    outcome.showLose(LEVELS[1], 16, 240, { isEndless: true, earnedStars: 2, mvp: null });
    expect(outBackdrop.findByClass('outcome-title')[0].textContent).toBe('Endless Fallen');
    expect(outBackdrop.findByClass('outcome-stats')[0].innerHTML).toContain('Wave 16 ∞');
    expect(outBackdrop.findByClass('outcome-mvp')[0].classList.contains('hidden')).toBe(true);
    expect(outBackdrop.findByTestId('btn-outcome-replay')!.textContent).toBe('Retry Island');

    outBackdrop.findByTestId('btn-outcome-next')!.click();
    outBackdrop.findByTestId('btn-outcome-endless')!.click();
    outBackdrop.findByTestId('btn-outcome-replay')!.click();
    outBackdrop.findByTestId('btn-outcome-levels')!.click();
    outBackdrop.findByTestId('btn-outcome-menu')!.click();
    expect(outCb.onNextLevel).toHaveBeenCalledTimes(1);
    expect(outCb.onEndlessMode).toHaveBeenCalledTimes(1);
    expect(outCb.onReplay).toHaveBeenCalledTimes(1);
    expect(outCb.onLevelSelect).toHaveBeenCalledTimes(1);
    expect(outCb.onMainMenu).toHaveBeenCalledTimes(1);

    outcome.hide();
    expect(outcome.isOpen()).toBe(false);
    outcome.dispose();

    const initialSettings: GameSettings = {
      masterVolume: 0.65,
      muted: false,
      cameraShake: true,
      damageNumbers: true,
      quality: 'high',
    };
    const setCb = {
      onChange: vi.fn(),
      onRestart: vi.fn(),
      onQuitToMenu: vi.fn(),
      onClose: vi.fn(),
    };
    const settingsModal = new SettingsModal(dom.body as unknown as HTMLElement, initialSettings, setCb);
    const setBackdrop = dom.body.children[0];
    settingsModal.setOpen(true, initialSettings, false);
    expect(settingsModal.isOpen()).toBe(true);
    const actionBtns = setBackdrop.findByClass('modal-actions')[0].children;
    expect(actionBtns[0].classList.contains('hidden')).toBe(true);
    expect(actionBtns[1].classList.contains('hidden')).toBe(true);
    expect(actionBtns[2].textContent).toBe('Done');

    settingsModal.setOpen(true, initialSettings, true);
    expect(actionBtns[0].classList.contains('hidden')).toBe(false);
    expect(actionBtns[2].textContent).toBe('Back');

    const slider = setBackdrop.findByClass('setting-slider')[0];
    slider.value = '30';
    slider.dispatch('input');
    const checkboxes = setBackdrop.findAll((el) => el.type === 'checkbox');
    checkboxes[0].checked = true;
    checkboxes[0].dispatch('change');
    checkboxes[1].checked = false;
    checkboxes[1].dispatch('change');
    checkboxes[2].checked = false;
    checkboxes[2].dispatch('change');
    setBackdrop.findByClass('setting-seg-btn')[1].click(); // Low quality

    expect(setCb.onChange).toHaveBeenLastCalledWith({
      masterVolume: 0.3,
      muted: true,
      cameraShake: false,
      damageNumbers: false,
      quality: 'low',
    });

    setBackdrop.click(setBackdrop.findByClass('settings-card')[0]);
    expect(setCb.onClose).toHaveBeenCalledTimes(0);
    setBackdrop.click(setBackdrop);
    expect(setCb.onClose).toHaveBeenCalledTimes(1);
    actionBtns[0].click();
    actionBtns[1].click();
    expect(setCb.onRestart).toHaveBeenCalledTimes(1);
    expect(setCb.onQuitToMenu).toHaveBeenCalledTimes(1);
    settingsModal.dispose();
  });

  it('LoadingScreen updates clamped progress, switches to error/reload state, and removes on hide timeout', () => {
    const ls = new LoadingScreen(dom.body as unknown as HTMLElement);
    ls.setProgress(15, 30, 'tile-straight');
    const track = ls.element.findByClass('loading-bar-track')[0];
    expect(ls.element.findByClass('loading-bar-fill')[0].style.width).toBe('50%');
    expect(ls.element.findByClass('loading-pct')[0].textContent).toBe('50%');
    expect(track.getAttribute('aria-valuenow')).toBe('50');
    expect(ls.element.findByClass('loading-detail')[0].textContent).toBe('Loading tile-straight');

    ls.setProgress(5, 0);
    expect(ls.element.findByClass('loading-pct')[0].textContent).toBe('0%');
    ls.setProgress(50, 10);
    expect(ls.element.findByClass('loading-pct')[0].textContent).toBe('100%');

    ls.hide();
    expect(ls.element.classList.contains('loading-screen-done')).toBe(true);
    expect(dom.timers).toHaveLength(1);
    expect(dom.timers[0].ms).toBe(220);
    dom.timers[0].fn();
    expect(dom.body.children).toHaveLength(0);

    const lsErr = new LoadingScreen(dom.body as unknown as HTMLElement);
    lsErr.hide();
    lsErr.showError('WebGL context lost');
    expect(lsErr.element.classList.contains('loading-screen-done')).toBe(false);
    const card = lsErr.element.findByClass('loading-card')[0];
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.findByClass('loading-detail')[0].textContent).toBe('WebGL context lost');
    const reloadBtn = card.findAll((el) => el.tagName === 'BUTTON')[0];
    expect(reloadBtn.focused).toBe(true);
    reloadBtn.click();
    expect(dom.reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('GameOverlays coordinates modals, play visibility, pause banner gating, and full cleanup on dispose', () => {
    const noop = () => {};
    const overlays = new GameOverlays(dom.body as unknown as HTMLElement, {
      initialSettings: {
        masterVolume: 0.65,
        muted: false,
        cameraShake: true,
        damageNumbers: true,
        quality: 'high',
      },
      onStartWave: noop,
      onToggleAutoWave: noop,
      onToggleRoutes: noop,
      onSetSpeed: noop,
      onTogglePause: noop,
      onOpenSettings: noop,
      onOpenMenu: noop,
      onRotateCamera: noop,
      onSelectBuildType: noop,
      onActivateAbility: noop,
      onUpgradeTower: noop,
      onSellTower: noop,
      onSetTargeting: noop,
      onCloseTowerPanel: noop,
      onPlayFromMenu: noop,
      onOpenLevelSelectFromMenu: noop,
      onOpenSettingsFromMenu: noop,
      onSelectLevel: noop,
      onBackFromLevelSelect: noop,
      onResumeFromPause: noop,
      onRestartLevel: noop,
      onOpenSettingsFromPause: noop,
      onOpenLevelSelectFromPause: noop,
      onMainMenuFromPause: noop,
      onNextLevel: noop,
      onEndlessMode: noop,
      onSettingsChange: noop,
      onSettingsClose: noop,
    });

    expect(overlays.isModalOpen()).toBe(false);
    overlays.pauseMenu.setOpen(true);
    expect(overlays.isModalOpen()).toBe(true);
    overlays.closeModals();
    expect(overlays.isModalOpen()).toBe(false);

    overlays.settingsModal.setOpen(true);
    expect(overlays.isModalOpen()).toBe(true);
    overlays.closeModals();
    expect(overlays.isModalOpen()).toBe(false);

    overlays.outcomeOverlay.showWin(LEVELS[0], 3, 20, 10, true, null);
    expect(overlays.isModalOpen()).toBe(true);
    overlays.closeModals();
    expect(overlays.isModalOpen()).toBe(false);

    const hudView: HudStateView = {
      gold: 120,
      lives: 20,
      currentWave: 1,
      totalWaves: 10,
      speed: 1,
      paused: true,
      canStartWave: false,
      isPreFirstWave: false,
      earlyBonus: 0,
      countdownSec: 0,
      nextPreview: null,
      autoWave: false,
      routesVisible: false,
      isEndless: false,
    };
    const abView = {
      activeAbility: null,
      meteorCooldown: 0,
      meteorMaxCooldown: BALANCE.startingLives,
      overchargeCooldown: 0,
      overchargeMaxCooldown: 36,
      overchargeRemaining: 0,
    };

    const pauseBanner = dom.body.findByClass('pause-banner')[0];
    overlays.syncInPlay(hudView, abView, 'archer', makeTower(1, 'archer', 1), true);
    expect(pauseBanner.classList.contains('hidden')).toBe(false);

    // Pause banner yields when a modal is open
    overlays.pauseMenu.setOpen(true);
    overlays.syncInPlay(hudView, abView, 'archer', makeTower(1, 'archer', 1), true);
    expect(pauseBanner.classList.contains('hidden')).toBe(true);

    overlays.closeModals();
    overlays.toast.show('Notice');
    overlays.setPlayVisibility(false);
    expect(pauseBanner.classList.contains('hidden')).toBe(true);
    expect(dom.body.findByClass('game-toast')[0].classList.contains('hidden')).toBe(true);
    expect(dom.body.findByClass('tower-panel')[0].classList.contains('hidden')).toBe(true);

    overlays.dispose();
    expect(dom.body.children).toHaveLength(0);
  });
});
