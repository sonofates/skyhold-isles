import { afterEach, describe, expect, it } from 'vitest';
import type { TowerType } from '../../src/core/types.ts';
import { getTowerTierStats, specializationsFor, TOWER_DEFS } from '../../src/data/towers.ts';
import { EN } from '../../src/i18n/en.ts';
import { setLocale } from '../../src/i18n/index.ts';
import { abilityChanges, branchChanges, branchStats, statChanges } from '../../src/render2d/ui/specInfo.ts';
import { anySpecialized, specHintTower } from '../../src/render2d/ui/specHint2d.ts';
import { parseManifest } from '../../src/render2d/manifest.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FAMILIES = Object.keys(TOWER_DEFS) as TowerType[];

afterEach(() => setLocale('en'));

describe('specialization stat changes (specInfo.ts)', () => {
  it('every branch shows at least one change from tier III, labelled in both languages', () => {
    for (const lang of ['en', 'tr'] as const) {
      setLocale(lang);
      for (const type of FAMILIES) {
        for (const b of specializationsFor(type)) {
          const rows = branchChanges(type, b);
          expect(rows.length, `${type}/${b.id}`).toBeGreaterThan(0);
          for (const r of rows) {
            expect(r.label, r.key).not.toMatch(/^spec\.stat\./);
            expect(r.from).not.toBe(r.to);
          }
        }
      }
    }
  });

  it('every stat the branch data changes either shows or is an internal tuning value', () => {
    const internal = new Set(['projectileSpeed', 'splashFalloffMin', 'clusterRadius', 'clusterOffset', 'volleyRadius', 'overloadDamage', 'overloadChain']);
    for (const type of FAMILIES) {
      for (const b of specializationsFor(type)) {
        const shown = new Set(branchChanges(type, b).map((r) => r.key));
        const t3 = getTowerTierStats(type, 3) as unknown as Record<string, number | undefined>;
        for (const [k, v] of Object.entries(b.changes)) {
          if (internal.has(k) || (t3[k] ?? 0) === v) continue;
          if (type === 'barracks' && k === 'damage') continue;
          expect(shown.has(k), `${b.id}.${k}`).toBe(true);
          expect(`spec.stat.${k}` in EN, k).toBe(true);
        }
        for (const a of b.abilities) expect(abilityChanges(type, b, a.id).length + 1, a.id).toBeGreaterThan(0);
      }
    }
  });

  it('reads the direction right: Farwatch trades speed for reach, Gateward returns faster', () => {
    const fw = branchChanges('archer', specializationsFor('archer')[0]);
    expect(fw.find((r) => r.key === 'range')?.up).toBe(true);
    expect(fw.find((r) => r.key === 'fireRate')?.up).toBe(false);
    const gw = branchChanges('barracks', specializationsFor('barracks')[0]);
    expect(gw.find((r) => r.key === 'soldierRespawnSec')?.up).toBe(true);
    const cb = branchChanges('mortar', specializationsFor('mortar')[1]);
    expect(cb.find((r) => r.key === 'burnDamage')).toMatchObject({ to: '—', up: false });
    expect(cb.find((r) => r.key === 'range')?.to).toBe('14.2');
    setLocale('tr');
    expect(branchChanges('mortar', specializationsFor('mortar')[1]).find((r) => r.key === 'range')?.to).toBe('14,2');
  });

  it('branch stats match what the sim resolves on purchase (tier III + changes, tier IV)', () => {
    const b = specializationsFor('ballista')[1];
    const s = branchStats('ballista', b);
    expect(s.tier).toBe(4);
    expect(s.damage).toBe(230);
    expect(statChanges('ballista', s, s)).toEqual([]);
  });
});

describe('tier-III tip (specHint2d.ts)', () => {
  it('points at the first tier-III tower without a branch, and stops once any tower specializes', () => {
    expect(specHintTower([])).toBe(-1);
    expect(specHintTower([{ id: 1, tier: 2 }, { id: 2, tier: 3 }])).toBe(2);
    expect(specHintTower([{ id: 1, tier: 3, specialization: { id: 'x' } }, { id: 4, tier: 3 }])).toBe(4);
    expect(anySpecialized([{ id: 1, tier: 3 }])).toBe(false);
    expect(anySpecialized([{ id: 1, tier: 3, specialization: { id: 'x' } }])).toBe(true);
  });
});

describe('specialization portraits in the art manifest', () => {
  it('every branch id has a portrait file that exists', () => {
    const root = join(__dirname, '../..');
    const raw = JSON.parse(readFileSync(join(root, 'public/art2d/manifest.json'), 'utf8')) as unknown;
    const m = parseManifest(raw);
    for (const type of FAMILIES) {
      for (const b of specializationsFor(type)) {
        const f = m.specPortraits?.[b.id];
        expect(f, b.id).toBeTruthy();
        expect(() => readFileSync(join(root, 'public/art2d', f!)), b.id).not.toThrow();
      }
    }
  });
});
