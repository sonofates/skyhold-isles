import type { EnemyType } from '../../core/types.ts';
import { ENEMY_DEFS } from '../../data/enemies.ts';
import type { LevelDef, WaveDef } from '../../data/levels/types.ts';
import { TOWER_DEFS, TOWER_TYPES } from '../../data/towers.ts';
import { buildEndlessWaveDef } from '../../sim/waveSystem.ts';

/**
 * Text for the small wave-start banner: the wave's name plus ONE hint line about the most important thing in it.
 * Pure (no DOM), so it is unit-tested against the real level + tower data.
 */

export interface WaveBannerContent {
  /** "WAVE 7 OF 24", "FINAL WAVE", "ENDLESS · WAVE 31". */
  kicker: string;
  /** Wave name, or "Wave 7" when the data has none. */
  title: string;
  /** One line: what is coming and what answers it. */
  hint: string;
  /** Visual accent: boss waves read differently from flyers / elites / plain waves. */
  accent: 'boss' | 'air' | 'elite' | 'plain';
  /** "Elite" marker for the kicker row. */
  elite: boolean;
}

function titleCase(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Towers that actually shoot flyers (the Beacon never shoots), e.g. "Archer, Frost, Tesla and Ballista". */
export function airTowerNames(): string {
  const names = TOWER_TYPES.filter((t) => TOWER_DEFS[t].hitsFlyers && TOWER_DEFS[t].role === 'attack').map(titleCase);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
}

/** Hint per enemy type, most urgent first. The first type present in the wave wins. */
const HINT_ORDER: readonly EnemyType[] = [
  'boss',
  'tempest',
  'hexer',
  'carrier',
  'flyer',
  'burrower',
  'blinker',
  'warden',
  'healer',
  'golem',
  'brute',
  'splitter',
  'mite',
  'runner',
  'grunt',
];

function hintFor(type: EnemyType): string {
  switch (type) {
    case 'boss':
    case 'tempest':
      return 'Boss wave. Ballista pierces its armor, Frost slows it.';
    case 'hexer':
      return 'Hexers silence towers. Burst them down first.';
    case 'carrier':
      return `Sky barges drop raiders. ${airTowerNames()} hit air.`;
    case 'flyer':
      return `Flyers incoming. ${airTowerNames()} hit air.`;
    case 'burrower':
      return 'Burrowers dig under the road. Cover its whole length.';
    case 'blinker':
      return 'Blinkers jump ahead. Frost delays every jump.';
    case 'warden':
      return 'Wardens shield their allies. Focus them first.';
    case 'healer':
      return 'Healers mend the pack. Kill them first.';
    case 'golem':
      return 'Golems are heavily armored. Frost cracks them, Ballista pierces.';
    case 'brute':
      return 'Brutes are armored. Cannon, Mortar and Ballista hit hard.';
    case 'splitter':
      return 'Splitters burst in two. Splash cleans up.';
    case 'mite':
      return 'A swarm is coming. Splash and Tesla shred it.';
    case 'runner':
      return 'Fast runners. Frost slows them, Tesla pops packs.';
    case 'grunt':
      return 'A steady march. Hold the road.';
  }
}

export function waveHint(wave: WaveDef | undefined): string {
  if (!wave || wave.groups.length === 0) return 'Hold the road.';
  const present = new Set<EnemyType>();
  for (const g of wave.groups) present.add(g.enemyType);
  for (const type of HINT_ORDER) if (present.has(type)) return hintFor(type);
  return 'Hold the road.';
}

export function waveAccent(wave: WaveDef | undefined): WaveBannerContent['accent'] {
  if (!wave) return 'plain';
  if (wave.groups.some((g) => ENEMY_DEFS[g.enemyType].isBoss)) return 'boss';
  if (wave.groups.some((g) => ENEMY_DEFS[g.enemyType].flying)) return 'air';
  if (wave.groups.some((g) => g.elite === true)) return 'elite';
  return 'plain';
}

/** Banner content for the wave that just started (`waveIndex` is 0-based, as in the `waveStarted` event). */
export function waveBannerContent(
  level: LevelDef,
  waveIndex: number,
  totalWaves: number,
  endless = false,
): WaveBannerContent {
  const story = waveIndex < level.waves.length;
  const wave: WaveDef | undefined = story ? level.waves[waveIndex] : endless ? buildEndlessWaveDef(waveIndex, level) : undefined;
  const number = waveIndex + 1;
  let kicker: string;
  if (endless && !story) kicker = `ENDLESS · WAVE ${number}`;
  else if (number >= totalWaves && totalWaves > 0) kicker = 'FINAL WAVE';
  else kicker = `WAVE ${number} OF ${totalWaves}`;
  const accent = waveAccent(wave);
  return {
    kicker,
    title: wave?.name?.trim() || `Wave ${number}`,
    hint: waveHint(wave),
    accent,
    elite: wave ? wave.groups.some((g) => g.elite === true) : false,
  };
}
