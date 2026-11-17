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
});
