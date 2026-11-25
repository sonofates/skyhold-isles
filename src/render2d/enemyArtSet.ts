import type { EnemyType } from '../core/types.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import type { LevelDef } from '../data/levels/types.ts';
import { enemyArtFor, type ArtManifest } from './manifest.ts';

/**
 * Which enemy art a battle loads (docs/handoff-perf.md). Every battle used to fetch, decode and
 * (through the background warm-up) upload the sheets of all 29 manifest enemies (~23 MB of files,
 * ~400 MB of GPU textures). A story run only ever shows the foes of its waves plus what they
 * spawn, so it loads those (and the shared stand-ins) only. Endless runs and the debug scenes
 * keep loading everything.
 */

/**
 * Foes that spawn other foes in the sim (src/sim/enemySystem.ts `initEnemyAt('<type>', ...)`).
 * tests/render/enemyArtSet.test.ts fails when the sim spawns a literal type not listed here.
 */
export const ENEMY_SPAWNS: Readonly<Partial<Record<EnemyType, readonly EnemyType[]>>> = {
  /** Drops raiders when shot down (`spawnDroppedRaiders`). */
  carrier: ['grunt'],
  /** Splits into fast runners (`spawnSplitChild`). */
  splitter: ['runner'],
  /** Enrage phase summons mites (`updateTempest`). */
  tempest: ['mite'],
  /** Calls runner escorts at half HP (`updateBossAbilities`). */
  boss: ['runner'],
  /** HP thresholds summon Rime Beetles (`updateGlacierWarden`). */
  glacier_warden: ['rimebeetle'],
  /** Splits into Shadow Halves and summons Dusk Hounds (`updateSovereign`). */
  eclipse_sovereign: ['eclipse_shade', 'duskhound'],
};

/** Every foe type a story run of `level` can put on the map: its waves, closed over `ENEMY_SPAWNS`. */
export function runEnemyTypes(level: Pick<LevelDef, 'waves'>): Set<EnemyType> {
  const out = new Set<EnemyType>();
  const stack: EnemyType[] = [];
  for (const wave of level.waves) for (const g of wave.groups) stack.push(g.enemyType);
  while (stack.length > 0) {
    const t = stack.pop()!;
    if (out.has(t)) continue;
    out.add(t);
    for (const child of ENEMY_SPAWNS[t] ?? []) stack.push(child);
  }
  return out;
}

/**
 * Manifest enemy keys to load for those foes: each type's art (`enemyMap`), the default stand-in
 * (`enemyMap['*']`, drawn for any foe whose art is absent) and the barracks soldiers (`soldier`).
 */
export function enemyArtKeys(manifest: ArtManifest, types: Iterable<EnemyType>): Set<string> {
  const keys = new Set<string>();
  const add = (k: string | undefined): void => {
    if (k && manifest.enemies[k]) keys.add(k);
  };
  for (const t of types) add(enemyArtFor(manifest, t, ENEMY_DEFS[t]?.flying ?? false).art);
  add(manifest.enemyMap['*']?.art);
  add('soldier');
  return keys;
}
