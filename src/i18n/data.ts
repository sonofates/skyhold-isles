/**
 * Localised data-table text, looked up by the data ids. src/data/** is English and read-only here;
 * in English (or when an id is missing from DATA_TR) every lookup returns the data's own text.
 */
import type { TowerType } from '../core/types.ts';
import { CHALLENGES, type ChallengeId } from '../data/challenges.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import { TOWER_DEFS } from '../data/towers.ts';
import { WORKSHOP_BRANCHES, type WorkshopUpgradeDef } from '../data/workshop.ts';
import type { LevelDef } from '../data/levels/types.ts';
import type { FeatDef } from '../game/feats.ts';
import { ENEMY_LORE, TOWER_LORE } from '../ui/content/codexData.ts';
import { DATA_TR } from './dataTr.ts';
import { getLocale, t } from './index.ts';

const tr = (): boolean => getLocale() === 'tr';

// --- islands ---------------------------------------------------------------------------------

export function islandName(l: Pick<LevelDef, 'id' | 'name'>): string {
  return (tr() && DATA_TR.islands[l.id]?.name) || l.name;
}

export function islandSubtitle(l: Pick<LevelDef, 'id' | 'subtitle'>): string {
  return (tr() && DATA_TR.islands[l.id]?.subtitle) || l.subtitle;
}

export function difficultyName(d: LevelDef['difficulty']): string {
  switch (d) {
    case 'Breezy':
      return t('difficulty.Breezy');
    case 'Challenging':
      return t('difficulty.Challenging');
    case 'Heroic':
      return t('difficulty.Heroic');
    case 'Master':
      return t('difficulty.Master');
    default:
      return String(d);
  }
}

// --- towers ----------------------------------------------------------------------------------

/** English short names (the build ring's labels and the codex tiles). */
const SHORT_EN: Readonly<Record<string, string>> = {
  archer: 'Archer',
  cannon: 'Cannon',
  frost: 'Frost',
  tesla: 'Tesla',
  mortar: 'Mortar',
  ballista: 'Ballista',
  beacon: 'Beacon',
  barracks: 'Barracks',
};

/** One-line role under a tower's name in the build-ring tooltip. */
const ROLE_EN: Readonly<Record<string, string>> = {
  archer: 'Fast arrows · ground & air',
  cannon: 'Splash shells · ground only',
  frost: 'Chills and slows · ground & air',
  tesla: 'Chain lightning · ground & air',
  mortar: 'Huge range · close blind spot',
  ballista: 'Armor-piercing bolts · ground & air',
  beacon: 'Support · speeds up nearby towers',
  barracks: 'Soldiers block the road',
};

const towerTr = (id: string) => (tr() ? DATA_TR.towers[id] : undefined);
const towerDef = (id: string) => TOWER_DEFS[id as TowerType] as (typeof TOWER_DEFS)[TowerType] | undefined;

export function towerName(id: string): string {
  return towerTr(id)?.name || towerDef(id)?.name || towerShortName(id);
}

export function towerShortName(id: string): string {
  return towerTr(id)?.short || SHORT_EN[id] || id.charAt(0).toUpperCase() + id.slice(1);
}

export function towerDesc(id: string): string {
  return towerTr(id)?.desc || towerDef(id)?.shortDesc || '';
}

export function towerRole(id: string): string {
  return towerTr(id)?.role || ROLE_EN[id] || towerDef(id)?.shortDesc || '';
}

export function signatureName(id: string): string {
  return towerTr(id)?.sigName || towerDef(id)?.signature.name || '';
}

export function signatureDesc(id: string): string {
  return towerTr(id)?.sigDesc || towerDef(id)?.signature.desc || '';
}

export function towerStrong(id: string): string {
  return towerTr(id)?.strong || TOWER_LORE[id as TowerType]?.strong || '';
}

export function towerWeak(id: string): string {
  return towerTr(id)?.weak || TOWER_LORE[id as TowerType]?.weak || '';
}

// --- enemies ---------------------------------------------------------------------------------

const enemyTr = (id: string) => (tr() ? DATA_TR.enemies[id] : undefined);
const enemyDef = (id: string) => ENEMY_DEFS[id as keyof typeof ENEMY_DEFS] as (typeof ENEMY_DEFS)[keyof typeof ENEMY_DEFS] | undefined;

export function enemyName(id: string): string {
  return enemyTr(id)?.name || enemyDef(id)?.name || id;
}

export function enemyDesc(id: string): string {
  return enemyTr(id)?.desc || enemyDef(id)?.description || '';
}

export function enemyCounter(id: string): string {
  return enemyTr(id)?.counter || ENEMY_LORE[id as keyof typeof ENEMY_LORE]?.counter || '';
}

/** A codex chip (lore tags are English words, not ids). */
export function tagName(tag: string): string {
  return (tr() && DATA_TR.tags[tag]) || tag;
}

// --- modes / meta ----------------------------------------------------------------------------

export function challengeName(id: string): string {
  return (tr() && DATA_TR.challenges[id]?.name) || CHALLENGES[id as ChallengeId]?.name || id;
}

export function challengeDesc(id: string): string {
  return (tr() && DATA_TR.challenges[id]?.desc) || CHALLENGES[id as ChallengeId]?.description || '';
}

export function branchName(id: string): string {
  return (tr() && DATA_TR.branches[id]) || WORKSHOP_BRANCHES.find((b) => b.id === id)?.name || id;
}

export function upgradeName(def: Pick<WorkshopUpgradeDef, 'id' | 'name'>): string {
  return (tr() && DATA_TR.upgrades[def.id]?.name) || def.name;
}

/** Effect text of rank `rank` (1-based). */
export function upgradeRankText(def: Pick<WorkshopUpgradeDef, 'id' | 'rankText'>, rank: number): string {
  return (tr() && DATA_TR.upgrades[def.id]?.ranks[rank - 1]) || def.rankText[rank - 1] || '';
}

/** Endless medal tier by its English data name (Bronze / Silver / Gold). */
export function tierLabel(englishName: string): string {
  return (tr() && DATA_TR.tiers[englishName]) || englishName;
}

export function featName(def: Pick<FeatDef, 'id' | 'name'>): string {
  return (tr() && DATA_TR.feats[def.id]?.name) || def.name;
}

export function featDesc(def: Pick<FeatDef, 'id' | 'description'>): string {
  return (tr() && DATA_TR.feats[def.id]?.desc) || def.description;
}
