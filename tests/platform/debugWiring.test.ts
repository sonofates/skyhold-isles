import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { EnemyType } from '../../src/core/types.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import type { RenderWorld } from '../../src/render/renderWorld.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { createDebugPanelIfEnabled } from '../../src/ui/debugWiring.ts';
import type { FloatingTextPool } from '../../src/ui/floatingText.ts';

class FakeClassList {
  private readonly set = new Set<string>();
  sync(name: string): void {
    this.set.clear();
    for (const part of name.split(/\s+/)) {
      if (part) this.set.add(part);
    }
  }
  toggle(token: string, force?: boolean): boolean {
    if (force === undefined) {
      if (this.set.has(token)) {
        this.set.delete(token);
        return false;
      }
      this.set.add(token);
      return true;
    }
    if (force) this.set.add(token);
    else this.set.delete(token);
    return force;
  }
  contains(token: string): boolean {
    return this.set.has(token);
  }
}

class FakeDomElement {
  readonly tagName: string;
  id = '';
  type = '';
  min = '';
  max = '';
  value = '';
  textContent: string | null = '';
  children: FakeDomElement[] = [];
  parent: FakeDomElement | null = null;
  attrs = new Map<string, string>();
  readonly classList = new FakeClassList();
  private _className = '';
  private listeners = new Map<string, Array<() => void>>();

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

  setAttribute(name: string, val: string): void {
    this.attrs.set(name, String(val));
  }

  appendChild(child: FakeDomElement): FakeDomElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: FakeDomElement[]): void {
    for (const n of nodes) this.appendChild(n);
  }

  addEventListener(type: string, cb: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  click(): void {
    for (const cb of this.listeners.get('click') ?? []) cb();
  }

  remove(): void {
    if (!this.parent) return;
    const idx = this.parent.children.indexOf(this);
    if (idx !== -1) this.parent.children.splice(idx, 1);
    this.parent = null;
  }

  findAll(pred: (el: FakeDomElement) => boolean): FakeDomElement[] {
    const out: FakeDomElement[] = [];
    const visit = (node: FakeDomElement): void => {
      if (pred(node)) out.push(node);
      for (const c of node.children) visit(c);
    };
    visit(this);
    return out;
  }
}

describe('debugWiring and DebugPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns null when ?debug query parameter is absent', () => {
    vi.stubGlobal('window', { location: { search: '' } });
    const parent = new FakeDomElement('div');
    const panel = createDebugPanelIfEnabled(parent as unknown as HTMLElement, {
      getSimWorld: () => new SimWorld(LEVELS[0], new EventBus()),
      renderWorld: {} as RenderWorld,
      floatingTextPool: {} as FloatingTextPool,
      pendingDebugSpawns: [],
      syncUi: () => {},
    });
    expect(panel).toBeNull();
    expect(parent.children).toHaveLength(0);
  });

  it('mounts DebugPanel when ?debug is present and wires all actions and telemetry', () => {
    vi.stubGlobal('window', { location: { search: '?debug=1' } });
    vi.stubGlobal('document', {
      createElement: (tag: string) => new FakeDomElement(tag),
    });

    const parent = new FakeDomElement('div');
    const simWorld = new SimWorld(LEVELS[0], new EventBus());
    const pendingDebugSpawns: Array<{ type: EnemyType; delay: number }> = [];
    let syncCount = 0;

    const renderWorld = {
      setShowAllRanges: vi.fn(),
      getRenderMetrics: () => ({ drawCalls: 18, drawsWithShadows: 24, drawsNoShadows: 18, triangles: 4500 }),
      getMemoryStats: () => ({ geometries: 12, textures: 3 }),
      effectsRenderer: { getActiveFxCount: () => 7 },
    } as unknown as RenderWorld;

    const floatingTextPool = { getActiveCount: () => 5 } as unknown as FloatingTextPool;

    const panel = createDebugPanelIfEnabled(parent as unknown as HTMLElement, {
      getSimWorld: () => simWorld,
      renderWorld,
      floatingTextPool,
      pendingDebugSpawns,
      syncUi: () => syncCount++,
    })!;
    expect(panel).not.toBeNull();
    expect(parent.children).toHaveLength(1);

    const root = parent.children[0];
    const findBtn = (label: string): FakeDomElement =>
      root.findAll((el) => el.tagName === 'BUTTON' && el.textContent === label)[0];

    // Gold and lives actions
    const startGold = simWorld.gold;
    findBtn('+100g').click();
    findBtn('+500g').click();
    expect(simWorld.gold).toBe(startGold + 600);
    findBtn('Lives=1').click();
    expect(simWorld.lives).toBe(1);
    findBtn('Lives=20').click();
    expect(simWorld.lives).toBe(20);

    // Wave skip
    const waveInput = root.findAll((el) => el.attrs.get('aria-label') === 'Wave number')[0];
    waveInput.value = '4';
    findBtn('Skip Wave').click();
    expect(simWorld.waveSystem.currentWaveOneBased).toBe(4);

    // Enemy spawn (< 40 vs >= 40 interval branching)
    const enemySelect = root.findAll((el) => el.attrs.get('aria-label') === 'Enemy type')[0];
    const countInput = root.findAll((el) => el.attrs.get('aria-label') === 'Enemy spawn count')[0];
    enemySelect.value = 'flyer';
    countInput.value = '3';
    findBtn('Spawn').click();
    expect(pendingDebugSpawns).toHaveLength(3);
    expect(pendingDebugSpawns[1].delay).toBeCloseTo(0.18, 5);

    pendingDebugSpawns.length = 0;
    enemySelect.value = 'grunt';
    countInput.value = '40';
    findBtn('Spawn').click();
    expect(pendingDebugSpawns).toHaveLength(40);
    expect(pendingDebugSpawns[1].delay).toBeCloseTo(0.03, 5);

    // Range rings toggle & body collapse toggle
    const rangeBtn = findBtn('Ranges: OFF');
    rangeBtn.click();
    expect(renderWorld.setShowAllRanges).toHaveBeenLastCalledWith(true);
    expect(rangeBtn.textContent).toBe('Ranges: ON');
    rangeBtn.click();
    expect(renderWorld.setShowAllRanges).toHaveBeenLastCalledWith(false);
    expect(rangeBtn.textContent).toBe('Ranges: OFF');

    const hideBtn = findBtn('Hide');
    hideBtn.click();
    expect(hideBtn.textContent).toBe('Show');
    hideBtn.click();
    expect(hideBtn.textContent).toBe('Hide');

    // Telemetry refresh smooths FPS over >= 0.2s window
    panel.update(0.1);
    panel.update(0.15);
    const preEl = root.findAll((el) => el.tagName === 'PRE')[0];
    expect(preEl.textContent).toContain('FPS: 8.0');
    expect(preEl.textContent).toContain('Draws: 24 w/sh | 18 no-sh');
    expect(preEl.textContent).toContain('Geos: 12');
    expect(preEl.textContent).toContain('FX: 7');
    expect(preEl.textContent).toContain('FloatTxt: 5');

    // Instant Win & Lose
    findBtn('Win').click();
    expect(simWorld.outcome).toBe('won');
    simWorld.debugSkipToWave(1);
    findBtn('Lose').click();
    expect(simWorld.outcome).toBe('lost');
    expect(syncCount).toBeGreaterThan(0);

    panel.setVisible(false);
    expect(root.classList.contains('hidden')).toBe(true);
    panel.setVisible(true);
    expect(root.classList.contains('hidden')).toBe(false);

    panel.dispose();
    expect(parent.children).toHaveLength(0);
  });
});
