/**
 * Tier-IV specializations as the UI shows them (build ring, comparison card, codex): which stats a
 * branch changes against tier III, formatted in the player's language. Pure (unit-tested); every
 * number comes from src/data/towers.ts (`specializationsFor`, absolute stat replacements).
 */
import type { TowerType } from '../../core/types.ts';
import { getTowerTierStats, specializationsFor, type TowerSpecializationDef, type TowerTierStats } from '../../data/towers.ts';
import { num, pct, t, type MsgKey } from '../../i18n/index.ts';

type Fmt = 'num' | 'int' | 'pct' | 'sec' | 'rate' | 'times' | 'every';

/** Stats the player can read, in display order, with their format. Others (projectile speed, splash falloff, offsets) stay internal. */
const SHOWN: readonly (readonly [keyof TowerTierStats, Fmt])[] = [
  ['damage', 'num'],
  ['soldierDamage', 'num'],
  ['fireRate', 'rate'],
  ['range', 'num'],
  ['minRange', 'num'],
  ['armorPierce', 'int'],
  ['splashRadius', 'num'],
  ['slowRatio', 'pct'],
  ['slowDuration', 'sec'],
  ['brittle', 'times'],
  ['chainCount', 'int'],
  ['chainRange', 'num'],
  ['chainFalloff', 'pct'],
  ['overloadEvery', 'every'],
  ['volleyEvery', 'every'],
  ['volleyExtra', 'int'],
  ['clusterCount', 'int'],
  ['clusterDamage', 'pct'],
  ['burnDamage', 'num'],
  ['burnRadius', 'num'],
  ['burnDuration', 'sec'],
  ['pierceCount', 'int'],
  ['pierceLength', 'num'],
  ['pierceFalloff', 'pct'],
  ['auraRate', 'pct'],
  ['auraRange', 'pct'],
  ['soldierArmor', 'int'],
  ['soldierRespawnSec', 'sec'],
  ['soldierCleave', 'pct'],
];

/** Barracks mirror soldier damage into `damage` for old UI text: show it once. */
const SKIP_FOR_BARRACKS: ReadonlySet<keyof TowerTierStats> = new Set(['damage']);

function fmt(v: number | undefined, f: Fmt): string {
  if (v === undefined || v === 0) return t('spec.none');
  switch (f) {
    case 'pct':
      return pct(v);
    case 'sec':
      return t('spec.sec', { n: num(v) });
    case 'times':
      return t('spec.times', { n: num(v) });
    case 'every':
      return t('spec.every', { n: v });
    case 'int':
      return String(Math.round(v));
    case 'rate':
    case 'num':
      return num(Math.round(v * 100) / 100);
  }
}

export interface StatChange {
  readonly key: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  /** True when the new value is better for the player (more damage, a smaller blind spot, …). */
  readonly up: boolean;
}

/** Lower is better for these (a shorter return, a smaller blind spot, an attack every fewer shots). */
const LOWER_BETTER: ReadonlySet<keyof TowerTierStats> = new Set(['minRange', 'soldierRespawnSec', 'overloadEvery', 'volleyEvery']);

/** Stat lines that differ between `before` and `after` (both absolute), labelled and formatted. */
export function statChanges(type: TowerType, before: TowerTierStats, after: TowerTierStats): StatChange[] {
  const out: StatChange[] = [];
  for (const [key, f] of SHOWN) {
    if (type === 'barracks' && SKIP_FOR_BARRACKS.has(key)) continue;
    const a = (before[key] as number | undefined) ?? 0;
    const b = (after[key] as number | undefined) ?? 0;
    if (Math.abs(a - b) < 1e-9) continue;
    // "every N" with N = 0 means the effect is gone: worse, whatever the direction rule says.
    const better = b === 0 && LOWER_BETTER.has(key) ? false : a === 0 && LOWER_BETTER.has(key) ? true : LOWER_BETTER.has(key) ? b < a : b > a;
    out.push({ key, label: t(`spec.stat.${key}` as MsgKey), from: fmt(a, f), to: fmt(b, f), up: better });
  }
  return out;
}

/** The branch's stats as the sim resolves them on purchase (tier III + the branch's changes). */
export function branchStats(type: TowerType, branch: TowerSpecializationDef): TowerTierStats {
  return { ...getTowerTierStats(type, 3), ...branch.changes, tier: 4, upgradeCost: branch.cost };
}

/** What a branch changes against the family's tier III. */
export function branchChanges(type: TowerType, branch: TowerSpecializationDef): StatChange[] {
  return statChanges(type, getTowerTierStats(type, 3), branchStats(type, branch));
}

/** What an ability changes on top of its branch. */
export function abilityChanges(type: TowerType, branch: TowerSpecializationDef, abilityId: string): StatChange[] {
  const a = branch.abilities.find((x) => x.id === abilityId);
  if (!a) return [];
  const base = branchStats(type, branch);
  return statChanges(type, base, { ...base, ...a.changes });
}

/** The family's branch with this id, or null. */
export function branchById(type: TowerType, id: string): TowerSpecializationDef | null {
  return specializationsFor(type).find((b) => b.id === id) ?? null;
}
