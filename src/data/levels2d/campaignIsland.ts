import type { EnemyType } from '../../core/types.ts';
import { ENEMY_DEFS } from '../enemies.ts';
import type { LevelDef, ScriptedBuildAction, WaveDef, WaveGroupDef } from '../levels/types.ts';
import { gridSizeFor, parseLevel2D, type Level2DJson } from './loader.ts';

interface FlyingGroupTuning {
  hpScale?: number;
  countScale?: number;
  intervalScale?: number;
}

interface PlotTuning {
  startingGold: number;
  enemyHpScale: number;
  waveHpGrowth: number;
  hexRadius?: number;
  /** Target story wave count on the 2D island (trims weakest middle waves or repeats late waves). */
  waveCount?: number;
  /** Optional wave names that trimming must keep in addition to first/last/override waves. */
  keepWaves?: readonly string[];
  waves?: LevelDef['waves'];
  /** Final formation values on the painted route, keyed by wave name and enemy type. */
  formations?: Readonly<Record<string, Partial<Record<EnemyType, Partial<Omit<WaveGroupDef, 'enemyType'>>>>>>;
  flyingGroups?: FlyingGroupTuning;
  /** Campaign build site "col,row" → index in the baked layout's plots. */
  sites: Readonly<Record<string, number>>;
}

function waveStrength(wave: WaveDef): number {
  let hp = 0;
  for (const g of wave.groups) {
    const def = ENEMY_DEFS[g.enemyType];
    hp += def.maxHp * g.count * (g.hpScale ?? 1) * (g.elite ? 1.5 : 1);
  }
  return hp;
}

function waveExpectedGold(wave: WaveDef): number {
  let gold = wave.clearBonus;
  for (const g of wave.groups) {
    gold += ENEMY_DEFS[g.enemyType].reward * g.count;
    if (g.enemyType === 'splitter') gold += ENEMY_DEFS.runner.reward * 2 * g.count;
    if (g.enemyType === 'carrier') gold += ENEMY_DEFS.grunt.reward * (ENEMY_DEFS.carrier.dropCount ?? 2) * g.count;
  }
  return gold;
}

/**
 * Adjusts a story wave list to `targetCount` waves without mutating the source array.
 * - Trimming drops the weakest middle waves (normalized against the island's escalation curve and
 *   spaced across the run), preserving first/last/pinned waves, every enemy type, and every ground
 *   lane, while rolling dropped wave gold into the preceding kept wave's clear bonus.
 * - Extending repeats the penultimate wave before the finale with progressive HP growth.
 */
export function adjustWaveCount(
  waves: readonly WaveDef[],
  targetCount: number,
  pinnedIndices: ReadonlySet<number> = new Set(),
): WaveDef[] {
  const n = waves.length;
  if (targetCount === n || targetCount < 2 || n < 2) return [...waves];

  if (targetCount > n) {
    const out = waves.slice(0, n - 1);
    const template = waves[n - 2];
    const extra = targetCount - n;
    for (let k = 1; k <= extra; k++) {
      const mul = Number((1 + 0.06 * k).toFixed(3));
      out.push({
        ...template,
        groups: template.groups.map((g) => ({
          ...g,
          hpScale: Number(((g.hpScale ?? 1) * mul).toFixed(3)),
        })),
      });
    }
    out.push(waves[n - 1]);
    return out;
  }

  const pinned = new Set<number>(pinnedIndices);
  pinned.add(0);
  pinned.add(n - 1);

  const strengths = waves.map(waveStrength);
  const firstHp = Math.max(1, strengths[0]);
  const lastHp = Math.max(firstHp, strengths[n - 1]);
  const expectedAt = (idx: number): number => firstHp + ((lastHp - firstHp) * idx) / (n - 1);

  const typeCounts = new Map<EnemyType, number>();
  const laneCounts = new Map<number, number>();
  const waveTypes = waves.map((w) => new Set(w.groups.map((g) => g.enemyType)));
  const waveLanes = waves.map(
    (w) => new Set(w.groups.filter((g) => !ENEMY_DEFS[g.enemyType].flying).map((g) => g.lane ?? 0)),
  );
  for (let i = 0; i < n; i++) {
    for (const t of waveTypes[i]) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    for (const l of waveLanes[i]) laneCounts.set(l, (laneCounts.get(l) ?? 0) + 1);
  }

  const kept = new Array<boolean>(n).fill(true);
  let remaining = n;

  const canDrop = (idx: number, enforceCoverage: boolean): boolean => {
    if (!kept[idx] || pinned.has(idx)) return false;
    if (!enforceCoverage) return true;
    for (const t of waveTypes[idx]) {
      if ((typeCounts.get(t) ?? 0) <= 1) return false;
    }
    for (const l of waveLanes[idx]) {
      if ((laneCounts.get(l) ?? 0) <= 1) return false;
    }
    return true;
  };

  const adjacentDropped = (idx: number): number => {
    let run = 0;
    for (let j = idx - 1; j >= 0 && !kept[j]; j--) run++;
    for (let j = idx + 1; j < n && !kept[j]; j++) run++;
    return run;
  };

  while (remaining > targetCount) {
    let bestIdx = -1;
    let bestScore = Infinity;
    for (const enforceCoverage of [true, false]) {
      for (let i = 1; i < n - 1; i++) {
        if (!canDrop(i, enforceCoverage)) continue;
        const hasBoss = waves[i].groups.some((g) => ENEMY_DEFS[g.enemyType].isBoss);
        const rel = strengths[i] / expectedAt(i);
        const score = rel * (hasBoss ? 1.25 : 1) * (1 + 1.5 * adjacentDropped(i));
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) break;
    }
    if (bestIdx < 0) break;
    kept[bestIdx] = false;
    remaining--;
    for (const t of waveTypes[bestIdx]) typeCounts.set(t, (typeCounts.get(t) ?? 1) - 1);
    for (const l of waveLanes[bestIdx]) laneCounts.set(l, (laneCounts.get(l) ?? 1) - 1);
  }

  const result: WaveDef[] = [];
  for (let i = 0; i < n; i++) {
    if (!kept[i]) {
      const prev = result[result.length - 1];
      if (prev) {
        result[result.length - 1] = {
          ...prev,
          clearBonus: prev.clearBonus + Math.round(waveExpectedGold(waves[i])),
        };
      }
      continue;
    }
    result.push(waves[i]);
  }
  return result;
}

/** Adjust only the air formations on this painted route, after any named-wave overrides. */
function tuneFlyingGroups(
  waves: LevelDef['waves'],
  { hpScale, countScale = 1, intervalScale = 1 }: FlyingGroupTuning,
): LevelDef['waves'] {
  return waves.map(wave => ({
    ...wave,
    groups: wave.groups.map(group => ENEMY_DEFS[group.enemyType].flying
      ? {
          ...group,
          ...(hpScale === undefined ? {} : { hpScale }),
          count: Math.max(1, Math.round(group.count * countScale)),
          spawnInterval: group.spawnInterval * intervalScale,
        }
      : group),
  }));
}

/** Override a formation on the painted island. Unspecified fields come from the source wave. */
export function replaceWaveEnemy(
  level: Pick<LevelDef, 'waves'>, waveName: string, from: EnemyType, to: EnemyType,
  formation: Partial<Omit<WaveGroupDef, 'enemyType'>> = {},
): LevelDef['waves'] {
  return level.waves.map(wave => {
    if (wave.name !== waveName) return wave;
    const groups = wave.groups.map(group => group.enemyType === from ? { ...group, ...formation, enemyType: to } : group);
    return { ...wave, groups };
  });
}

/** Keep each campaign purchase, upgrade and targeting order on the corresponding painted plot. */
export function campaignIsland(source: LevelDef, json: Level2DJson, tuning: PlotTuning): LevelDef {
  const { sites, flyingGroups, formations, waveCount, keepWaves, waves = source.waves, ...balance } = tuning;
  const layout2d = parseLevel2D(json);
  function onPlots(actions: readonly ScriptedBuildAction[] = []): ScriptedBuildAction[] {
    return actions.map((action) => {
      const site = `${action.col},${action.row}`;
      const col = sites[site];
      if (!Number.isInteger(col) || !layout2d.plots[col]) {
        throw new Error(`${json.id}: missing plot for campaign site ${site}`);
      }
      return { ...action, col, row: 0 };
    });
  }

  const paintedWaves = flyingGroups ? tuneFlyingGroups(waves, flyingGroups) : waves;
  const formedWaves = formations ? paintedWaves.map(wave => {
    const changes = formations[wave.name ?? ''];
    return changes ? { ...wave, groups: wave.groups.map(g => ({ ...g, ...changes[g.enemyType] })) } : wave;
  }) : paintedWaves;

  let finalWaves = formedWaves;
  if (waveCount !== undefined && waveCount !== formedWaves.length) {
    const pinned = new Set<number>();
    const keepSet = new Set(keepWaves ?? []);
    formedWaves.forEach((wave, i) => {
      const name = wave.name ?? '';
      if (
        (formations && name in formations) ||
        keepSet.has(name) ||
        (waves !== source.waves && waves[i] !== source.waves[i])
      ) {
        pinned.add(i);
      }
    });
    finalWaves = adjustWaveCount(formedWaves, waveCount, pinned);
  }

  return {
    ...source,
    ...gridSizeFor(layout2d),
    id: json.id,
    pathWaypoints: [],
    extraGroundPaths: [],
    flightPath: [],
    layout2d,
    ...balance,
    waves: finalWaves,
    scriptedBuildOrder: onPlots(source.scriptedBuildOrder),
    weakBuildOrder: onPlots(source.weakBuildOrder),
  };
}
