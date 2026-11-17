import type { CardRef } from './firstSighting.ts';
import { eliteEntry, enemyEntry, towerEntry } from './codexData.ts';
import { ENEMY_ICON_SVGS, TOWER_ICON_SVGS, UI_ICON_SVGS } from '../icons.ts';

export interface CardContent {
  /** Small label above the name: "New foe", "New boss", "New tower", "Elite foes". */
  readonly kicker: string;
  readonly name: string;
  readonly iconSvg: string;
  readonly tags: readonly string[];
  readonly blurb: string;
  /** "Beats it" / "Best for" label + text. */
  readonly tipLabel: string;
  readonly tip: string;
  readonly accent: 'foe' | 'boss' | 'elite' | 'tower';
  /** Codex tab + entry this card links to. */
  readonly codex: { readonly tab: 'enemies' | 'towers'; readonly id: string };
}

export function cardContent(ref: CardRef): CardContent {
  if (ref.kind === 'enemy') {
    const e = enemyEntry(ref.type);
    return {
      kicker: e.isBoss ? 'New boss' : e.flying ? 'New flyer' : 'New foe',
      name: e.name,
      iconSvg: ENEMY_ICON_SVGS[ref.type],
      tags: e.tags,
      blurb: e.blurb,
      tipLabel: 'Counter',
      tip: e.counter,
      accent: e.isBoss ? 'boss' : 'foe',
      codex: { tab: 'enemies', id: ref.type },
    };
  }
  if (ref.kind === 'elite') {
    const e = eliteEntry();
    return {
      kicker: 'Elite foes',
      name: e.name,
      iconSvg: UI_ICON_SVGS.star,
      tags: e.tags,
      blurb: e.blurb,
      tipLabel: 'Counter',
      tip: e.counter,
      accent: 'elite',
      codex: { tab: 'enemies', id: 'elite' },
    };
  }
  const t = towerEntry(ref.type);
  return {
    kicker: 'New tower',
    name: t.name,
    iconSvg: TOWER_ICON_SVGS[ref.type],
    tags: t.tags,
    blurb: t.description,
    tipLabel: 'Best for',
    tip: t.strong,
    accent: 'tower',
    codex: { tab: 'towers', id: ref.type },
  };
}
