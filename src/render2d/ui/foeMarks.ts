/**
 * Shape marks for foe kinds (colour-blind-safe): a wing for flyers, a shield for heavy armour, a
 * crown for bosses — next to the sky-blue / red backdrops that used to carry these alone. Used on
 * the next-wave chips and the foe card. Elites already wear a star.
 */
import { t } from '../../i18n/index.ts';
import { el, glyph } from './dom.ts';
import type { IconName } from './paintedIcons.ts';
import './foeMarks.css';

/** Armour from which a foe counts as armoured (brute 6, tempest / boss 8, kilnback 11, golem 12). */
export const ARMORED_MIN = 5;

export interface FoeKind {
  readonly flying: boolean;
  readonly armored: boolean;
  readonly boss: boolean;
}

/** The marks a foe shows, in a fixed order (crown, wing, shield). */
export function foeMarkNames(k: FoeKind): IconName[] {
  const out: IconName[] = [];
  if (k.boss) out.push('crown');
  if (k.flying) out.push('wing');
  if (k.armored) out.push('shield');
  return out;
}

const LABEL: Readonly<Partial<Record<IconName, 'codex.kicker.boss' | 'codex.kicker.flyer' | 'foe.armored'>>> = {
  crown: 'codex.kicker.boss',
  wing: 'codex.kicker.flyer',
  shield: 'foe.armored',
};

/** A row of small mark badges (null when the foe has none). */
export function foeMarks(k: FoeKind, cls = ''): HTMLElement | null {
  const names = foeMarkNames(k);
  if (names.length === 0) return null;
  const row = el('span', `pu-foe-marks${cls ? ` ${cls}` : ''}`, { 'data-marks': names.join(' ') });
  for (const n of names) {
    const key = LABEL[n];
    const b = el('span', `pu-foe-mark ${n}`, key ? { title: t(key), 'aria-label': t(key), role: 'img' } : {});
    b.append(glyph(n));
    row.append(b);
  }
  return row;
}
