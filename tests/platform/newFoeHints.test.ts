import { beforeAll, describe, expect, it } from 'vitest';
import type { EventBus as EventBusT } from '../../src/core/eventBus.ts';
import type { EnemyType } from '../../src/core/types.ts';

// storage.ts reads localStorage; give it an in-memory one before the bridge module loads.
beforeAll(() => {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
});

describe('first-encounter toasts', () => {
  it('never replace a hint that is still on screen, at any game speed (incl. the flyer hint)', async () => {
    const { EventBus } = await import('../../src/core/eventBus.ts');
    const { bindSimEventBridge } = await import('../../src/platform/sessionBridge.ts');
    const bus: EventBusT = new EventBus();
    let real = 0;
    const shown: { msg: string; at: number; until: number }[] = [];
    bindSimEventBridge({
      bus,
      soundManager: { bindEvents: () => () => {} } as never,
      overlays: {
        toast: { show: (msg: string, dur = 6) => shown.push({ msg, at: real, until: real + dur }) },
        floatingTextPool: {},
      } as never,
      getSettings: () => ({ damageNumbers: false }) as never,
      getSimClock: () => real * 3, // 3x game speed
      getRealClock: () => real,
      onSyncUi: () => {},
      onGameWon: () => {},
      onGameLost: () => {},
    });
    const spawn = (type: EnemyType, flying = false): void =>
      bus.emit('enemySpawned', { enemyId: 1, enemyType: type, flying });

    spawn('warden');
    // A golem and a flyer turn up every 0.5 real s while the warden hint is up.
    for (let t = 0.5; t <= 9; t += 0.5) {
      real = t;
      spawn('golem');
      spawn('flyer', true);
    }
    expect(shown.map((s) => s.msg.split(' — ')[1]?.split(':')[0] ?? s.msg.slice(0, 7))).toEqual([
      'Aegis Warden',
      'Basalt Golem',
    ]);
    for (let i = 1; i < shown.length; i++) expect(shown[i].at).toBeGreaterThanOrEqual(shown[i - 1].until);
    // The flyer hint was held back, not burned: it shows once the screen is free.
    real = 20;
    spawn('flyer', true);
    expect(shown[shown.length - 1].msg).toMatch(/^Flyers incoming/);
  });

  it('unbinds all bus listeners when the cleanup returned by bindSimEventBridge is called', async () => {
    const { EventBus } = await import('../../src/core/eventBus.ts');
    const { bindSimEventBridge } = await import('../../src/platform/sessionBridge.ts');
    const bus: EventBusT = new EventBus();
    let soundUnbound = 0;
    let syncCalls = 0;
    let wonCalls = 0;
    let lostCalls = 0;
    let goldCalls = 0;

    const unbind = bindSimEventBridge({
      bus,
      suppressIntroToasts: true,
      soundManager: { bindEvents: () => () => void soundUnbound++ } as never,
      overlays: {
        toast: { show: () => {} },
        floatingTextPool: { spawnGold: () => void goldCalls++, spawnDamage: () => {}, spawnUpgradeTier: () => {} },
      } as never,
      getSettings: () => ({ damageNumbers: true }) as never,
      getSimClock: () => 0,
      onSyncUi: () => void syncCalls++,
      onGameWon: () => void wonCalls++,
      onGameLost: () => void lostCalls++,
    });

    bus.emit('economyChanged', { gold: 100, lives: 20 });
    bus.emit('enemyKilled', { enemyId: 1, enemyType: 'grunt', x: 0, y: 0, z: 0, reward: 5 });
    expect(syncCalls).toBe(1);
    expect(goldCalls).toBe(1);

    unbind();
    expect(soundUnbound).toBe(1);

    bus.emit('economyChanged', { gold: 120, lives: 19 });
    bus.emit('waveStarted', { waveIndex: 0, totalWaves: 5, earlyBonus: 0 });
    bus.emit('enemyKilled', { enemyId: 2, enemyType: 'grunt', x: 0, y: 0, z: 0, reward: 5 });
    bus.emit('gameWon', { stars: 3, livesRemaining: 20 });
    bus.emit('gameLost', { waveIndex: 0, endless: true });
    expect(syncCalls).toBe(1);
    expect(goldCalls).toBe(1);
    expect(wonCalls).toBe(0);
    expect(lostCalls).toBe(0);
  });
});
