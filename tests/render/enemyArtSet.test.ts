import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EnemyType } from '../../src/core/types.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { enemyArtKeys, ENEMY_SPAWNS, runEnemyTypes } from '../../src/render2d/enemyArtSet.ts';
import { enemyArtFor, parseManifest } from '../../src/render2d/manifest.ts';

const ROOT = join(__dirname, '../..');
const manifest = parseManifest(JSON.parse(readFileSync(join(ROOT, 'public/art2d/manifest.json'), 'utf8')));

/** `initEnemyAt('<type>', ...)` call sites in the sim, by enclosing method. */
function simSpawnSites(): { fn: string; type: string }[] {
  const lines = readFileSync(join(ROOT, 'src/sim/enemySystem.ts'), 'utf8').split('\n');
  const out: { fn: string; type: string }[] = [];
  let fn = '';
  for (let i = 0; i < lines.length; i++) {
    const head = /^ {2}(?:private |public |protected )?(\w+)\s*\(/.exec(lines[i]);
    if (head) fn = head[1];
    if (!lines[i].includes('initEnemyAt(') || head) continue;
    const call = lines.slice(i, i + 3).join(' ');
    const lit = /initEnemyAt\(\s*'(\w+)'/.exec(call);
    if (lit) out.push({ fn, type: lit[1] });
  }
  return out;
}

/** Which foe runs each spawning method (enemySystem.ts dispatch); mirrors ENEMY_SPAWNS. */
const SPAWNER_OF: Readonly<Record<string, EnemyType>> = {
  spawnDroppedRaiders: 'carrier',
  spawnSplitChild: 'splitter',
  updateTempest: 'tempest',
  updateBossAbilities: 'boss',
  updateGlacierWarden: 'glacier_warden',
  updateSovereign: 'eclipse_sovereign',
};

describe('enemy art subset (enemyArtSet.ts)', () => {
  it('ENEMY_SPAWNS lists every foe the sim spawns from another foe', () => {
    const sites = simSpawnSites();
    expect(sites.length).toBeGreaterThan(5);
    for (const { fn, type } of sites) {
      const parent = SPAWNER_OF[fn];
      expect(parent, `new spawn site ${fn} → ${type}: add it to ENEMY_SPAWNS and SPAWNER_OF`).toBeDefined();
      expect(ENEMY_SPAWNS[parent] ?? [], `${parent} spawns ${type} (${fn})`).toContain(type);
    }
    // ...and nothing stale: every listed child has a spawn site.
    for (const [parent, kids] of Object.entries(ENEMY_SPAWNS)) {
      for (const kid of kids ?? []) expect(sites.some((s) => SPAWNER_OF[s.fn] === parent && s.type === kid), `${parent} → ${kid}`).toBe(true);
    }
  });

  it('closes over spawns transitively', () => {
    const types = runEnemyTypes({ waves: [{ name: 'w', groups: [{ enemyType: 'eclipse_sovereign', count: 1, spawnInterval: 1, startDelay: 0 }] }] } as never);
    expect([...types].sort()).toEqual(['duskhound', 'eclipse_shade', 'eclipse_sovereign']);
  });

  it('every island loads the art of every foe its waves (and their spawns) can show, plus the stand-ins', () => {
    const standIn = manifest.enemyMap['*'].art;
    for (const level of LEVELS_2D) {
      const keys = enemyArtKeys(manifest, runEnemyTypes(level));
      expect(keys.has(standIn), level.id).toBe(true);
      expect(keys.has('soldier'), level.id).toBe(true);
      for (const wave of level.waves) {
        for (const g of wave.groups) {
          const art = enemyArtFor(manifest, g.enemyType, ENEMY_DEFS[g.enemyType].flying).art;
          expect(keys.has(art), `${level.id} ${g.enemyType} → ${art}`).toBe(true);
          for (const kid of ENEMY_SPAWNS[g.enemyType] ?? []) {
            expect(keys.has(enemyArtFor(manifest, kid, ENEMY_DEFS[kid].flying).art), `${level.id} ${g.enemyType} spawns ${kid}`).toBe(true);
          }
        }
      }
      // A subset in practice: no early island loads the whole roster.
      if (level.id === 'i01') expect(keys.size).toBeLessThan(Object.keys(manifest.enemies).length / 2);
    }
  });
});
