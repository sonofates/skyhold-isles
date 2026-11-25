import { describe, expect, it } from 'vitest';
import { ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';

/** Foes with a codex tile of their own (the Sovereign's Shadow Halves are part of its entry). */
const CODEX_FOES = ENEMY_TYPES.filter((t) => ENEMY_DEFS[t].partOf === undefined);
import { TOWER_DEFS, TOWER_TYPES } from '../../src/data/towers.ts';
import { ContentStore } from '../../src/platform/contentStorage.ts';
import { ENEMY_ICON_SVGS, TOWER_ICON_SVGS } from '../../src/ui/icons.ts';
import {
  ENEMY_LORE,
  TOWER_LORE,
  allEnemyEntries,
  allTowerEntries,
  eliteEntry,
  enemyEntry,
  speedClass,
  towerEntry,
} from '../../src/ui/content/codexData.ts';
import { SightingQueue, waveHasElite } from '../../src/ui/content/firstSighting.ts';
import { LEVELS } from '../../src/data/levels/index.ts';

describe('codex data', () => {
  it('covers every enemy and tower with text, counters and an icon', () => {
    for (const t of ENEMY_TYPES) {
      const e = enemyEntry(t);
      expect(ENEMY_LORE[t].blurb.length).toBeGreaterThan(10);
      expect(e.counter.length).toBeGreaterThan(10);
      expect(e.blurb.length).toBeLessThanOrEqual(90);
      expect(e.stats.length).toBeGreaterThanOrEqual(4);
      expect(ENEMY_ICON_SVGS[t]).toContain('<svg');
    }
    for (const t of TOWER_TYPES) {
      const e = towerEntry(t);
      expect(TOWER_LORE[t].strong.length).toBeGreaterThan(10);
      expect(e.tiers).toHaveLength(3);
      expect(e.signatureName.length).toBeGreaterThan(2);
      expect(TOWER_ICON_SVGS[t]).toContain('<svg');
    }
    expect(allEnemyEntries()).toHaveLength(CODEX_FOES.length);
    expect(allEnemyEntries().some((e) => e.id === 'eclipse_shade')).toBe(false);
    expect(allTowerEntries()).toHaveLength(TOWER_TYPES.length);
  });

  it('flags bosses and flyers and uses distinct seen ids', () => {
    expect(enemyEntry('boss').isBoss).toBe(true);
    expect(enemyEntry('tempest').isBoss).toBe(true);
    expect(enemyEntry('flyer').flying).toBe(true);
    expect(enemyEntry('grunt').isBoss).toBe(false);
    const ids = new Set([...allEnemyEntries(), ...allTowerEntries(), eliteEntry()].map((e) => e.seenId));
    expect(ids.size).toBe(CODEX_FOES.length + TOWER_TYPES.length + 1);
  });

  it('does not tell the player a tower can do something it cannot', () => {
    // Counter text that mentions "only Archer, Frost, Tesla and Ballista" must match the data.
    const air = TOWER_TYPES.filter((t) => TOWER_DEFS[t].role === 'attack' && towerEntry(t).hitsFlyers).sort();
    expect(air).toEqual(['archer', 'ballista', 'frost', 'tesla']);
    expect(enemyEntry('flyer').counter).toMatch(/Archer, Frost, Tesla and Ballista/);
  });

  it('counter text never recommends a ground-only tower against a flying foe', () => {
    const groundOnly = TOWER_TYPES.filter((t) => TOWER_DEFS[t].role === 'attack' && !towerEntry(t).hitsFlyers);
    for (const t of ENEMY_TYPES) {
      const e = enemyEntry(t);
      if (!e.flying) continue;
      for (const g of groundOnly) {
        expect(e.counter.toLowerCase(), `${t} counter mentions ${g}`).not.toContain(g);
      }
    }
  });

  it('every tower or ability name used in lore text is a real one', () => {
    const known = new Set([...TOWER_TYPES.map((t) => t[0].toUpperCase() + t.slice(1)), 'Overcharge', 'Meteor', 'Incendiary']);
    const names = /\b(Archer|Cannon|Frost|Tesla|Mortar|Ballista|Beacon|Overcharge|Meteor|Incendiary)\b/g;
    const texts = [...ENEMY_TYPES.map((t) => enemyEntry(t).counter), ...TOWER_TYPES.map((t) => towerEntry(t).strong)];
    for (const text of texts) for (const m of text.matchAll(names)) expect(known.has(m[1])).toBe(true);
  });

  it('classifies speeds', () => {
    expect(speedClass(1.0)).toBe('slow');
    expect(speedClass(2.3)).toBe('steady');
    expect(speedClass(3.0)).toBe('quick');
    expect(speedClass(4.0)).toBe('swift');
  });

  it('beacon is shown as a support tower without a damage stat', () => {
    const b = towerEntry('beacon');
    expect(b.stats.find((s) => s.label === 'Damage')).toBeUndefined();
    expect(b.stats.find((s) => s.label === 'Targets')?.value).toBe('support');
    expect(b.tiers[0].summary).toMatch(/fire rate/);
  });
});

describe('first-sighting queue', () => {
  it('queues each new thing once, in order, and records it as seen', () => {
    const store = new ContentStore(null);
    const q = new SightingQueue(store);
    expect(q.offerEnemy('grunt')).toBe(true);
    expect(q.offerEnemy('grunt')).toBe(false);
    expect(q.offerEnemy('flyer')).toBe(true);
    expect(q.offerElite()).toBe(true);
    expect(q.offerTower('beacon')).toBe(true);
    expect(q.offerTower('beacon')).toBe(false);
    expect(q.size).toBe(4);
    expect(q.drain()).toEqual([
      { kind: 'enemy', type: 'grunt' },
      { kind: 'enemy', type: 'flyer' },
      { kind: 'elite' },
      { kind: 'tower', type: 'beacon' },
    ]);
    expect(q.size).toBe(0);
    // Already seen: never offered again, even after the queue was drained.
    expect(q.offerEnemy('grunt')).toBe(false);
    expect(store.hasSeen('enemy:flyer')).toBe(true);
  });

  it('skips things the player has seen in an earlier session', () => {
    const store = new ContentStore(null);
    store.markSeen('enemy:mite');
    const q = new SightingQueue(store);
    expect(q.offerEnemy('mite')).toBe(false);
    expect(q.size).toBe(0);
  });

  it('waveHasElite reads the level data', () => {
    const lvl = LEVELS[LEVELS.length - 1];
    const idx = lvl.waves.findIndex((w) => w.groups.some((g) => g.elite));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(waveHasElite(lvl, idx)).toBe(true);
    expect(waveHasElite(lvl, 0)).toBe(false);
    expect(waveHasElite(lvl, 999)).toBe(false);
  });
});
