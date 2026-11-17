/**
 * DOM smoke tests for the onboarding coach, first-sighting card, codex screen and director.
 * Uses happy-dom when it is installed (dev-only, not a project dependency) and skips otherwise.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContentStore, type StorageLike } from '../../src/platform/contentStorage.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import type { OnboardingObs } from '../../src/ui/content/onboardingMachine.ts';

let hasDom = true;
let WindowCtor: (new () => unknown) | undefined;
try {
  const moduleName = 'happy-dom'; // variable specifier: not a declared dependency, so keep tsc/vite from resolving it
  const mod = (await import(/* @vite-ignore */ moduleName)) as { Window: new () => unknown };
  WindowCtor = mod.Window;
} catch {
  hasDom = false;
}

const obsBase: OnboardingObs = {
  inPlay: true,
  levelIndex: 0,
  touch: false,
  modalOpen: false,
  towerCount: 0,
  maxTier: 0,
  towerSelected: false,
  placementActive: false,
  radialMode: 'closed',
  wavesStarted: 0,
  gold: 185,
  cheapestUpgrade: Infinity,
  meteorReady: false,
  meteorAiming: false,
};

function mem(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe.skipIf(!hasDom)('content UI (DOM)', () => {
  let root: HTMLElement;

  beforeAll(() => {
    const win = new WindowCtor!() as unknown as Window & typeof globalThis;
    const g = globalThis as unknown as Record<string, unknown>;
    g.window = win;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.KeyboardEvent = win.KeyboardEvent;
  });

  const fresh = (): HTMLElement => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    return root;
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('codex: silhouettes until met, then names; tabs and detail work', async () => {
    const { CodexScreen } = await import('../../src/ui/content/codexScreen.ts');
    const seen = new Set<string>(['enemy:grunt']);
    const codex = new CodexScreen(fresh(), { isSeen: (id) => seen.has(id), onClose: () => undefined });
    codex.open('enemies');
    const tiles = root.querySelectorAll('.cx-tile');
    expect(tiles).toHaveLength(16); // 15 foes + elites
    expect(root.querySelectorAll('.cx-tile.is-locked')).toHaveLength(15);
    expect(root.querySelector('[data-testid="codex-tile-grunt"] .cx-tile-name')?.textContent).toBe('Raider Grunt');
    expect(root.querySelector('[data-testid="codex-tile-boss"] .cx-tile-name')?.textContent).toBe('???');
    expect(root.querySelector('.cx-d-name')?.textContent).toBe('Raider Grunt');

    // A locked foe's detail does not spoil its name.
    (root.querySelector('[data-testid="codex-tile-tempest"]') as HTMLElement).click();
    expect(root.querySelector('.cx-d-name')?.textContent).toBe('Unknown foe');
    expect(root.textContent).not.toContain('Tempest Colossus');

    seen.add('enemy:tempest');
    codex.open('enemies', 'tempest');
    expect(root.querySelector('.cx-d-name')?.textContent).toBe('Tempest Colossus');
    expect(root.querySelector('.cx-tip-text')?.textContent).toMatch(/Overcharge/);

    (root.querySelector('[data-testid="codex-tab-towers"]') as HTMLElement).click();
    expect(root.querySelectorAll('.cx-tile')).toHaveLength(7);
    expect(root.querySelector('.cx-sig-label')?.textContent).toMatch(/Tier III signature/);
    expect(root.querySelectorAll('.cx-tier')).toHaveLength(3);
    codex.dispose();
  });

  it('codex: close button closes and calls back', async () => {
    const { CodexScreen } = await import('../../src/ui/content/codexScreen.ts');
    const onClose = vi.fn();
    const codex = new CodexScreen(fresh(), { isSeen: () => true, onClose });
    codex.open();
    expect(codex.isOpen()).toBe(true);
    (root.querySelector('[data-testid="codex-close"]') as HTMLElement).click();
    expect(codex.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    codex.dispose();
  });

  it('sighting card: steps through a list, reports visibility, Enter dismisses', async () => {
    const { SightingCard } = await import('../../src/ui/content/sightingCard.ts');
    const vis = vi.fn();
    const card = new SightingCard(fresh(), { onVisibilityChange: vis, onOpenCodex: () => undefined });
    card.show([{ kind: 'enemy', type: 'golem' }]);
    expect(card.isOpen()).toBe(true);
    expect(vis).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.sc-name')?.textContent).toBe('Basalt Golem');
    expect(root.querySelector('.sc-ok')?.textContent).toBe('Got it');
    // A second foe arriving while open is appended, not replaced.
    card.show([{ kind: 'elite' }, { kind: 'tower', type: 'beacon' }]);
    expect(root.querySelector('.sc-ok')?.textContent).toBe('Next');
    expect(root.querySelector('.sc-count')?.textContent).toBe('1/3');
    (root.querySelector('.sc-ok') as HTMLElement).click();
    expect(root.querySelector('.sc-name')?.textContent).toBe('Empowered Elites');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(root.querySelector('.sc-name')?.textContent).toBe('Windcaller Beacon');
    expect(root.querySelector('.sc-ok')?.textContent).toBe('Got it');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(card.isOpen()).toBe(false);
    expect(vis).toHaveBeenCalledTimes(2);
    card.dispose();
  });

  it('coach: glows the target control and removes the glow on hide', async () => {
    const { CoachMark } = await import('../../src/ui/content/coachMark.ts');
    const { coachMessage } = await import('../../src/ui/content/onboardingMachine.ts');
    const r = fresh();
    const btn = document.createElement('button');
    btn.className = 'hud-wave-btn';
    r.appendChild(btn);
    const coach = new CoachMark(r, () => undefined);
    const msg = coachMessage('startWave', obsBase)!;
    coach.show(msg);
    expect(btn.classList.contains('onb-spot')).toBe(true);
    expect(r.querySelector('.onb-coach-title')?.textContent).toBe(msg.title);
    expect(r.querySelector('.onb-coach')?.classList.contains('hidden')).toBe(false);
    coach.hide();
    expect(btn.classList.contains('onb-spot')).toBe(false);
    expect(r.querySelector('.onb-coach')?.classList.contains('hidden')).toBe(true);
    coach.dispose();
  });

  it('director: shows the cards for new foes once, persists skip, never re-shows the tour', async () => {
    const { ContentDirector } = await import('../../src/ui/content/contentDirector.ts');
    const storage = mem();
    const store = new ContentStore(storage);
    store.migrate(LEVELS, { unlockedLevelIndex: 0, bestStars: new Array<number>(LEVELS.length).fill(0) });
    const onBlock = vi.fn();
    const dir = new ContentDirector(fresh(), store, { onBlockingChange: onBlock, startTutorialIsland: vi.fn() });
    const bus = new EventBus();
    dir.bindLevel(bus, LEVELS[0], 0);

    bus.emit('enemySpawned', { enemyId: 1, enemyType: 'grunt', flying: false });
    expect(dir.isBlocking()).toBe(true);
    expect(onBlock).toHaveBeenCalled();
    expect(store.hasSeen('enemy:grunt')).toBe(true);
    // Same foe again: nothing new.
    (root.querySelector('[data-testid="sighting-ok"]') as HTMLElement).click();
    expect(dir.isBlocking()).toBe(false);
    bus.emit('enemySpawned', { enemyId: 2, enemyType: 'grunt', flying: false });
    expect(dir.isBlocking()).toBe(false);

    // Tour: coach appears on island 1, skip persists and hides it.
    dir.observe(obsBase);
    expect(root.querySelector('.onb-coach')?.classList.contains('hidden')).toBe(false);
    (root.querySelector('[data-testid="onboarding-skip"]') as HTMLElement).click();
    expect(root.querySelector('.onb-coach')?.classList.contains('hidden')).toBe(true);
    expect(new ContentStore(storage).getOnboardingStatus()).toBe('skipped');
    dir.observe(obsBase);
    expect(root.querySelector('.onb-coach')?.classList.contains('hidden')).toBe(true);
    dir.dispose();
  });

  it('director: finishing the tour persists done; replay restarts it', async () => {
    const { ContentDirector } = await import('../../src/ui/content/contentDirector.ts');
    const storage = mem();
    const store = new ContentStore(storage);
    const start = vi.fn();
    const dir = new ContentDirector(fresh(), store, { onBlockingChange: vi.fn(), startTutorialIsland: start });
    const bus = new EventBus();
    dir.bindLevel(bus, LEVELS[0], 0);
    dir.observe({ ...obsBase, towerCount: 1, wavesStarted: 1, maxTier: 2 });
    expect(dir.isTourActive()).toBe(true);
    bus.emit('abilityTargeted', { abilityId: 'meteor', x: 0, z: 0, radius: 1 });
    dir.observe({ ...obsBase, towerCount: 1, wavesStarted: 1, maxTier: 2 });
    expect(dir.isTourActive()).toBe(false);
    expect(new ContentStore(storage).getOnboardingStatus()).toBe('done');
    expect(root.querySelector('.onb-coach-title')?.textContent).toMatch(/ready/i);

    dir.replayTutorial();
    expect(start).toHaveBeenCalledOnce();
    expect(dir.isTourActive()).toBe(true);
    expect(new ContentStore(storage).getOnboardingStatus()).toBe('pending');
    dir.dispose();
  });

  it('director: elite waves queue the elite card once; veterans see no tour', async () => {
    const { ContentDirector } = await import('../../src/ui/content/contentDirector.ts');
    const store = new ContentStore(mem());
    store.migrate(LEVELS, { unlockedLevelIndex: 4, bestStars: [3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    const dir = new ContentDirector(fresh(), store, { onBlockingChange: vi.fn(), startTutorialIsland: vi.fn() });
    expect(dir.isTourActive()).toBe(false);
    const level = LEVELS[LEVELS.length - 1];
    const eliteWave = level.waves.findIndex((w) => w.groups.some((g) => g.elite));
    const bus = new EventBus();
    dir.bindLevel(bus, level, LEVELS.length - 1);
    bus.emit('waveStarted', { waveIndex: eliteWave, totalWaves: level.waves.length, earlyBonus: 0 });
    expect(dir.isBlocking()).toBe(true);
    expect(root.querySelector('.sc-name')?.textContent).toBe('Empowered Elites');
    dir.dispose();
  });

  it('entry points decorate existing menu containers and skip missing ones', async () => {
    const { mountCodexEntryPoints } = await import('../../src/ui/content/entryPoints.ts');
    const r = fresh();
    r.innerHTML =
      '<div class="menu-card-main"><div class="menu-btn-row"></div></div><div class="pause-tiles"></div>';
    const open = vi.fn();
    mountCodexEntryPoints(r, open);
    (r.querySelector('[data-testid="btn-codex"]') as HTMLElement).click();
    (r.querySelector('[data-testid="btn-pause-codex"]') as HTMLElement).click();
    expect(open).toHaveBeenCalledTimes(2);
    expect(r.querySelector('[data-testid="btn-codex-levels"]')).toBeNull();
  });
});
