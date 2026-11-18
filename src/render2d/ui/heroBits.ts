/**
 * Shared pieces of the hero UI (in-game HUD, briefing picker, skill tree): painted art URLs from
 * the manifest's `heroes` section, unlock-rule text, the level badge and the XP bar.
 */
import type { HeroId } from '../../core/types.ts';
import { HERO_DEFS, type HeroUnlockRule } from '../../data/heroes.ts';
import { t } from '../../i18n/index.ts';
import { parseHeroArt, type HeroArtSpec } from '../manifest.ts';
import type { HeroLevelProgress } from '../heroes2d.ts';
import { ART, el } from './dom.ts';
import { fetchMapsManifest } from './islandArt.ts';
import './heroBits.css';

export type HeroArtFiles = Readonly<Record<string, HeroArtSpec>>;

/** Hero art paths (manifest `heroes`), or an empty table when the manifest has none. */
export async function heroArtFiles(): Promise<HeroArtFiles> {
  const raw = (await fetchMapsManifest()) as unknown as { heroes?: unknown } | null;
  return parseHeroArt(raw?.heroes);
}

/** Painted art key of a hero's passive / active (`bulwark`, `shieldBash`, …: the data `kind`). */
export function skillArtKey(id: HeroId, slot: 'passive' | 0 | 1): string {
  const d = HERO_DEFS[id];
  return slot === 'passive' ? d.passive.kind : d.actives[slot].kind;
}

export function heroPortraitUrl(files: HeroArtFiles, id: HeroId): string | null {
  const f = files[id]?.portrait;
  return f ? ART + f : null;
}

export function heroSelectUrl(files: HeroArtFiles, id: HeroId): string | null {
  const f = files[id]?.select;
  return f ? ART + f : null;
}

export function heroSkillUrl(files: HeroArtFiles, id: HeroId, slot: 'passive' | 0 | 1): string | null {
  const f = files[id]?.skills[skillArtKey(id, slot)];
  return f ? ART + f : null;
}

/** Branch icon: branch index 0..2 → manifest slot passive / active1 / active2 (handoff-codex-hero-art). */
export function heroBranchUrl(files: HeroArtFiles, id: HeroId, branchIndex: number): string | null {
  const slot = branchIndex === 0 ? 'passive' : branchIndex === 1 ? 'active1' : 'active2';
  const f = files[id]?.branches[slot];
  return f ? ART + f : null;
}

/** "Free from the start" / "Clear 4 islands to unlock". */
export function unlockRuleText(rule: HeroUnlockRule): string {
  return rule.kind === 'starter' ? t('hero.unlockStarter') : t('hero.unlockIslands', { n: rule.count });
}

/** Round level badge ("12"). */
export function levelBadge(level: number, cls = ''): HTMLSpanElement {
  return el('span', `pu-hero-lvl pu-letter${cls ? ` ${cls}` : ''}`, { 'aria-label': t('hero.levelAria', { n: level }) }, String(level));
}

/** XP bar to the next level (full at level 20) with "120 / 289 XP" or "Max level". */
export function xpBar(p: HeroLevelProgress): HTMLDivElement {
  const bar = el('div', 'pu-hero-xp', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(p.fraction * 100) });
  const fill = el('i', 'pu-hero-xp-fill');
  fill.style.width = `${(p.fraction * 100).toFixed(1)}%`;
  const label = p.nextLevelXp === null ? t('hero.maxLevel') : t('hero.xpOf', { xp: p.xpIntoLevel, need: p.xpForNextLevel });
  bar.append(fill, el('span', 'pu-hero-xp-text pu-letter', {}, label));
  return bar;
}
