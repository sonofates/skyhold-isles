import type { EnemyType } from '../core/types.ts';
import type { EnemyArtRuntime, LoadedArt } from './assets2d.ts';
import { enemyArtFor } from './manifest.ts';
import { PROC_CLIP, PROC_CLIP_HEAVY, sheetClip, type SwingClip } from './meleeAnim.ts';
import type { MeleeLook } from './meleeDirector.ts';

/** Heavy hitters: slower procedural swings, big knockback on soldiers, ground slam. */
const HEAVY: ReadonlySet<EnemyType> = new Set<EnemyType>(['golem', 'boss', 'tempest', 'glacier_warden', 'eclipse_sovereign', 'eclipse_shade', 'brute', 'sledguard']);

/** Soldier height when the manifest has no soldier art (matches soldierLayer's placeholder). */
const PLACEHOLDER_SOLDIER_HEIGHT = 1.3;

function clipOf(art: EnemyArtRuntime | undefined, heavy: boolean): SwingClip {
  const a = art?.attack;
  if (a) return sheetClip({ count: a.frames.length, fps: a.fps, impact: a.impact });
  return heavy ? PROC_CLIP_HEAVY : PROC_CLIP;
}

/** Sizes and swing clips of the loaded art, for the MeleeDirector. */
export function meleeLookFor(art: LoadedArt): MeleeLook {
  const artOf = (type: EnemyType): { rt: EnemyArtRuntime | undefined; scale: number } => {
    const entry = enemyArtFor(art.manifest, type, false);
    const rt = art.enemies[entry.art];
    return { rt, scale: ((entry as { scale?: number }).scale ?? 1) * (rt?.scaleMul ?? 1) };
  };
  const soldier = art.enemies.soldier;
  const soldierOk = soldier !== undefined && soldier.base.width > 1;
  const soldierClip = clipOf(soldierOk ? soldier : undefined, false);
  return {
    soldierHeight: soldierOk ? soldier.spec.height : PLACEHOLDER_SOLDIER_HEIGHT,
    enemyHeight: (type) => {
      const { rt, scale } = artOf(type);
      return (rt?.spec.height ?? 1.3) * scale;
    },
    clip: (kind, type) => (kind === 'soldier' || type === null ? soldierClip : clipOf(artOf(type).rt, HEAVY.has(type))),
    heavy: (type) => HEAVY.has(type),
  };
}
